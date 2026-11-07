// ── Encrypted secret store ───────────────────────────────────────
// Secrets (external server API keys, extension credentials) persist in
// userData/secrets.json as base64 ciphertext produced by Electron's
// safeStorage — OS-backed (DPAPI on Windows, Keychain on macOS,
// libsecret on Linux). Decrypted values live only in this module's
// memory inside the main process; the renderer can set/delete secrets
// and check existence, but no IPC ever returns plaintext.
//
// Threat model: protects secrets at rest on disk and keeps them out of
// localStorage/profile JSON/.synprofile exports. Does NOT protect
// against an attacker already running as the same OS user.

import * as fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';

/** Encryption backend; injectable so tests can run without electron. */
export interface SecretCrypto {
  isAvailable(): boolean;
  /** Returns a base64 ciphertext string. */
  encrypt(value: string): string;
  /** Reverses encrypt(); throws on bad input. */
  decrypt(payload: string): string;
}

export const electronSecretCrypto: SecretCrypto = {
  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt(value: string): string {
    return safeStorage.encryptString(value).toString('base64');
  },
  decrypt(payload: string): string {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'));
  },
};

interface StoredSecret {
  /** base64 ciphertext, or raw text when plain === true. */
  value: string;
  /** True when safeStorage was unavailable at write time (fallback). */
  plain?: boolean;
}

type SecretFile = Record<string, Record<string, StoredSecret>>;

// Scope/key land up as JSON object keys; keep them boring.
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;

export class SecretStore {
  private readonly filePath: string;

  private readonly crypto: SecretCrypto;

  /** scope|key → decrypted value (disk copy stays ciphertext). */
  private readonly memCache = new Map<string, string>();

  private fileCache: SecretFile | null = null;

  constructor(filePath: string, crypto: SecretCrypto) {
    this.filePath = filePath;
    this.crypto = crypto;
  }

  get encryptionAvailable(): boolean {
    return this.crypto.isAvailable();
  }

  private loadFile(): SecretFile {
    if (this.fileCache) return this.fileCache;
    let parsed: SecretFile = {};
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [scope, entries] of Object.entries(raw)) {
            if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
              parsed[scope] = entries as Record<string, StoredSecret>;
            }
          }
        }
      }
    } catch (err) {
      console.error('[secretStore] failed to read secrets file:', err);
      parsed = {};
    }
    this.fileCache = parsed;
    return parsed;
  }

  private saveFile(file: SecretFile): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
      this.fileCache = file;
    } catch (err) {
      console.error('[secretStore] failed to write secrets file:', err);
      throw err;
    }
  }

  set(scope: string, key: string, value: string): { success: boolean; error?: string; unencrypted?: boolean } {
    if (!SAFE_ID.test(scope) || !SAFE_ID.test(key)) {
      return { success: false, error: 'Invalid secret scope or key' };
    }
    if (typeof value !== 'string' || value.length === 0) {
      return { success: false, error: 'Secret value must be a non-empty string' };
    }
    const file = this.loadFile();
    const entries = file[scope] ?? (file[scope] = {});
    if (this.crypto.isAvailable()) {
      entries[key] = { value: this.crypto.encrypt(value) };
      this.memCache.set(`${scope}|${key}`, value);
      this.saveFile(file);
      return { success: true };
    }
    // Fallback: no OS keyring (e.g. Linux without libsecret). Persist in
    // plaintext but flag it so the UI can warn the user.
    console.warn(
      '[secretStore] OS encryption unavailable — storing secret unencrypted',
    );
    entries[key] = { value, plain: true };
    this.memCache.set(`${scope}|${key}`, value);
    this.saveFile(file);
    return { success: true, unencrypted: true };
  }

  get(scope: string, key: string): string | null {
    if (!SAFE_ID.test(scope) || !SAFE_ID.test(key)) return null;
    const cacheKey = `${scope}|${key}`;
    const cached = this.memCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const stored = this.loadFile()[scope]?.[key];
    if (!stored) return null;
    try {
      const value = stored.plain ? stored.value : this.crypto.decrypt(stored.value);
      this.memCache.set(cacheKey, value);
      return value;
    } catch (err) {
      console.error('[secretStore] failed to decrypt secret:', err);
      return null;
    }
  }

  has(scope: string, key: string): boolean {
    return this.get(scope, key) !== null;
  }

  /** True when the stored entry exists but is NOT encrypted (fallback). */
  isUnencrypted(scope: string, key: string): boolean {
    if (!SAFE_ID.test(scope) || !SAFE_ID.test(key)) return false;
    return this.loadFile()[scope]?.[key]?.plain === true;
  }

  delete(scope: string, key: string): void {
    if (!SAFE_ID.test(scope) || !SAFE_ID.test(key)) return;
    this.memCache.delete(`${scope}|${key}`);
    const file = this.loadFile();
    if (file[scope]?.[key]) {
      delete file[scope][key];
      if (Object.keys(file[scope]).length === 0) delete file[scope];
      this.saveFile(file);
    }
  }

  /** Drop every secret under a scope (e.g. a deleted profile). */
  deleteScope(scope: string): void {
    if (!SAFE_ID.test(scope)) return;
    for (const cacheKey of [...this.memCache.keys()]) {
      if (cacheKey.startsWith(`${scope}|`)) this.memCache.delete(cacheKey);
    }
    const file = this.loadFile();
    if (file[scope]) {
      delete file[scope];
      this.saveFile(file);
    }
  }

  /** Wipe decrypted values from memory (app quit). */
  clearMemory(): void {
    this.memCache.clear();
  }
}

// ── Singleton (main process) ─────────────────────────────────────

let singleton: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (!singleton) {
    singleton = new SecretStore(
      path.join(app.getPath('userData'), 'secrets.json'),
      electronSecretCrypto,
    );
  }
  return singleton;
}

export function setSecret(scope: string, key: string, value: string) {
  return getSecretStore().set(scope, key, value);
}

export function getSecret(scope: string, key: string): string | null {
  return getSecretStore().get(scope, key);
}

export function hasSecret(scope: string, key: string): boolean {
  return getSecretStore().has(scope, key);
}

export function deleteSecret(scope: string, key: string): void {
  getSecretStore().delete(scope, key);
}

export function deleteSecretScope(scope: string): void {
  getSecretStore().deleteScope(scope);
}
