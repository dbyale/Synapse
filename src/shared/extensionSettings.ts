// ── Generic extension settings runtime ───────────────────────────
// Shared by main (resolution, validation, persistence) and the renderer
// (settings UI). Nothing in here knows what any extension is: an extension
// declares its fields in its own manifest.json `settings` block, and every
// layer of the system — defaults file, per-profile overrides, the settings
// form, profile export/import — is driven by those field definitions.
//
// Layering, in precedence order:
//   defaults            userData/extension-settings/<extId>.json
//   profile overrides   Profile.toolSettings[<extId>]
//   runtime overlay     userData/extension-settings/<extId>.runtime.json
//
// A field with `perProfile: false` (or `sensitive: true`) exists only in the
// defaults layer: it is never stored on a profile and is stripped from any
// profile-supplied object, so a .synprofile export can never carry a secret.

export type SettingValue = string | number | boolean | string[];
export type SettingsBag = Record<string, SettingValue>;

export type SettingFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'toggle'
  | 'select'
  | 'stringList'
  | 'directory'
  | 'secret';

export const SETTING_FIELD_KINDS: readonly SettingFieldKind[] = [
  'text',
  'textarea',
  'number',
  'toggle',
  'select',
  'stringList',
  'directory',
  'secret',
];

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  key: string;
  label: string;
  kind: SettingFieldKind;
  /** Sections in the settings UI, in first-seen order. */
  group?: string;
  hint?: string;
  /** select only. Plain strings, or { value, label } for display text. */
  options?: Array<string | SettingOption>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /**
   * Values are filesystem paths: the UI offers a folder picker. Applies to the
   * `directory` kind automatically, and to `stringList` when its items are
   * directories.
   */
  picker?: 'directory';
  /** Defaults for the defaults layer. Overridden by settings.defaults[key]. */
  default?: SettingValue;
  /**
   * false → machine-level or credential field. Exists only in the defaults
   * layer, never stored on a profile. Defaults to true.
   */
  perProfile?: boolean;
  /** Render masked and never echoed to the UI. Implies perProfile: false. */
  sensitive?: boolean;
}

export interface ExtensionSettingsDef {
  fields: SettingField[];
  /** Defaults for the defaults layer; wins over each field's `default`. */
  defaults?: SettingsBag;
}

// ── Validation of manifest-authored definitions ──────────────────
// manifest.json is untrusted input once user extensions exist, so the field
// definitions themselves are validated rather than passed through raw.

const MAX_FIELDS = 200;
const MAX_OPTIONS = 500;

function cleanString(value: unknown, max = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/**
 * Option values are cleaned differently from every other string: an empty
 * value is a meaningful choice ("no filter", "any time"), so it survives.
 */
function cleanOptionValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

function cleanOptions(
  value: unknown,
): Array<string | SettingOption> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<string | SettingOption> = [];
  for (const entry of value.slice(0, MAX_OPTIONS)) {
    if (typeof entry === 'string') {
      const valueStr = cleanOptionValue(entry);
      if (valueStr !== undefined) out.push(valueStr);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const valueStr = cleanOptionValue((entry as SettingOption).value);
    if (valueStr === undefined) continue;
    const label = cleanString((entry as SettingOption).label, 200) ?? valueStr;
    out.push({ value: valueStr, label });
  }
  return out.length > 0 ? out : undefined;
}

function cleanDefaultValue(
  value: unknown,
  kind: SettingFieldKind,
): SettingValue | undefined {
  switch (kind) {
    case 'number':
      return cleanNumber(value);
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined;
    case 'stringList':
      if (!Array.isArray(value)) return undefined;
      return value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v !== '');
    default:
      return typeof value === 'string' ? value : undefined;
  }
}

// ── Generic coercion ─────────────────────────────────────────────
// One coercion path for every extension, driven only by the field defs.

function optionValues(field: SettingField): string[] {
  return (field.options ?? []).map((o) =>
    typeof o === 'string' ? o : o.value,
  );
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  // Convenience: a single string may carry a newline/comma separated list.
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

export function coerceValue(
  field: SettingField,
  raw: unknown,
  fallback?: SettingValue,
): SettingValue {
  switch (field.kind) {
    case 'number': {
      const n =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && raw.trim() !== ''
            ? Number(raw)
            : NaN;
      if (!Number.isFinite(n)) {
        return typeof fallback === 'number' ? fallback : 0;
      }
      let out = n;
      if (field.min !== undefined && out < field.min) out = field.min;
      if (field.max !== undefined && out > field.max) out = field.max;
      return out;
    }
    case 'toggle':
      if (typeof raw === 'boolean') return raw;
      if (raw === undefined || raw === null || raw === '') {
        return typeof fallback === 'boolean' ? fallback : false;
      }
      if (typeof raw === 'string') {
        const lower = raw.trim().toLowerCase();
        if (lower === 'false' || lower === '0') return false;
      }
      return true;
    case 'stringList': {
      const list = toList(raw);
      if (list.length === 0 && Array.isArray(fallback)) return [...fallback];
      return list;
    }
    case 'select': {
      const str = typeof raw === 'string' ? raw.trim() : '';
      const allowed = optionValues(field);
      if (str === '') {
        // An empty option is a real value ("no filter"), not a missing one.
        if (allowed.includes('')) return '';
        return typeof fallback === 'string' ? fallback : '';
      }
      // An empty option list means free-form values are acceptable.
      if (allowed.length > 0 && !allowed.includes(str)) {
        return typeof fallback === 'string' ? fallback : str;
      }
      return str;
    }
    default: {
      // text, textarea, directory, secret
      if (typeof raw === 'string') return raw;
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        return String(raw);
      }
      return typeof fallback === 'string' ? fallback : '';
    }
  }
}

/**
 * Coerces a raw settings object through the field defs. Unknown keys are
 * dropped — an extension reads its settings through its own typed view, so a
 * key with no field definition is invisible by design.
 */
export function coerceSettings(
  fields: SettingField[],
  raw: Record<string, any> | undefined,
  base?: SettingsBag,
): SettingsBag {
  const out: SettingsBag = {};
  for (const field of fields) {
    // The fallback is what the value should become when the supplied one is
    // unusable — never the supplied value itself, or an out-of-range number or
    // an option that isn't offered would pass straight through.
    const fallback = base?.[field.key] ?? field.default;
    out[field.key] = coerceValue(field, raw?.[field.key], fallback);
  }
  return out;
}

/**
 * Validates a manifest `settings` block. Malformed fields are dropped; if
 * nothing usable remains, returns undefined (the extension has no settings).
 */
export function validateSettingsDef(
  raw: unknown,
): ExtensionSettingsDef | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as { fields?: unknown; defaults?: unknown };
  if (!Array.isArray(source.fields)) return undefined;

  const seen = new Set<string>();
  const fields: SettingField[] = [];
  for (const entry of source.fields.slice(0, MAX_FIELDS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const f = entry as Record<string, any>;
    const key = cleanString(f.key, 64);
    if (!key || !/^[A-Za-z0-9_.-]+$/.test(key) || seen.has(key)) continue;
    const kind = SETTING_FIELD_KINDS.includes(f.kind)
      ? (f.kind as SettingFieldKind)
      : undefined;
    if (!kind) continue;
    const label = cleanString(f.label, 120) ?? key;

    const field: SettingField = { key, label, kind };
    const group = cleanString(f.group, 80);
    if (group) field.group = group;
    const hint = cleanString(f.hint, 500);
    if (hint) field.hint = hint;
    const placeholder = cleanString(f.placeholder, 200);
    if (placeholder) field.placeholder = placeholder;
    if (f.picker === 'directory') field.picker = 'directory';

    if (kind === 'select') {
      const options = cleanOptions(f.options);
      if (options) field.options = options;
    }
    if (kind === 'number') {
      const min = cleanNumber(f.min);
      const max = cleanNumber(f.max);
      const step = cleanNumber(f.step);
      if (min !== undefined) field.min = min;
      if (max !== undefined) field.max = max;
      if (step !== undefined && step > 0) field.step = step;
    }

    const def = cleanDefaultValue(f.default, kind);
    if (def !== undefined) field.default = def;

    if (f.perProfile === false) field.perProfile = false;
    if (f.sensitive === true || kind === 'secret') field.sensitive = true;
    // Secrets are never profile-portable, regardless of what was authored.
    if (field.sensitive) field.perProfile = false;

    seen.add(key);
    fields.push(field);
  }

  if (fields.length === 0) return undefined;

  const def: ExtensionSettingsDef = { fields };
  if (source.defaults && typeof source.defaults === 'object') {
    // Only keys the manifest actually sets become defaults; the rest keep the
    // value authored on the field itself.
    const provided = source.defaults as Record<string, any>;
    const present = fields.filter((field) => field.key in provided);
    const coerced = coerceSettings(present, provided);
    if (Object.keys(coerced).length > 0) def.defaults = coerced;
  }
  return def;
}

// ── Field helpers ────────────────────────────────────────────────

export function settingsFields(def?: ExtensionSettingsDef): SettingField[] {
  return def?.fields ?? [];
}

export function hasSettings(def?: ExtensionSettingsDef): boolean {
  return (def?.fields.length ?? 0) > 0;
}

export function isPerProfileField(field: SettingField): boolean {
  if (field.sensitive) return false;
  return field.perProfile !== false;
}

export function findField(
  def: ExtensionSettingsDef | undefined,
  key: string,
): SettingField | undefined {
  return def?.fields.find((f) => f.key === key);
}

/**
 * Equality for a settings value of any kind. A profile edit that lands back on
 * the default is not an override, so the UI uses this to drop the key again.
 */
export function sameSettingValue(a: SettingValue, b: SettingValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/** Declared defaults: per-field `default`, overridden by settings.defaults. */
export function declaredDefaults(def?: ExtensionSettingsDef): SettingsBag {
  const out: SettingsBag = {};
  for (const field of settingsFields(def)) {
    if (field.default !== undefined) out[field.key] = field.default;
  }
  if (def?.defaults) {
    for (const field of settingsFields(def)) {
      if (field.key in def.defaults) out[field.key] = def.defaults[field.key];
    }
  }
  return out;
}

/**
 * Keeps only the keys a profile may carry. Anything unknown, malformed, or
 * credential-shaped is dropped — this is what stops a hand-edited profile, or
 * an imported .synprofile, from injecting a secret or a machine-level setting.
 */
export function sanitizeProfileOverrides(
  def: ExtensionSettingsDef | undefined,
  raw: unknown,
): SettingsBag | undefined {
  const fields = settingsFields(def);
  if (fields.length === 0) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, any>;
  const picked: SettingsBag = {};
  for (const field of fields) {
    if (!isPerProfileField(field)) continue;
    if (!(field.key in source)) continue;
    picked[field.key] = coerceValue(field, source[field.key], field.default);
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/** Sanitizes a whole Profile.toolSettings map (keyed by extension id). */
export function sanitizeToolSettings(
  raw: unknown,
  getDef: (extId: string) => ExtensionSettingsDef | undefined,
): Record<string, SettingsBag> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, SettingsBag> = {};
  for (const [extId, overrides] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const clean = sanitizeProfileOverrides(getDef(extId), overrides);
    if (clean) out[extId] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Merges a runtime patch into an existing bag, keeping only defined,
 * perProfile-permitted keys. Used by ctx.updateSettings().
 */
export function mergeRuntimePatch(
  def: ExtensionSettingsDef | undefined,
  existing: SettingsBag,
  patch: unknown,
): { merged: SettingsBag; applied: string[] } {
  const merged: SettingsBag = { ...existing };
  const applied: string[] = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { merged, applied };
  }
  for (const [key, value] of Object.entries(patch as Record<string, any>)) {
    const field = findField(def, key);
    if (!field || !isPerProfileField(field)) continue;
    merged[key] = coerceValue(field, value, merged[key] ?? field.default);
    applied.push(key);
  }
  return { merged, applied };
}

/** Display text for a select value, so the UI and read-only views agree. */
export function optionLabel(field: SettingField, value: SettingValue): string {
  const str = String(value ?? '');
  for (const o of field.options ?? []) {
    if (typeof o === 'string' ? o === str : o.value === str) {
      return typeof o === 'string' ? (o === '' ? '(none)' : o) : o.label;
    }
  }
  if (str === '') return '(none)';
  return str;
}
