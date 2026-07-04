import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { getExtensionRegistry } from './extensionRegistry';

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

  ipcMain.handle('extensions:toggle', (_event, id: string, enabled: boolean) => {
    registry.setExtensionEnabled(id, enabled);
    return { success: true };
  });

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
}
