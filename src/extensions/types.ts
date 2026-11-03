// ── Extension-authored settings ──────────────────────────────────
// Every extension declares its own settings in its own manifest.json under a
// `settings` block. The core never names an extension id: it reads these field
// definitions and renders/coerces/validates them generically. A user extension
// dropped into userData/extensions/ gets the whole system from its own files.
// Types and generic runtime live in src/shared/extensionSettings.ts.
import type {
  ExtensionSettingsDef,
  SettingField,
  SettingFieldKind,
  SettingOption,
  SettingsBag,
  SettingValue,
} from '../shared/extensionSettings';

export type {
  ExtensionSettingsDef,
  SettingField,
  SettingFieldKind,
  SettingOption,
  SettingsBag,
  SettingValue,
};

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon: string;
  // ── Server-computed flags (hardcoded allowlists, NOT manifest-authored) ──
  // `builtIn` / `official` may appear in on-disk manifest.json for back-compat
  // but are always stripped and recomputed by ExtensionRegistry from
  // extensionTypes.ts. Never trust these from disk.
  builtIn: boolean;
  official?: boolean;
  iconSvgData?: string;
  /** Manifest-authored. Derived from settings.fields.length when absent. */
  hasSettings?: boolean;
  /** Manifest-authored settings schema. Validated by ExtensionRegistry. */
  settings?: ExtensionSettingsDef;
}

export interface ExtensionToolMeta {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  descriptionForModel?: string;
  icon: string;
  displayType?: string;
  tags?: string[];
}

export interface ExtensionToolContext {
  sessionId: string;
  profileId: string;
  /**
   * This extension's settings resolved for the calling profile:
   * defaults ⊕ profile overrides ⊕ runtime overlay.
   * The extension owns the shape of T; the core only knows the field defs.
   */
  settings<T = SettingsBag>(): T;
  /**
   * Persists a change to this extension's per-profile settings at tool-call
   * time (e.g. auto-approving a repository). Restricted to perProfile fields of
   * this extension only; unknown or non-perProfile keys are dropped.
   */
  updateSettings(patch: SettingsBag): void;
}

export interface ExtensionToolDef {
  meta: ExtensionToolMeta;
  params: Record<string, any>;
  handler: (params: any, context?: ExtensionToolContext) => any;
}

export interface Extension {
  manifest: ExtensionManifest;
  tools: Record<string, ExtensionToolDef>;
  enabled: boolean;
  extensionDir?: string;
  /**
   * Optional hooks authored by the extension itself (exported from its
   * index.js next to `tools` and `manifest`). The core calls them generically:
   * `defaultSettings` supplies computed defaults, `normalizeSettings` applies
   * extension-specific cleanup after generic coercion.
   */
  defaultSettings?: () => SettingsBag;
  normalizeSettings?: (raw: SettingsBag) => SettingsBag;
}
