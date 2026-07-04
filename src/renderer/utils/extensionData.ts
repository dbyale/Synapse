type ToolMeta = {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  descriptionForModel?: string;
  icon: string;
};

type ExtensionInfo = {
  manifest: {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    icon: string;
    builtIn: boolean;
  };
  tools: Record<string, { meta: ToolMeta; params: Record<string, any> }>;
  enabled: boolean;
};

let cachedExtensions: ExtensionInfo[] | null = null;
let cachedAllTools: Record<string, { meta: ToolMeta; params: Record<string, any> }> | null = null;

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
  cachedAllTools = null;
}
