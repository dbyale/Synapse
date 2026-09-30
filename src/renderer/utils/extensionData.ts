export type ToolMeta = {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  descriptionForModel?: string;
  icon: string;
  displayType?: string;
  tags?: string[];
};

export type ExtensionInfo = {
  manifest: {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    icon: string;
    builtIn: boolean;
    // Server-computed from hardcoded allowlists. Never set from manifest.json.
    official?: boolean;
    iconSvgData?: string;
    hasSettings?: boolean;
  };
  tools: Record<string, { meta: ToolMeta; params: Record<string, any> }>;
  enabled: boolean;
  extensionDir?: string;
};

export type OfficialExtensionInfo = ExtensionInfo & {
  added: boolean;
};

let cachedExtensions: ExtensionInfo[] | null = null;
let cachedOfficialExtensions: OfficialExtensionInfo[] | null = null;
let cachedAllTools: Record<
  string,
  { meta: ToolMeta; params: Record<string, any> }
> | null = null;

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export function subscribeExtensionData(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function fetchExtensionData(): Promise<void> {
  if (!window.electronAPI) return;
  try {
    const [extensions, allTools] = await Promise.all([
      window.electronAPI.extensionsList(),
      window.electronAPI.extensionsGetAllTools(),
    ]);
    cachedExtensions = extensions;
    cachedAllTools = allTools;
  } catch {
    cachedExtensions = [];
    cachedAllTools = {};
  }
  notifyListeners();
}

export async function fetchOfficialExtensions(): Promise<
  OfficialExtensionInfo[]
> {
  if (!window.electronAPI?.extensionsListOfficial) return [];
  try {
    const official = await window.electronAPI.extensionsListOfficial();
    cachedOfficialExtensions = official;
    return official;
  } catch {
    return cachedOfficialExtensions ?? [];
  }
}

export function getOfficialExtensions(): OfficialExtensionInfo[] {
  return cachedOfficialExtensions ?? [];
}

export function isOfficialExtension(manifest: { official?: boolean }): boolean {
  // Server-computed flag only — never infer from id or manifest.json content.
  // True for addable officials AND built-ins (built-ins show the badge visually only).
  return manifest.official === true;
}

export function isAddableOfficialExtension(manifest: {
  official?: boolean;
  builtIn?: boolean;
}): boolean {
  // Only opt-in officials (github) — built-ins are excluded so they never
  // change sections and are never add/removable despite showing the badge.
  return manifest.official === true && manifest.builtIn !== true;
}

export function getExtensions(): ExtensionInfo[] {
  return cachedExtensions ?? [];
}

export function getEnabledExtensions(): ExtensionInfo[] {
  return (cachedExtensions ?? []).filter((e) => e.enabled);
}

export function getExtensionById(id: string): ExtensionInfo | undefined {
  return (cachedExtensions ?? []).find((e) => e.manifest.id === id);
}

export function getAllToolMetas(): Record<string, ToolMeta> {
  const result: Record<string, ToolMeta> = {};
  if (cachedAllTools) {
    for (const [name, tool] of Object.entries(cachedAllTools)) {
      result[name] = tool.meta;
    }
  }
  return result;
}

export function getAvailableToolNames(): string[] {
  return Object.keys(cachedAllTools ?? {});
}

export function getToolMeta(name: string): ToolMeta | undefined {
  return cachedAllTools?.[name]?.meta;
}

export function getCategorizedExtensions(): Array<{
  extension: ExtensionInfo;
  toolKeys: string[];
}> {
  return (cachedExtensions ?? [])
    .filter((e) => e.enabled)
    .map((ext) => ({
      extension: ext,
      toolKeys: Object.keys(ext.tools),
    }));
}

export function invalidateCache(): void {
  cachedExtensions = null;
  cachedOfficialExtensions = null;
  cachedAllTools = null;
}
