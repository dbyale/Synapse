import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import os from 'os';
import util from 'util';
import { exec } from 'child_process';
import si from 'systeminformation';
import { loadSettings, saveSettings, AppSettings } from './settings';
import {
  searchModels,
  listModelFiles,
  downloadModel,
  listLocalModels,
  deleteLocalModel,
  cancelDownload,
  registerLocalModel
} from '../renderer/utils/models';
import * as chatService from './chat';
import type { SearchFilter } from '../renderer/preload.d';

const execAsync = util.promisify(exec);

// The 'win' parameter is no longer needed for the chat handler, but may be used by others.
export function registerIpcHandlers(win: BrowserWindow): void {
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
  ipcMain.handle(
    'models:search',
    async (
      _event,
      query: string,
      filters: SearchFilter[],
      sort: string,
      direction: number,
      limit: number
    ) => {
      return searchModels(query, filters, sort, direction, limit);
    }
  );

  ipcMain.handle('models:list-files', (_event, repoId: string) => {
    return listModelFiles(repoId);
  });

  // ── Browse for files via native dialog ──────────────────────────────────────
  ipcMain.handle(
    'browse-for-files',
    async (
      _event,
      options: {
        title: string;
        filters?: { name: string; extensions: string[] }[];
        multiSelections?: boolean;
      },
    ) => {
      const properties: Electron.OpenDialogOptions['properties'] = ['openFile'];
      if (options.multiSelections) properties.push('multiSelections');

      const result = await dialog.showOpenDialog({
        title: options.title,
        filters: options.filters ?? [],
        properties,
      });

      return result.canceled ? [] : result.filePaths;
    },
  );

  ipcMain.handle(
    'register-local-model',
    async (
      _event,
      payload: {
        name: string;
        author: string;
        modelPaths: string[];
        projectorPaths: string[];
      },
    ) => {
      try {
        const result = registerLocalModel(payload);
        return result;
      } catch (err: any) {
        console.error('Failed to register local model:', err);
        throw new Error(err.message || 'Failed to register local model');
      }
    },
  );


  ipcMain.handle(
    'models:download',
    async (event, repoId: string, filename: string) => {
      const downloadWin = BrowserWindow.fromWebContents(event.sender);
      if (!downloadWin) throw new Error('No window found');
      return downloadModel(repoId, filename, downloadWin);
    }
  );

  ipcMain.handle('models:cancel-download', async (_event, filename: string) => {
    return cancelDownload(filename);
  });

  // ── Models: Local ──
  ipcMain.handle('models:list-local', () => {
    return listLocalModels();
  });

  ipcMain.handle('models:delete', (_event, filename: string) => {
    return deleteLocalModel(filename);
  });

  // ── Chat ──
  ipcMain.handle('chat:load', async (_event, filepath: string) => {
    try {
      await chatService.loadModel(filepath);
      return { success: true };
    } catch (err: any) {
      console.error('[chat:load]', err);
      return { success: false, error: err.message };
    }
  });

  // ====================================================================
  // THIS IS THE CORRECTED HANDLER
  // ====================================================================
  ipcMain.handle('chat:send', async (event, text: string) => {
    try {
      // Define the callback function that uses `event.sender`
      const onTokenCallback = (token: string) => {
        // Always use event.sender to reply to the correct window.
        // Add a check to prevent errors if the window is closed during generation.
        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:token', token);
        }
      };

      // Pass the reliable callback to the chat service
      await chatService.sendMessage(text, onTokenCallback);

      // Send the 'done' signal using the reliable event.sender
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:done');
      }

      return { success: true };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:done');
        }
        return { success: true, aborted: true };
      }
      console.error('[chat:send]', err);
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:done');
        // It's also good practice to send the error back to the frontend
        event.sender.send('chat:error', err.message);
      }
      return { success: false, error: err.message };
    }
  });
  // ====================================================================

  ipcMain.handle('chat:abort', async () => {
    chatService.abort();
  });

  ipcMain.handle('chat:unload', async () => {
    await chatService.unloadModel();
  });

  ipcMain.handle('chat:tokenize', async (_event, text: string) => {
    try {
      const count = await chatService.tokenize(text);
      return { count };
    } catch (error: any) {
      return { count: null, error: error.message };
    }
  });

  ipcMain.handle('chat:contextSize', () => {
    return { contextSize: chatService.getContextSize() };
  });

  // ── Unified Hardware Stats ──
  ipcMain.handle('get-vram-stats', async () => {

    try {
      const toMB = (bytes: number) => Math.round(bytes / (1024 * 1024));

      // ---------------------------------------------------------------------
      // SYSTEM RAM
      // ---------------------------------------------------------------------
      const totalRamBytes = os.totalmem();
      const freeRamBytes = os.freemem();

      const metrics = app.getAppMetrics();
      const appUsedKB = metrics.reduce(
        (acc, metric) => acc + metric.memory.workingSetSize,
        0
      );
      const appUsedBytes = appUsedKB * 1024;
      const otherRamUsedBytes = totalRamBytes - freeRamBytes - appUsedBytes;

      const totalRam = toMB(totalRamBytes);
      const appUsedRam = toMB(appUsedBytes);
      const otherUsedRam = Math.max(0, toMB(otherRamUsedBytes));
      const recommendedRam = Math.max(0, totalRam - 4096);

      // ---------------------------------------------------------------------
      // APPLE SILICON CHECK
      // ---------------------------------------------------------------------
      const cpu = await si.cpu();
      const isAppleSilicon =
        process.platform === 'darwin' && cpu.vendor === 'Apple';

      // ---------------------------------------------------------------------
      // GPU INVENTORY
      // ---------------------------------------------------------------------
      const graphics = await si.graphics();
      const gpuList = (graphics.controllers || []).map((gpu, index) => ({
        id: `${index}`,
        vendor: gpu.vendor || 'Unknown',
        model: gpu.model || 'Unknown',
        bus: gpu.bus || '',
        vram: parseInt(String(gpu.vram), 10) || 0,
        vramDynamic:
          typeof gpu.vramDynamic === 'boolean'
            ? gpu.vramDynamic
            : String(gpu.vramDynamic).toLowerCase() === 'true',
        driverVersion: gpu.driverVersion || '',
        busAddress: gpu.busAddress || '',
      }));

      // ---------------------------------------------------------------------
      // SELECT BEST GPU
      // Prefer non-dynamic VRAM, then highest VRAM overall
      // ---------------------------------------------------------------------
      let selectedGpu =
        gpuList
          .filter((gpu) => !gpu.vramDynamic && gpu.vram > 0)
          .sort((a, b) => b.vram - a.vram)[0] ||
        gpuList
          .filter((gpu) => gpu.vram > 0)
          .sort((a, b) => b.vram - a.vram)[0] ||
        null;

      // ---------------------------------------------------------------------
      // NVIDIA REAL USAGE OVERRIDE
      // If nvidia-smi works, use it for usage and possibly total.
      // ---------------------------------------------------------------------
      let detectedVramTotal = selectedGpu?.vram || 0;
      let detectedVramUsed = selectedGpu ? 500 : 0;

      const nvidiaCommands = [
        'nvidia-smi --query-gpu=memory.total,memory.used --format=csv,noheader,nounits',
        '"C:\\Windows\\System32\\nvidia-smi.exe" --query-gpu=memory.total,memory.used --format=csv,noheader,nounits',
        '"C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe" --query-gpu=memory.total,memory.used --format=csv,noheader,nounits',
      ];

      for (const cmd of nvidiaCommands) {
        try {
          const { stdout } = await execAsync(cmd);

          const firstLine = stdout.trim().split('\n')[0];
          const parts = firstLine.split(',');

          if (parts.length >= 2) {
            const total = parseInt(parts[0].trim(), 10) || 0;
            const used = parseInt(parts[1].trim(), 10) || 0;

            if (total > 0) {
              detectedVramTotal = total;
              detectedVramUsed = used;

              if (!selectedGpu) {
                selectedGpu = {
                  id: 'nvidia-0',
                  vendor: 'NVIDIA',
                  model: 'NVIDIA GPU',
                  bus: '',
                  vram: total,
                  vramDynamic: false,
                  driverVersion: '',
                  busAddress: '',
                };
              }

              break;
            }
          }
        } catch (e: any) {
          console.log(
            `[HW] NVIDIA-SMI failed for cmd: ${cmd}. Reason: ${
              e?.message?.split('\n')[0] || 'Unknown error'
            }`
          );
        }
      }

      // ---------------------------------------------------------------------
      // UNIFIED RESPONSE
      // ---------------------------------------------------------------------
      const result = {
        isUnifiedMemory: isAppleSilicon,
        ram: {
          total: totalRam,
          appCurrentUsage: appUsedRam,
          otherUsed: otherUsedRam,
          maxRecommended: recommendedRam,
        },
        vram: selectedGpu
          ? {
              total: detectedVramTotal,
              otherUsed: detectedVramUsed,
              maxRecommended: Math.max(0, detectedVramTotal - 500),
            }
          : null,
        gpus: gpuList,
        selectedGpu,
      };

      return result;
    } catch (error) {
      console.error('[HW] Fatal error during hardware detection:', error);
      return {
        isUnifiedMemory: false,
        ram: {
          total: 0,
          appCurrentUsage: 0,
          otherUsed: 0,
          maxRecommended: 0,
        },
        vram: null,
        gpus: [],
        selectedGpu: null,
      };
    }
  });

  ipcMain.handle('chat:memoryUsage', () => {
    return chatService.getModelMemoryUsage();
  });
}
