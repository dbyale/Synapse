import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { createRequire } from 'module';
import type { Extension, ExtensionManifest, ExtensionToolDef } from '../extensions/types';
import { tools as timeTools, manifest as timeManifest } from '../extensions/time';
import { tools as webTools, manifest as webManifest } from '../extensions/web';
import { tools as filesystemTools, manifest as filesystemManifest } from '../extensions/filesystem';
import { tools as gitTools, manifest as gitManifest } from '../extensions/git';
import { tools as memoryTools, manifest as memoryManifest } from '../extensions/memory';
import { tools as pythonTools, manifest as pythonManifest } from '../extensions/python';
import { tools as shellTools, manifest as shellManifest } from '../extensions/shell';
import { tools as userpromptsTools, manifest as userpromptsManifest } from '../extensions/userprompts';

const BUILT_IN_EXTENSIONS: Array<{ tools: Record<string, ExtensionToolDef>; manifest: ExtensionManifest }> = [
  { tools: timeTools, manifest: timeManifest as ExtensionManifest },
  { tools: webTools, manifest: webManifest as ExtensionManifest },
  { tools: filesystemTools, manifest: filesystemManifest as ExtensionManifest },
  { tools: gitTools, manifest: gitManifest as ExtensionManifest },
  { tools: memoryTools, manifest: memoryManifest as ExtensionManifest },
  { tools: pythonTools, manifest: pythonManifest as ExtensionManifest },
  { tools: shellTools, manifest: shellManifest as ExtensionManifest },
  { tools: userpromptsTools, manifest: userpromptsManifest as ExtensionManifest },
];

class ExtensionRegistry {
  private extensions: Map<string, Extension> = new Map();
  private userExtensionsDir: string;

  constructor() {
    this.userExtensionsDir = path.join(app.getPath('userData'), 'extensions');
    this.registerBuiltIn();
    this.ensureUserExtensionsDir();
    this.loadUserExtensions();
  }

  private registerBuiltIn(): void {
    for (const ext of BUILT_IN_EXTENSIONS) {
      const manifest = ext.manifest;
      this.extensions.set(manifest.id, {
        manifest: { ...manifest, builtIn: true },
        tools: ext.tools,
        enabled: true,
      });
    }
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
      const entries = fs.readdirSync(this.userExtensionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        this.loadExtensionFromDir(path.join(this.userExtensionsDir, entry.name));
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
      const manifest: ExtensionManifest = JSON.parse(manifestRaw);
      if (this.extensions.has(manifest.id)) {
        console.warn(`[Extensions] Extension "${manifest.id}" already registered, skipping`);
        return;
      }
      const tools: Record<string, ExtensionToolDef> = {};
      const indexJsPath = path.join(extDir, 'index.js');
      if (fs.existsSync(indexJsPath)) {
        const require = createRequire(indexJsPath);
        const extModule = require(indexJsPath);
        if (extModule.tools) {
          for (const [name, tool] of Object.entries<ExtensionToolDef>(extModule.tools)) {
            tools[name] = tool;
          }
        }
      }
      const iconSvgData = this.loadSvgIcon(extDir, manifest.icon);
      this.extensions.set(manifest.id, {
        manifest: { ...manifest, builtIn: false, iconSvgData },
        tools,
        enabled: true,
      });
    } catch (err) {
      console.error(`[Extensions] Failed to load extension from ${extDir}:`, err);
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
        return { success: false, error: 'No manifest.json found in the extension directory' };
      }
      const manifestRaw = fs.readFileSync(sourceManifestPath, 'utf-8');
      const manifest: ExtensionManifest = JSON.parse(manifestRaw);
      if (this.extensions.has(manifest.id)) {
        return { success: false, error: `Extension "${manifest.id}" is already installed` };
      }
      const destDir = path.join(this.userExtensionsDir, manifest.id);
      if (fs.existsSync(destDir)) {
        return { success: false, error: `Extension directory already exists at ${destDir}` };
      }
      this.copyDirSync(sourcePath, destDir);
      this.loadExtensionFromDir(destDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  removeExtension(id: string): { success: boolean; error?: string } {
    const ext = this.extensions.get(id);
    if (!ext) return { success: false, error: `Extension "${id}" not found` };
    if (ext.manifest.builtIn) return { success: false, error: 'Cannot remove built-in extension' };
    try {
      const extDir = path.join(this.userExtensionsDir, id);
      if (fs.existsSync(extDir)) {
        fs.rmSync(extDir, { recursive: true, force: true });
      }
      this.extensions.delete(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
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

export { ExtensionRegistry };
