import { ipcMain, dialog, BrowserWindow } from 'electron';
import {
  loadSettings,
  saveSettings,
  AppSettings,
  ProfileSettings,
} from './settings';
import {
  searchModels,
  listModelFiles,
  downloadModel,
  listLocalModels,
  deleteLocalModel,
} from './models';

export function registerIpcHandlers(): void {
  // ── Settings ──
  ipcMain.handle('settings:load', () => {
    return loadSettings();
  });

  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    saveSettings(settings);
    return true;
  });

  ipcMain.handle('settings:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Models Directory',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ── Models: HuggingFace ──
  ipcMain.handle('models:search', (_event, query: string) => {
    return searchModels(query);
  });

  ipcMain.handle('models:list-files', (_event, repoId: string) => {
    return listModelFiles(repoId);
  });

  ipcMain.handle(
    'models:download',
    async (event, repoId: string, filename: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return downloadModel(repoId, filename, win);
    }
  );

  // ── Models: Local ──
  ipcMain.handle('models:list-local', () => {
    return listLocalModels();
  });

  ipcMain.handle('models:delete', (_event, filename: string) => {
    return deleteLocalModel(filename);
  });
}
