/* eslint-disable import/prefer-default-export */
import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getExtensionRegistry } from './extensionRegistry';
import { setAllowedDirectories, setMaxReadSize } from './functions/fileSystem';
import { setSandboxMaxReadSize } from './functions/sandboxRunner';

const EXTENSION_SETTINGS_DIR = path.join(
  app.getPath('userData'),
  'extension-settings',
);

function ensureSettingsDir(): void {
  if (!fs.existsSync(EXTENSION_SETTINGS_DIR)) {
    fs.mkdirSync(EXTENSION_SETTINGS_DIR, { recursive: true });
  }
}

function loadExtensionSettings(id: string): Record<string, any> {
  ensureSettingsDir();
  const filePath = path.join(EXTENSION_SETTINGS_DIR, `${id}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // settings file doesn't exist or is invalid
  }
  return {};
}

function saveExtensionSettings(
  id: string,
  settings: Record<string, any>,
): void {
  ensureSettingsDir();
  const filePath = path.join(EXTENSION_SETTINGS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function registerExtensionIpcHandlers(): void {
  const registry = getExtensionRegistry();

  ipcMain.handle('extensions:list', () => {
    const extensions = registry.getExtensions();
    return extensions.map((ext) => ({
      manifest: ext.manifest,
      tools: Object.fromEntries(
        Object.entries(ext.tools).map(([name, tool]) => [
          name,
          { meta: tool.meta, params: tool.params },
        ]),
      ),
      enabled: ext.enabled,
      extensionDir: ext.extensionDir,
    }));
  });

  ipcMain.handle('extensions:install', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window available' };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Extension Directory',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' };
    }
    const sourcePath = result.filePaths[0];
    return registry.installExtension(sourcePath);
  });

  ipcMain.handle('extensions:remove', (_event, id: string) => {
    return registry.removeExtension(id);
  });

  ipcMain.handle(
    'extensions:toggle',
    (_event, id: string, enabled: boolean) => {
      registry.setExtensionEnabled(id, enabled);
      return { success: true };
    },
  );

  ipcMain.handle('extensions:getAllTools', () => {
    const allTools = registry.getAllTools();
    return Object.fromEntries(
      Object.entries(allTools).map(([name, tool]) => [
        name,
        { meta: tool.meta, params: tool.params },
      ]),
    );
  });

  ipcMain.handle('extensions:openFolder', () => {
    const userExtDir = registry.getUserExtensionsDir();
    shell.openPath(userExtDir);
  });

  ipcMain.handle('extensions:getSettings', (_event, id: string) => {
    return loadExtensionSettings(id);
  });

  ipcMain.handle(
    'extensions:setSettings',
    (_event, id: string, settings: any) => {
      saveExtensionSettings(id, settings);
      if (id === 'filesystem') {
        setAllowedDirectories(settings.allowedDirectories || []);
        if (settings.maxReadSize !== undefined) setMaxReadSize(settings.maxReadSize);
      }
      if (id === 'sandbox') {
        if (settings.maxReadSize !== undefined) setSandboxMaxReadSize(settings.maxReadSize);
      }
      return { success: true };
    },
  );

  // Initialize extensions settings on startup
  const fsSettings = loadExtensionSettings('filesystem');
  if (fsSettings.allowedDirectories?.length) {
    setAllowedDirectories(fsSettings.allowedDirectories);
  }
  if (fsSettings.maxReadSize !== undefined) {
    setMaxReadSize(fsSettings.maxReadSize);
  }
  const sbSettings = loadExtensionSettings('sandbox');
  if (sbSettings.maxReadSize !== undefined) {
    setSandboxMaxReadSize(sbSettings.maxReadSize);
  }
}
