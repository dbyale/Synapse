import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron';
import os from 'os';
import * as fs from 'fs';
import path from 'path';
import util from 'util';
import { exec } from 'child_process';
import si from 'systeminformation';
import {
  loadSettings,
  saveSettings,
  AppSettings,
  getModelsDirectory,
} from './settings';
import {
  searchModels,
  listModelFiles,
  downloadModel,
  listLocalModels,
  deleteLocalModel,
  cancelDownload,
  registerLocalModel,
} from '../renderer/utils/models';
import * as chatService from './chat';
import { getOrRunOptimizer, getOrEstimateMemory, getModelMetadata } from './estimator';
import type { SearchFilter } from '../renderer/preload.d';

const execAsync = util.promisify(exec);

interface VramStatsResult {
  isUnifiedMemory: boolean;
  ram: { total: number; appCurrentUsage: number; otherUsed: number; maxRecommended: number };
  vram: { total: number; otherUsed: number; maxRecommended: number } | null;
  gpus: any[];
  selectedGpu: any | null;
}

let vramStatsCache: VramStatsResult | null = null;
let refreshPromise: Promise<void> | null = null;

async function readServerProcessMemoryMB(pid: number): Promise<number> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
      );
      const line = stdout.trim();
      if (!line) return 0;
      const parts = line.split('","');
      const memStr = parts[parts.length - 1]?.replace('"', '').replace(' K', '').replace(/,/g, '');
      const kb = parseInt(memStr, 10);
      return kb ? Math.round(kb / 1024) : 0;
    } else {
      const { stdout } = await execAsync(`ps -o rss= -p ${pid}`);
      const kb = parseInt(stdout.trim(), 10);
      return kb ? Math.round(kb / 1024) : 0;
    }
  } catch {
    return 0;
  }
}

async function readServerProcessVramMB(pid: number): Promise<number> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader',
    );
    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      const [linePid, usedMem] = line.split(', ');
      if (parseInt(linePid, 10) === pid) {
        return parseInt(usedMem, 10) || 0;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

async function computeVramStats(): Promise<VramStatsResult> {
  const toMB = (bytes: number) => Math.round(bytes / (1024 * 1024));

  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();

  const metrics = app.getAppMetrics();
  const appUsedKB = metrics.reduce(
    (acc, metric) => acc + metric.memory.workingSetSize,
    0,
  );
  const appUsedBytes = appUsedKB * 1024;
  let otherRamUsedBytes = totalRamBytes - freeRamBytes - appUsedBytes;

  const serverPid = chatService.getServerPid();
  if (serverPid) {
    const serverRamMB = await readServerProcessMemoryMB(serverPid);
    if (serverRamMB > 0) {
      otherRamUsedBytes = Math.max(0, otherRamUsedBytes - serverRamMB * 1024 * 1024);
    }
  }

  const totalRam = toMB(totalRamBytes);
  const appUsedRam = toMB(appUsedBytes);
  const otherUsedRam = Math.max(0, toMB(otherRamUsedBytes));
  const recommendedRam = Math.max(0, totalRam - 4096);

  const cpu = await si.cpu();
  const isAppleSilicon =
    process.platform === 'darwin' && cpu.vendor === 'Apple';

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

  let selectedGpu =
    gpuList
      .filter((gpu) => !gpu.vramDynamic && gpu.vram > 0)
      .sort((a, b) => b.vram - a.vram)[0] ||
    gpuList
      .filter((gpu) => gpu.vram > 0)
      .sort((a, b) => b.vram - a.vram)[0] ||
    null;

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
        }`,
      );
    }
  }

  if (serverPid && selectedGpu) {
    const serverVramMB = await readServerProcessVramMB(serverPid);
    if (serverVramMB > 0) {
      detectedVramUsed = Math.max(0, detectedVramUsed - serverVramMB);
    }
  }

  return {
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
}

async function refreshVramStatsCache(): Promise<void> {
  try {
    vramStatsCache = await computeVramStats();
  } finally {
    refreshPromise = null;
  }
}

export function registerIpcHandlers(win: BrowserWindow): void {
  // ── Settings ──
  ipcMain.handle('settings:load', () => {
    return loadSettings();
  });

  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    saveSettings(settings);
    return true;
  });

  ipcMain.handle('settings:save-silent', (_event, settings: AppSettings) => {
    saveSettings(settings, true);
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
      limit: number,
    ) => {
      return searchModels(query, filters, sort, direction, limit);
    },
  );

  ipcMain.handle('models:list-files', (_event, repoId: string) => {
    return listModelFiles(repoId);
  });

  // ── Browse for files via native dialog ──
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
      try {
        const downloadWin = BrowserWindow.fromWebContents(event.sender);
        if (!downloadWin) throw new Error('No window found');
        return await downloadModel(repoId, filename, downloadWin);
      } catch (err) {
        console.error('[models:download]', err);
        throw err;
      }
    },
  );

  ipcMain.handle('models:cancel-download', async (_event, repoId: string, filename: string) => {
    return cancelDownload(repoId, filename);
  });

  // ── Models: Local ──
  ipcMain.handle('models:list-local', () => {
    return listLocalModels();
  });

  ipcMain.handle('models:delete', (_event, filename: string) => {
    return deleteLocalModel(filename);
  });

  // ── Chat ──
  ipcMain.handle('chat:loadProfile', async (event, profile: any) => {
    try {
      const result = await chatService.loadProfile(profile, (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:system-status', data);
        }
      });
      if (result.success) {
        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:system-status', {
            phase: 'preloading',
            message: 'Preloading system prompt…',
          });
        }
        // Preload system prompt to warm KV cache, with progress tracking
        await chatService.preloadSystemPrompt(
          profile.systemPrompt,
          chatService.getActiveTools(),
          (data) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('chat:system-progress', data);
            }
          },
          (stats, toolCount) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('chat:system-done', { stats, toolCount });
              event.sender.send('chat:system-status', {
                phase: 'ready',
                message: '',
              });
            }
          },
        );
      }
      return result;
    } catch (err: any) {
      console.error('[chat:loadProfile]', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('chat:getCurrentProfile', () => {
    return chatService.getCurrentProfile();
  });

  ipcMain.handle(
    'chat:send',
    async (event, text: string, contentParts?: { kind: string; url?: string; filePath?: string; text?: string }[]) => {
      try {
        const onTokenCallback = (
          token: string,
          segmentType?: 'thought' | 'comment',
        ) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:token', { token, segmentType });
          }
        };

        const onProgressCallback = (data: {
          progress: number;
          promptN: number;
          promptMs: number;
          total: number;
        }) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:progress', data);
          }
        };

        const onPromptDoneCallback = (stats: {
          tokens: number;
          timeMs: number;
          tokensPerSecond: number;
        }) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:prompt-done', stats);
          }
        };

        const result = await chatService.sendMessage(
          text,
          onTokenCallback,
          contentParts,
          onProgressCallback,
          onPromptDoneCallback,
        );

        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:done', result.stats);
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
          event.sender.send('chat:error', err.message);
        }
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle('chat:abort', async () => {
    await chatService.abort();
  });

  ipcMain.handle('chat:unload', async () => {
    await chatService.unloadModel();
  });

  ipcMain.handle('chat:hasConversation', () => {
    return chatService.hasConversationContext();
  });

  ipcMain.handle('chat:isRunning', () => {
    return chatService.isServerRunning();
  });

  ipcMain.handle('chat:reloadProfile', async (event) => {
    const profile = chatService.getCurrentProfile();
    if (!profile) {
      return { success: false, error: 'No profile loaded' };
    }
    try {
      const result = await chatService.loadProfile(profile, (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:system-status', data);
        }
      });
      if (result.success) {
        if (!event.sender.isDestroyed()) {
          event.sender.send('chat:system-status', {
            phase: 'preloading',
            message: 'Preloading system prompt…',
          });
        }
        await chatService.preloadSystemPrompt(
          profile.systemPrompt,
          chatService.getActiveTools(),
          (data) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('chat:system-progress', data);
            }
          },
          (stats, toolCount) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('chat:system-done', { stats, toolCount });
              event.sender.send('chat:system-status', {
                phase: 'ready',
                message: '',
              });
            }
          },
        );
      }
      return result;
    } catch (err: any) {
      console.error('[chat:reloadProfile]', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('chat:tokenize', async (_event, text: string) => {
    try {
      const count = await chatService.tokenize(text);
      return { count };
    } catch (error: any) {
      return { count: null, error: error.message };
    }
  });

  ipcMain.handle('chat:contextUsage', async () => {
    const usage = chatService.getContextUsage();
    return usage || { used: 0, total: 0 };
  });

  ipcMain.handle('chat:contextSize', () => {
    return { contextSize: chatService.getContextSize() };
  });

  ipcMain.handle('chat:memoryUsage', () => {
    return chatService.getModelMemoryUsage();
  });

  ipcMain.handle('get-server-pid', () => {
    return chatService.getServerPid();
  });

  // ── Unified Hardware Stats ──
  ipcMain.handle('get-vram-stats', async () => {
    if (vramStatsCache) {
      if (!refreshPromise) {
        refreshPromise = refreshVramStatsCache();
      }
      return vramStatsCache;
    }
    try {
      const result = await computeVramStats();
      vramStatsCache = result;
      return result;
    } catch (error) {
      console.error('[HW] Fatal error during hardware detection:', error);
      return {
        isUnifiedMemory: false,
        ram: { total: 0, appCurrentUsage: 0, otherUsed: 0, maxRecommended: 0 },
        vram: null,
        gpus: [],
        selectedGpu: null,
      };
    }
  });

  refreshPromise = refreshVramStatsCache();

  ipcMain.handle('open-models-folder', async () => {
    const modelsDir = getModelsDirectory();
    await shell.openPath(modelsDir);
  });

  chatService.setEmitFunctionCallback(
    (event: 'calling' | 'call' | 'result', name: string, data: string) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;

      if (event === 'calling') {
        // Notify renderer that a function call is initiating, before params are available
        win.webContents.send('chat-function-calling', { name });
      } else if (event === 'call') {
        win.webContents.send('chat-function-call', { name, params: data });
      } else if (event === 'result') {
        win.webContents.send('chat-function-result', {
          name,
          result: data,
        });
      }
    },
  );

  ipcMain.handle('chat:cumulativeTokenUsage', () => {
    return chatService.getCumulativeTokenUsage();
  });

  ipcMain.handle('chat:hasProjector', () => {
    return chatService.hasProjector();
  });

  ipcMain.handle(
    'profile:runOptimizer',
    async (
      _event,
      params: {
        modelAuthor: string;
        modelFolder: string;
        modelFilename: string;
        projectorFilename?: string;
        mode: 'longest-context' | 'most-gpu';
        kvOffload?: boolean;
        mmap?: boolean;
        cacheTypeK?: string;
        cacheTypeV?: string;
      },
    ) => {
      const settings = loadSettings();
      const vramMB = settings.allocatedVRAM ?? 4096;
      const ramMB = settings.allocatedRAM ?? 8192;
      const modelsDir = getModelsDirectory();
      const modelPath = path.join(modelsDir, params.modelAuthor, params.modelFolder, params.modelFilename);
      const projectorPath = params.projectorFilename
        ? path.join(modelsDir, params.modelAuthor, params.modelFolder, 'projectors', params.projectorFilename)
        : undefined;

      const result = await getOrRunOptimizer(
        modelPath,
        vramMB,
        ramMB,
        params.mode === 'most-gpu',
        projectorPath,
        params.kvOffload ?? true,
        params.mmap ?? true,
        params.cacheTypeK ?? 'f16',
        params.cacheTypeV ?? 'f16',
      );

      return {
        ngl: result.ngl,
        ctx: result.ctx,
        vramMB,
        ramMB,
      };
    },
  );

  ipcMain.handle(
    'profile:getModelMetadata',
    async (
      _event,
      params: {
        modelAuthor: string;
        modelFolder: string;
        modelFilename: string;
        projectorFilename?: string;
      },
    ) => {
      const modelsDir = getModelsDirectory();
      const modelPath = path.join(modelsDir, params.modelAuthor, params.modelFolder, params.modelFilename);
      const projectorPath = params.projectorFilename
        ? path.join(modelsDir, params.modelAuthor, params.modelFolder, 'projectors', params.projectorFilename)
        : undefined;
      return getModelMetadata(modelPath, projectorPath);
    },
  );

  ipcMain.handle(
    'profile:estimateMemory',
    async (
      _event,
      params: {
        modelAuthor: string;
        modelFolder: string;
        modelFilename: string;
        projectorFilename?: string;
        ngl: number;
        ctx: number;
        kvOffload?: boolean;
        mmap?: boolean;
        cacheTypeK?: string;
        cacheTypeV?: string;
      },
    ) => {
      const modelsDir = getModelsDirectory();
      const modelPath = path.join(modelsDir, params.modelAuthor, params.modelFolder, params.modelFilename);
      const projectorPath = params.projectorFilename
        ? path.join(modelsDir, params.modelAuthor, params.modelFolder, 'projectors', params.projectorFilename)
        : undefined;
      return getOrEstimateMemory(
        modelPath,
        params.ngl,
        params.ctx,
        projectorPath,
        params.kvOffload ?? true,
        params.mmap ?? true,
        params.cacheTypeK ?? 'f16',
        params.cacheTypeV ?? 'f16',
      );
    },
  );

  ipcMain.handle(
    'files:readFileAsDataUrl',
    async (_event, filePath: string) => {
      const ext = path.extname(filePath).toLowerCase();
      const mime:
        | 'image/png'
        | 'image/jpeg'
        | 'image/gif'
        | 'image/webp'
        | 'video/mp4'
        | 'video/webm'
        | null =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.mp4'
                  ? 'video/mp4'
                  : ext === '.webm'
                    ? 'video/webm'
                    : null;

      if (!mime) throw new Error(`Unsupported file type: ${ext}`);

      const buf = await fs.promises.readFile(filePath);
      return `data:${mime};base64,${buf.toString('base64')}`;
    },
  );

  ipcMain.handle(
    'files:readFileAsBuffer',
    async (_event, filePath: string) => {
      const buf = await fs.promises.readFile(filePath);
      return buf;
    },
  );
}
