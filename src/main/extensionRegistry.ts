import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { createRequire } from 'module';
import type {
  Extension,
  ExtensionManifest,
  ExtensionToolDef,
} from '../extensions/types';
import {
  BUILT_IN_EXTENSION_IDS,
  OFFICIAL_EXTENSION_IDS,
  isBuiltInExtensionId,
  isOfficialExtensionId,
  isReservedExtensionId,
} from '../extensions/extensionTypes';
import {
  tools as timeTools,
  manifest as timeManifest,
} from '../extensions/time';
import {
  tools as filesystemTools,
  manifest as filesystemManifest,
} from '../extensions/filesystem';
import { tools as gitTools, manifest as gitManifest } from '../extensions/git';
import {
  tools as memoryTools,
  manifest as memoryManifest,
} from '../extensions/memory';
import {
  tools as pythonTools,
  manifest as pythonManifest,
} from '../extensions/python';
import {
  tools as shellTools,
  manifest as shellManifest,
} from '../extensions/shell';
import {
  tools as userpromptsTools,
  manifest as userpromptsManifest,
} from '../extensions/userprompts';
import {
  tools as ddgSearchTools,
  manifest as ddgSearchManifest,
} from '../extensions/ddg_search';
import {
  tools as sandboxTools,
  manifest as sandboxManifest,
} from '../extensions/sandbox';
import {
  tools as githubTools,
  manifest as githubManifest,
} from '../extensions/github';
// eslint-disable-next-line import/no-cycle
import {
  tools as sessionsTools,
  manifest as sessionsManifest,
} from '../extensions/sessions';

const BUILT_IN_EXTENSIONS: Array<{
  tools: Record<string, ExtensionToolDef>;
  manifest: ExtensionManifest;
}> = [
  { tools: timeTools, manifest: timeManifest as ExtensionManifest },
  { tools: filesystemTools, manifest: filesystemManifest as ExtensionManifest },
  { tools: gitTools, manifest: gitManifest as ExtensionManifest },
  { tools: memoryTools, manifest: memoryManifest as ExtensionManifest },
  { tools: pythonTools, manifest: pythonManifest as ExtensionManifest },
  { tools: shellTools, manifest: shellManifest as ExtensionManifest },
  {
    tools: userpromptsTools,
    manifest: userpromptsManifest as ExtensionManifest,
  },
  { tools: ddgSearchTools, manifest: ddgSearchManifest as ExtensionManifest },
  { tools: sandboxTools, manifest: sandboxManifest as ExtensionManifest },
  { tools: sessionsTools, manifest: sessionsManifest as ExtensionManifest },
];

const OFFICIAL_EXTENSIONS: Array<{
  tools: Record<string, ExtensionToolDef>;
  manifest: ExtensionManifest;
}> = [{ tools: githubTools, manifest: githubManifest as ExtensionManifest }];

function getOfficialSettingsPath(): string {
  return path.join(
    app.getPath('userData'),
    'extension-settings',
    'official-extensions.json',
  );
}

function loadAddedOfficialIds(): string[] {
  try {
    const filePath = getOfficialSettingsPath();
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    const added = (raw as { added?: unknown }).added;
    if (!Array.isArray(added)) return [];
    return added.filter(
      (id): id is string => typeof id === 'string' && isOfficialExtensionId(id),
    );
  } catch {
    return [];
  }
}

function saveAddedOfficialIds(ids: string[]): void {
  try {
    const filePath = getOfficialSettingsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const unique = [...new Set(ids)].filter((id) => isOfficialExtensionId(id));
    fs.writeFileSync(
      filePath,
      JSON.stringify({ added: unique }, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.error('[Extensions] Failed to persist official extensions:', err);
  }
}

// Strip any manifest-authored type flags; recompute from hardcoded lists.
// Built-ins are both builtIn AND official (badge is visual only — they stay
// installed, non-removable, in the built-in section). Only addable official
// IDs (github) can enter/leave via the catalog.
function normalizeManifest(
  input: Record<string, any>,
  iconSvgData?: string,
): ExtensionManifest {
  const rest: Record<string, any> = { ...input };
  // Discard untrusted type flags — hardcoded allowlists decide (extensionTypes.ts).
  delete rest.builtIn;
  delete rest.official;
  const id = String((rest as { id?: unknown }).id ?? '');
  const builtIn = isBuiltInExtensionId(id);
  return {
    ...(rest as unknown as ExtensionManifest),
    builtIn,
    official: builtIn || isOfficialExtensionId(id),
    ...(iconSvgData !== undefined ? { iconSvgData } : {}),
  };
}

class ExtensionRegistry {
  private extensions: Map<string, Extension> = new Map();
  private userExtensionsDir: string;

  constructor() {
    this.userExtensionsDir = path.join(app.getPath('userData'), 'extensions');
    this.registerBuiltIn();
    this.ensureUserExtensionsDir();
    this.loadUserExtensions();
    this.loadPersistedOfficialExtensions();
  }

  private registerBuiltIn(): void {
    const builtInDir = path.join(app.getAppPath(), 'src', 'extensions');
    for (const ext of BUILT_IN_EXTENSIONS) {
      const rawId = String((ext.manifest as { id?: unknown }).id ?? '');
      // Defensive: only allowlisted IDs can register as built-in.
      if (!isBuiltInExtensionId(rawId)) {
        console.warn(
          `[Extensions] Skipping non-allowlisted built-in candidate "${rawId}"`,
        );
        continue;
      }
      const iconSvgData = this.loadSvgIcon(
        path.join(builtInDir, rawId),
        ext.manifest.icon,
      );
      const manifest = normalizeManifest(
        ext.manifest as unknown as Record<string, any>,
        iconSvgData,
      );
      this.extensions.set(manifest.id, {
        manifest,
        tools: ext.tools,
        enabled: true,
      });
    }
  }

  private registerOfficialById(id: string): boolean {
    if (!isOfficialExtensionId(id)) return false;
    if (this.extensions.has(id)) return true;
    const found = OFFICIAL_EXTENSIONS.find(
      (e) => String((e.manifest as { id?: unknown }).id) === id,
    );
    if (!found) return false;
    const builtInDir = path.join(app.getAppPath(), 'src', 'extensions');
    const iconSvgData = this.loadSvgIcon(
      path.join(builtInDir, id),
      found.manifest.icon,
    );
    const manifest = normalizeManifest(
      found.manifest as unknown as Record<string, any>,
      iconSvgData,
    );
    this.extensions.set(manifest.id, {
      manifest,
      tools: found.tools,
      enabled: true,
    });
    return true;
  }

  private loadPersistedOfficialExtensions(): void {
    for (const id of loadAddedOfficialIds()) {
      try {
        this.registerOfficialById(id);
      } catch (err) {
        console.error(
          `[Extensions] Failed to restore official extension "${id}":`,
          err,
        );
      }
    }
  }

  getOfficialCatalog(): Array<{
    manifest: ExtensionManifest;
    tools: Record<string, ExtensionToolDef>;
    added: boolean;
    enabled: boolean;
  }> {
    const builtInDir = path.join(app.getAppPath(), 'src', 'extensions');
    return OFFICIAL_EXTENSION_IDS.map((id) => {
      const registered = this.extensions.get(id);
      if (registered) {
        return {
          manifest: registered.manifest,
          tools: registered.tools,
          added: true,
          enabled: registered.enabled,
        };
      }
      const found = OFFICIAL_EXTENSIONS.find(
        (e) => String((e.manifest as { id?: unknown }).id) === id,
      );
      if (!found) {
        throw new Error(`Official extension "${id}" has no bundled code`);
      }
      const iconSvgData = this.loadSvgIcon(
        path.join(builtInDir, id),
        found.manifest.icon,
      );
      return {
        manifest: normalizeManifest(
          found.manifest as unknown as Record<string, any>,
          iconSvgData,
        ),
        tools: found.tools,
        added: false,
        enabled: false,
      };
    });
  }

  addOfficialExtension(id: string): { success: boolean; error?: string } {
    if (!isOfficialExtensionId(id)) {
      return {
        success: false,
        error: `Extension "${id}" is not an official extension`,
      };
    }
    if (this.extensions.has(id)) {
      // Already added — ensure persisted and enabled.
      const ext = this.extensions.get(id);
      if (ext && !ext.enabled) ext.enabled = true;
      const current = loadAddedOfficialIds();
      if (!current.includes(id)) saveAddedOfficialIds([...current, id]);
      return { success: true };
    }
    const ok = this.registerOfficialById(id);
    if (!ok) {
      return {
        success: false,
        error: `Official extension "${id}" is not bundled`,
      };
    }
    saveAddedOfficialIds([...loadAddedOfficialIds(), id]);
    return { success: true };
  }

  private ensureUserExtensionsDir(): void {
    try {
      if (!fs.existsSync(this.userExtensionsDir)) {
        fs.mkdirSync(this.userExtensionsDir, { recursive: true });
      }
    } catch {
      console.error('[Extensions] Failed to create user extensions directory');
    }
  }

  private loadUserExtensions(): void {
    try {
      if (!fs.existsSync(this.userExtensionsDir)) return;
      const entries = fs.readdirSync(this.userExtensionsDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        this.loadExtensionFromDir(
          path.join(this.userExtensionsDir, entry.name),
        );
      }
    } catch (err) {
      console.error('[Extensions] Failed to load user extensions:', err);
    }
  }

  private loadSvgIcon(extDir: string, icon: string): string | undefined {
    try {
      if (!icon.toLowerCase().endsWith('.svg')) return undefined;
      const svgPath = path.isAbsolute(icon) ? icon : path.join(extDir, icon);
      if (!fs.existsSync(svgPath)) return undefined;
      const svgContent = fs.readFileSync(svgPath, 'base64');
      return `data:image/svg+xml;base64,${svgContent}`;
    } catch {
      return undefined;
    }
  }

  private loadExtensionFromDir(extDir: string): void {
    try {
      const manifestPath = path.join(extDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return;
      const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(manifestRaw) as Record<string, any>;
      const rawId = String((parsed as { id?: unknown }).id ?? '');
      if (!rawId) return;
      // Reserved IDs can never come from the user extensions dir.
      if (isReservedExtensionId(rawId)) {
        console.warn(
          `[Extensions] Ignoring user extension with reserved id "${rawId}" at ${extDir}`,
        );
        return;
      }
      if (this.extensions.has(rawId)) {
        console.warn(
          `[Extensions] Extension "${rawId}" already registered, skipping`,
        );
        return;
      }
      const tools: Record<string, ExtensionToolDef> = {};
      const indexJsPath = path.join(extDir, 'index.js');
      if (fs.existsSync(indexJsPath)) {
        const require = createRequire(indexJsPath);
        const extModule = require(indexJsPath);
        if (extModule.tools) {
          for (const [name, tool] of Object.entries<ExtensionToolDef>(
            extModule.tools,
          )) {
            tools[name] = tool;
          }
        }
      }
      const iconSvgData = this.loadSvgIcon(extDir, String(parsed.icon ?? ''));
      const manifest = normalizeManifest(parsed, iconSvgData);
      this.extensions.set(manifest.id, {
        manifest,
        tools,
        enabled: true,
        extensionDir: extDir,
      });
    } catch (err) {
      console.error(
        `[Extensions] Failed to load extension from ${extDir}:`,
        err,
      );
    }
  }

  getAllTools(): Record<string, ExtensionToolDef> {
    const allTools: Record<string, ExtensionToolDef> = {};
    for (const ext of this.extensions.values()) {
      if (!ext.enabled) continue;
      for (const [name, tool] of Object.entries(ext.tools)) {
        allTools[name] = tool;
      }
    }
    return allTools;
  }

  getExtensions(): Extension[] {
    return Array.from(this.extensions.values());
  }

  getEnabledExtensions(): Extension[] {
    return Array.from(this.extensions.values()).filter((e) => e.enabled);
  }

  getExtension(id: string): Extension | undefined {
    return this.extensions.get(id);
  }

  getUserExtensionsDir(): string {
    return this.userExtensionsDir;
  }

  isExtensionEnabled(id: string): boolean {
    return this.extensions.get(id)?.enabled ?? false;
  }

  setExtensionEnabled(id: string, enabled: boolean): void {
    const ext = this.extensions.get(id);
    if (ext) {
      ext.enabled = enabled;
    }
  }

  installExtension(sourcePath: string): { success: boolean; error?: string } {
    try {
      const sourceManifestPath = path.join(sourcePath, 'manifest.json');
      if (!fs.existsSync(sourceManifestPath)) {
        return {
          success: false,
          error: 'No manifest.json found in the extension directory',
        };
      }
      const manifestRaw = fs.readFileSync(sourceManifestPath, 'utf-8');
      const parsed = JSON.parse(manifestRaw) as Record<string, any>;
      const rawId = String((parsed as { id?: unknown }).id ?? '');
      if (!rawId) {
        return { success: false, error: 'Extension manifest is missing an id' };
      }
      // Block spoofing / collisions with hardcoded IDs.
      if (isReservedExtensionId(rawId)) {
        return {
          success: false,
          error: `Extension id "${rawId}" is reserved. Use Add Extensions for official extensions.`,
        };
      }
      if (this.extensions.has(rawId)) {
        return {
          success: false,
          error: `Extension "${rawId}" is already installed`,
        };
      }
      const destDir = path.join(this.userExtensionsDir, rawId);
      if (fs.existsSync(destDir)) {
        return {
          success: false,
          error: `Extension directory already exists at ${destDir}`,
        };
      }
      this.copyDirSync(sourcePath, destDir);
      this.loadExtensionFromDir(destDir);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  removeExtension(idOrName: string): { success: boolean; error?: string } {
    let ext = this.extensions.get(idOrName);
    // Fall back to searching by manifest name if direct ID lookup fails
    if (!ext) {
      for (const [, e] of this.extensions) {
        if (e.manifest.name === idOrName || e.manifest.id === idOrName) {
          ext = e;
          break;
        }
      }
    }
    if (!ext)
      return { success: false, error: `Extension "${idOrName}" not found` };
    const isOfficial = isOfficialExtensionId(ext.manifest.id);
    const isBuiltIn = isBuiltInExtensionId(ext.manifest.id);
    if (isBuiltIn && !isOfficial)
      return { success: false, error: 'Cannot remove built-in extension' };
    try {
      if (isOfficial) {
        // Official extensions are bundled — "remove" means unregister and
        // drop from the persisted added list (returns to the catalog).
        this.extensions.delete(ext.manifest.id);
        saveAddedOfficialIds(
          loadAddedOfficialIds().filter((id) => id !== ext!.manifest.id),
        );
        return { success: true };
      }
      const extDir =
        ext.extensionDir || path.join(this.userExtensionsDir, ext.manifest.id);
      if (fs.existsSync(extDir)) {
        fs.rmSync(extDir, { recursive: true, force: true });
      }
      this.extensions.delete(ext.manifest.id);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

let instance: ExtensionRegistry | null = null;

export function getExtensionRegistry(): ExtensionRegistry {
  if (!instance) {
    instance = new ExtensionRegistry();
  }
  return instance;
}

export { ExtensionRegistry, BUILT_IN_EXTENSION_IDS, OFFICIAL_EXTENSION_IDS };
