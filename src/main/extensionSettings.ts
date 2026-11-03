import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { ExtensionSettingsDef, SettingsBag } from '../extensions/types';
import {
  coerceSettings,
  declaredDefaults,
  mergeRuntimePatch,
  sanitizeToolSettings,
  settingsFields,
} from '../shared/extensionSettings';
// eslint-disable-next-line import/no-cycle
import { getExtensionRegistry } from './extensionRegistry';

/**
 * Extension settings, resolved per extension and per profile.
 *
 * Nothing here knows what any extension is. Every extension declares its own
 * fields in its own manifest.json; this module only ever reads those field
 * definitions, so an extension written by a user gets identical behaviour.
 *
 * Layers, lowest to highest precedence:
 *   1. declared defaults   manifest `settings.defaults` / each field's `default`,
 *                          plus the extension's own defaultSettings() hook
 *   2. defaults file       userData/extension-settings/<extId>.json
 *                          (the extension's "Default settings" page)
 *   3. profile overrides   Profile.toolSettings[<extId>] — only schema-permitted,
 *                          perProfile keys survive
 *   4. runtime overlay     userData/extension-settings/<extId>.runtime.json,
 *                          keyed by profileId — written by ctx.updateSettings()
 *
 * Layer 1-2 are global ("defaults"); layers 3-4 are per-profile. Secrets and
 * `perProfile: false` fields can only ever live in layers 1-2, so a profile
 * export can never carry them.
 */

const SETTINGS_DIR = path.join(app.getPath('userData'), 'extension-settings');

const defaultsCache = new Map<string, SettingsBag>();
const runtimeCache = new Map<string, SettingsBag>();
const effectiveCache = new Map<string, SettingsBag>();
/** profileId → extId → overrides */
const profileOverrides = new Map<string, Record<string, SettingsBag>>();

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function ensureSettingsDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

function defaultsPath(extId: string): string {
  return path.join(SETTINGS_DIR, `${extId}.json`);
}

function runtimePath(extId: string): string {
  return path.join(SETTINGS_DIR, `${extId}.runtime.json`);
}

function readJsonFile(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch (err) {
    console.error(
      `[extensionSettings] Unreadable settings file ${filePath}:`,
      err,
    );
  }
  return null;
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureSettingsDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

/** Keeps only JSON-safe scalars/arrays when an extension declares no fields. */
function asBag(raw: Record<string, any> | null): SettingsBag {
  if (!raw) return {};
  const out: SettingsBag = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      );
    }
  }
  return out;
}

export function getExtensionSettingsDir(): string {
  return SETTINGS_DIR;
}

export function getSettingsSchema(
  extId: string,
): ExtensionSettingsDef | undefined {
  if (!isSafeId(extId)) return undefined;
  return getExtensionRegistry().getExtensionSettingsSchema(extId);
}

// ── Defaults layer (the extension's own settings page) ───────────

function applyNormalize(
  extId: string,
  def: ExtensionSettingsDef,
  bag: SettingsBag,
): SettingsBag {
  const hook = getExtensionRegistry().getExtensionNormalizeSettings(extId);
  if (!hook) return bag;
  try {
    const result = hook(bag);
    // Re-coerce so a hook cannot widen a value outside its field's contract.
    return coerceSettings(settingsFields(def), result);
  } catch (err) {
    console.error(
      `[extensionSettings] normalizeSettings() failed for "${extId}":`,
      err,
    );
    return bag;
  }
}

export function getExtensionDefaults(extId: string): SettingsBag {
  const cached = defaultsCache.get(extId);
  if (cached) return cached;

  const def = getSettingsSchema(extId);
  const stored = readJsonFile(defaultsPath(extId));
  let merged: SettingsBag;

  if (!def) {
    // No declared fields: the file is the whole story, and nothing is
    // profile-portable. The extension can still read its own file.
    merged = asBag(stored);
  } else {
    const base = declaredDefaults(def);
    const hook = getExtensionRegistry().getExtensionDefaultSettings(extId);
    if (hook) {
      try {
        Object.assign(base, asBag(hook()));
      } catch (err) {
        console.error(
          `[extensionSettings] defaultSettings() failed for "${extId}":`,
          err,
        );
      }
    }
    merged = coerceSettings(settingsFields(def), stored ?? undefined, base);
    merged = applyNormalize(extId, def, merged);
  }

  defaultsCache.set(extId, merged);
  return merged;
}

/**
 * Writes the defaults layer. Unknown keys already in the file are preserved,
 * so an extension can keep settings it reads without declaring a field for.
 */
export function setExtensionDefaults(
  extId: string,
  settings: Record<string, any>,
): { success: boolean; error?: string } {
  if (!isSafeId(extId))
    return { success: false, error: 'Invalid extension id' };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { success: false, error: 'Invalid settings payload' };
  }
  const def = getSettingsSchema(extId);
  const existing = readJsonFile(defaultsPath(extId)) ?? {};
  const next: Record<string, any> = { ...existing };
  if (def) {
    // Only declared fields are accepted from the UI.
    for (const field of settingsFields(def)) {
      if (field.key in settings) next[field.key] = settings[field.key];
    }
  } else {
    Object.assign(next, settings);
  }
  try {
    writeJsonFile(defaultsPath(extId), next);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  defaultsCache.delete(extId);
  effectiveCache.clear();
  return { success: true };
}

// ── Profile overrides ────────────────────────────────────────────

/**
 * Registers the overrides a profile carries. Called when a profile is loaded
 * into a chat session. Anything the schema doesn't permit is dropped here, so
 * a hand-edited or imported profile cannot inject a secret or a machine-level
 * setting.
 */
export function setProfileToolSettings(
  profileId: string,
  toolSettings: unknown,
): void {
  if (!profileId) return;
  const clean = sanitizeToolSettings(toolSettings, (extId) =>
    getSettingsSchema(extId),
  );
  if (clean) profileOverrides.set(profileId, clean);
  else profileOverrides.delete(profileId);
  effectiveCache.clear();
}

export function clearProfileToolSettings(profileId: string): void {
  if (profileOverrides.delete(profileId)) effectiveCache.clear();
}

export function getProfileOverrides(
  extId: string,
  profileId?: string,
): SettingsBag | undefined {
  if (!profileId) return undefined;
  return profileOverrides.get(profileId)?.[extId];
}

// ── Runtime overlay (ctx.updateSettings) ─────────────────────────

/** extId → profileId → bag, read from disk once per extension. */
const runtimeFiles = new Map<string, Record<string, SettingsBag>>();

function loadRuntimeFile(extId: string): Record<string, SettingsBag> {
  const cached = runtimeFiles.get(extId);
  if (cached) return cached;
  const raw = readJsonFile(runtimePath(extId));
  const out: Record<string, SettingsBag> = {};
  if (raw) {
    for (const [profileId, bag] of Object.entries(raw)) {
      if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
        out[profileId] = bag as SettingsBag;
      }
    }
  }
  runtimeFiles.set(extId, out);
  return out;
}

function getRuntimeOverlay(
  extId: string,
  profileId?: string,
): SettingsBag | undefined {
  if (!profileId) return undefined;
  const cacheKey = `${extId}|${profileId}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached;
  const bag = loadRuntimeFile(extId)[profileId];
  if (bag) runtimeCache.set(cacheKey, bag);
  return bag;
}

// ── Effective settings ───────────────────────────────────────────

export function getEffectiveSettings(
  extId: string,
  profileId?: string,
): SettingsBag {
  const cacheKey = `${extId}|${profileId ?? ''}`;
  const cached = effectiveCache.get(cacheKey);
  if (cached) return cached;

  const def = getSettingsSchema(extId);
  const defaults = getExtensionDefaults(extId);
  let effective: SettingsBag;

  if (!def) {
    effective = defaults;
  } else {
    const overrides = getProfileOverrides(extId, profileId);
    const runtime = getRuntimeOverlay(extId, profileId);
    effective = coerceSettings(settingsFields(def), {
      ...defaults,
      ...(overrides ?? {}),
      ...(runtime ?? {}),
    });
    effective = applyNormalize(extId, def, effective);
  }

  effectiveCache.set(cacheKey, effective);
  return effective;
}

// ── Runtime writes (ctx.updateSettings) ────────────────────────

/**
 * Persists a tool-time change to this extension's own per-profile settings.
 * Restricted to declared, perProfile-permitted fields; everything else is
 * dropped. Only the changed keys are stored, so later changes to the defaults
 * layer still flow through for untouched fields.
 */
export function updateRuntimeSettings(
  extId: string,
  profileId: string | undefined,
  patch: unknown,
): { success: boolean; applied: string[]; error?: string } {
  if (!isSafeId(extId))
    return { success: false, applied: [], error: 'Invalid extension id' };
  if (!profileId) {
    return { success: false, applied: [], error: 'No profile context' };
  }
  const def = getSettingsSchema(extId);
  if (!def) {
    return {
      success: false,
      applied: [],
      error: `Extension "${extId}" declares no settings fields`,
    };
  }
  const { merged, applied } = mergeRuntimePatch(
    def,
    getEffectiveSettings(extId, profileId),
    patch,
  );
  if (applied.length === 0) return { success: true, applied: [] };

  const store = loadRuntimeFile(extId);
  const existing = store[profileId] ?? {};
  const next: SettingsBag = { ...existing };
  for (const key of applied) next[key] = merged[key];
  store[profileId] = next;
  try {
    writeJsonFile(runtimePath(extId), store);
  } catch (err) {
    return {
      success: false,
      applied: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  runtimeCache.delete(`${extId}|${profileId}`);
  effectiveCache.clear();
  return { success: true, applied };
}

export function invalidateSettingsCache(): void {
  defaultsCache.clear();
  runtimeCache.clear();
  runtimeFiles.clear();
  effectiveCache.clear();
}
