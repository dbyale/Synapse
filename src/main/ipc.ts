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
} from '../renderer/utils/models';
import type { SearchFilter } from '../renderer/preload.d';

const execAsync = util.promisify(exec);

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

  ipcMain.handle(
    'models:download',
    async (event, repoId: string, filename: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error('No window found');
      return downloadModel(repoId, filename, win);
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

  // ── Unified Hardware Stats ──
  ipcMain.handle('get-vram-stats', async () => {
    console.log('--- STARTING HARDWARE DETECTION ---');

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

      console.log('[HW] GPU List:', JSON.stringify(gpuList, null, 2));

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
          console.log(`[HW] NVIDIA-SMI Success: ${cmd}`);
          console.log(`[HW] NVIDIA Raw Output: ${stdout.trim()}`);

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

      console.log('[HW] Final hardware result:', JSON.stringify(result, null, 2));
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
}
