// ── Extension type allowlists ──
// Single source of truth for which extension IDs are built-in vs official.
// Manifest `builtIn` / `official` fields (if present on disk) are IGNORED —
// these sets decide. This prevents any external extension from labeling
// itself as Official or Built-in via its own manifest.json.
//
// - BUILT_IN: always installed, never add/remove, stay in the built-in section.
//   They are also considered official for badge purposes (visual only).
// - OFFICIAL (addable catalog): opt-in bundled extensions (currently github only).
//   Only these appear in the Add Extensions modal and can move sections.

export const BUILT_IN_EXTENSION_IDS: readonly string[] = [
  'time',
  'filesystem',
  'git',
  'memory',
  'python',
  'shell',
  'userprompts',
  'ddg_search',
  'sandbox',
  'sessions',
];

export const OFFICIAL_EXTENSION_IDS: readonly string[] = ['github'];

const BUILT_IN_SET = new Set<string>(BUILT_IN_EXTENSION_IDS);
const OFFICIAL_SET = new Set<string>(OFFICIAL_EXTENSION_IDS);

export function isBuiltInExtensionId(id: string): boolean {
  return BUILT_IN_SET.has(id);
}

export function isOfficialExtensionId(id: string): boolean {
  return OFFICIAL_SET.has(id);
}

// Visual-only badge: built-ins count as official for display, but they are
// never addable/removable and never leave the built-in section.
export function isOfficialBadgeId(id: string): boolean {
  return BUILT_IN_SET.has(id) || OFFICIAL_SET.has(id);
}

export function isAddableOfficialId(id: string): boolean {
  return OFFICIAL_SET.has(id) && !BUILT_IN_SET.has(id);
}

export function isReservedExtensionId(id: string): boolean {
  return BUILT_IN_SET.has(id) || OFFICIAL_SET.has(id);
}
