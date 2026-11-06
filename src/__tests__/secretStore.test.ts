import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SecretStore, SecretCrypto } from '../main/secretStore';

// Reversible fake crypto — lets the store logic run without electron's
// safeStorage. The `available` flag drives the plaintext fallback path.
function makeFakeCrypto(available = true): SecretCrypto & {
  setAvailable(v: boolean): void;
} {
  let avail = available;
  return {
    isAvailable: () => avail,
    setAvailable: (v: boolean) => {
      avail = v;
    },
    encrypt: (value: string) => `enc:${Buffer.from(value, 'utf-8').toString('base64')}`,
    decrypt: (payload: string) => {
      if (!payload.startsWith('enc:')) throw new Error('bad payload');
      return Buffer.from(payload.slice(4), 'base64').toString('utf-8');
    },
  };
}

function tempStore(crypto: SecretCrypto): { store: SecretStore; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-secrets-'));
  const file = path.join(dir, 'secrets.json');
  return { store: new SecretStore(file, crypto), file };
}

describe('SecretStore', () => {
  it('round-trips a secret and keeps the disk copy encrypted', () => {
    const { store, file } = tempStore(makeFakeCrypto());
    const res = store.set('profile:1', 'externalApiKey', 'sk-super-secret');
    expect(res.success).toBe(true);
    expect(res.unencrypted).toBeUndefined();
    expect(store.get('profile:1', 'externalApiKey')).toBe('sk-super-secret');

    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain('sk-super-secret');
    expect(raw).toContain('enc:');
  });

  it('decrypts from disk in a fresh instance (cold cache)', () => {
    const crypto = makeFakeCrypto();
    const { store, file } = tempStore(crypto);
    store.set('profile:1', 'externalApiKey', 'abc123');

    const reopened = new SecretStore(file, crypto);
    expect(reopened.get('profile:1', 'externalApiKey')).toBe('abc123');
    expect(reopened.has('profile:1', 'externalApiKey')).toBe(true);
  });

  it('falls back to plaintext (flagged) when encryption is unavailable', () => {
    const crypto = makeFakeCrypto(false);
    const { store, file } = tempStore(crypto);
    const res = store.set('profile:1', 'externalApiKey', 'plain-key');
    expect(res.success).toBe(true);
    expect(res.unencrypted).toBe(true);
    expect(store.isUnencrypted('profile:1', 'externalApiKey')).toBe(true);
    expect(store.get('profile:1', 'externalApiKey')).toBe('plain-key');

    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(raw['profile:1'].externalApiKey.plain).toBe(true);
  });

  it('delete and deleteScope remove entries', () => {
    const { store, file } = tempStore(makeFakeCrypto());
    store.set('profile:1', 'externalApiKey', 'k1');
    store.set('profile:2', 'externalApiKey', 'k2');

    store.delete('profile:1', 'externalApiKey');
    expect(store.has('profile:1', 'externalApiKey')).toBe(false);
    expect(store.has('profile:2', 'externalApiKey')).toBe(true);

    store.deleteScope('profile:2');
    expect(fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '{}').not.toContain('profile:2');
    expect(store.has('profile:2', 'externalApiKey')).toBe(false);
  });

  it('rejects invalid scopes/keys and empty values', () => {
    const { store } = tempStore(makeFakeCrypto());
    expect(store.set('bad scope!', 'k', 'v').success).toBe(false);
    expect(store.set('scope', 'bad key!', 'v').success).toBe(false);
    expect(store.set('scope', 'k', '').success).toBe(false);
    expect(store.get('bad scope!', 'k')).toBeNull();
  });

  it('re-encrypts on next write once the keyring returns', () => {
    const crypto = makeFakeCrypto(false);
    const { store, file } = tempStore(crypto);
    store.set('profile:1', 'externalApiKey', 'plain-key');
    crypto.setAvailable(true);
    store.set('profile:1', 'externalApiKey', 'new-key');
    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain('plain-key');
    expect(raw).not.toContain('new-key');
    expect(store.get('profile:1', 'externalApiKey')).toBe('new-key');
  });
});
