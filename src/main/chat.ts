import * as fs from 'fs';
import { spawn, exec, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import util from 'util';
import { graphics } from 'systeminformation';
import {
  loadSettings,
  onMemorySettingsChanged,
  getModelsDirectory,
} from './settings';
import type { Profile } from '../renderer/types/profile';
import { createChatFunctions } from './chatFunctions';
import { solveMaxConfig, getOrRunOptimizer } from './estimator';

export interface GenerationStats {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
}

export interface SendMessageResponse {
  content: string;
  stats?: GenerationStats;
  promptStats?: GenerationStats;
}

interface TokenUsageStore {
  totalInputTokens: number;
  totalOutputTokens: number;
}

// --- State ---
let serverProcess: ChildProcess | null = null;
let messageHistory: any[] = [];
let abortController: AbortController | null = null;
let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let aborted = false;
let currentProfile: Profile | null = null;
let currentProjector: string | null = null;
let chatFunctions: any = null;
let activeTools: any[] = [];
let emitFunctionEvent: any = null;

// Ensures only one loadProfile() runs at a time
let loadProfileMutex: Promise<void> = Promise.resolve();

// --- Pending user input ---
let pendingInputResolve: ((value: UserInputResponse) => void) | null = null;
let pendingInputReject: ((err: Error) => void) | null = null;

export interface UserInputRequest {
  requestId: string;
  type: 'confirm' | 'select' | 'freeform';
  prompt: string;
  options?: string[];
  allowOther?: boolean;
  toolName: string;
  toolParams: any;
}

export interface UserInputResponse {
  action: 'confirmed' | 'denied' | 'selected';
  value?: string;
}

export function waitForUserInput(): Promise<UserInputResponse> {
  return new Promise((resolve, reject) => {
    pendingInputResolve = resolve;
    pendingInputReject = reject;
  });
}

export function resolveUserInput(response: UserInputResponse): boolean {
  if (pendingInputResolve) {
    pendingInputResolve(response);
    pendingInputResolve = null;
    pendingInputReject = null;
    return true;
  }
  return false;
}

export function cancelPendingInput(): void {
  if (pendingInputReject) {
    pendingInputReject(new Error('User input request cancelled'));
    pendingInputResolve = null;
    pendingInputReject = null;
  }
}

let preloadAbortController: AbortController | null = null;
let lastResolvedMemory: any = null;
let currentContextSize: number | null = null;
let lastUsage: { used: number; total: number } | null = null;

function getTokenUsagePath(): string {
  return path.join(app.getPath('userData'), 'tokenUsage.json');
}

function loadTokenUsage(): TokenUsageStore {
  try {
    return JSON.parse(fs.readFileSync(getTokenUsagePath(), 'utf-8'));
  } catch {
    return { totalInputTokens: 0, totalOutputTokens: 0 };
  }
}

function saveTokenUsage(store: TokenUsageStore): void {
  try {
    fs.writeFileSync(getTokenUsagePath(), JSON.stringify(store), 'utf-8');
  } catch (e) {
    console.error('[chat] Failed to save token usage:', e);
  }
}

function addTokenUsage(inputTokens: number, outputTokens: number): void {
  const current = loadTokenUsage();
  saveTokenUsage({
    totalInputTokens: current.totalInputTokens + inputTokens,
    totalOutputTokens: current.totalOutputTokens + outputTokens,
  });
}

export function getCumulativeTokenUsage(): TokenUsageStore {
  return loadTokenUsage();
}

const execAsync = util.promisify(exec);

async function getNvidiaDriverVersion(): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
      { timeout: 5000 },
    );
    const v = stdout.trim().split('\n')[0]?.trim();
    if (v) {
      const major = parseInt(v.split('.')[0], 10);
      if (!isNaN(major)) return major;
    }
  } catch {}

  try {
    const gpu = await graphics();
    for (const ctrl of gpu.controllers) {
      if (ctrl.vendor.toLowerCase().includes('nvidia') && ctrl.driverVersion) {
        const parts = ctrl.driverVersion.split('.');
        if (parts.length === 4) {
          const last = parseInt(parts[3], 10);
          if (!isNaN(last)) return Math.floor(last / 100);
        } else {
          const major = parseInt(parts[0], 10);
          if (!isNaN(major)) return major;
        }
      }
    }
  } catch {}

  return null;
}

function getAssetPath(...paths: string[]): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');
  return path.join(base, ...paths);
}

async function detectBackend(): Promise<string> {
  const { platform, arch } = process;

  if (platform === 'darwin') return `macos-${arch}`;

  if (platform === 'linux') {
    return arch === 'arm64' ? 'ubuntu-vulkan-arm64' : 'ubuntu-vulkan-x64';
  }

  if (platform === 'win32') {
    if (arch === 'arm64') return 'win-adreno-arm64';

    try {
      const gpu = await graphics();
      const isNvidia = gpu.controllers.some((c) =>
        c.vendor.toLowerCase().includes('nvidia'),
      );

      if (isNvidia) {
        const driverMajor = await getNvidiaDriverVersion();
        if (driverMajor !== null && driverMajor >= 610) {
          return 'win-cuda-13.3-x64';
        }
        return 'win-cuda-12.4-x64';
      }

      return 'win-vulkan-x64';
    } catch {
      return 'win-vulkan-x64';
    }
  }

  return 'win-cpu-x64';
}

export function setEmitFunctionCallback(cb: any) {
  emitFunctionEvent = cb;
}

function getServerUrl(path: string = ''): string {
  const host = currentProfile?.host || '127.0.0.1';
  const port = currentProfile?.port || 8080;
  return `http://${host}:${port}${path}`;
}

// --- Build request body, only including profile fields that are defined ---
function buildChatBody(messages: any[], tools: any[]): Record<string, any> {
  const p = currentProfile;

  const body: Record<string, any> = {
    messages,
    stream: true,
    stream_options: { include_usage: true },
    return_progress: true,
    ...(tools.length > 0 && { tools }),
  };

  // Standard sampling
  if (p?.temperature !== undefined) body.temperature = p.temperature;
  if (p?.topK !== undefined) body.top_k = p.topK;
  if (p?.topP !== undefined) body.top_p = p.topP;
  if (p?.minP !== undefined) body.min_p = p.minP;
  if (p?.seed !== undefined) body.seed = p.seed;

  // XTC sampler
  if (p?.xtc?.probability !== undefined)
    body.xtc_probability = p.xtc.probability;
  if (p?.xtc?.threshold !== undefined) body.xtc_threshold = p.xtc.threshold;

  // Repeat penalty — only apply the block if enabled
  if (p?.repeatPenalty?.enabled) {
    const rp = p.repeatPenalty;
    if (rp.penalty !== undefined) body.repeat_penalty = rp.penalty;
    if (rp.lastTokens !== undefined) body.repeat_last_n = rp.lastTokens;
    if (rp.frequencyPenalty !== undefined)
      body.frequency_penalty = rp.frequencyPenalty;
    if (rp.presencePenalty !== undefined)
      body.presence_penalty = rp.presencePenalty;
  }

  return body;
}

function substituteSystemPromptVariables(prompt: string, profile: Profile | null): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const datetimeStr = `${dateStr} ${timeStr}`;
  const dayOfWeek = now.toLocaleDateString(undefined, { weekday: 'long' });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const profilename = profile?.name ?? '';
  const modelname = profile?.modelFilename
    ?? (profile?.model ? path.basename(profile.model) : '');
  const contextlength = currentContextSize != null ? String(currentContextSize) : '';

  return prompt.replace(
    /\{(date|time|datetime|dayOfWeek|timezone|profilename|modelname|contextlength)\}/g,
    (_match, key) => {
      switch (key) {
        case 'date': return dateStr;
        case 'time': return timeStr;
        case 'datetime': return datetimeStr;
        case 'dayOfWeek': return dayOfWeek;
        case 'timezone': return timezone;
        case 'profilename': return profilename;
        case 'modelname': return modelname;
        case 'contextlength': return contextlength;
        default: return _match;
      }
    },
  );
}

export async function preloadSystemPrompt(
  systemPrompt: string,
  tools: any[],
  onProgress?: (data: {
    progress: number;
    promptN: number;
    promptMs: number;
    total: number;
  }) => void,
  onDone?: (stats: GenerationStats, toolCount: number) => void,
): Promise<void> {
  if (preloadAbortController) preloadAbortController.abort();
  preloadAbortController = new AbortController();
  const { signal } = preloadAbortController;

  let promptStats: GenerationStats | undefined;
  let lastProgress: {
    total: number;
    processed: number;
    time_ms: number;
    cache: number;
  } | null = null;

  const emitDone = () => {
    if (promptStats || !onDone) return;
    if (lastProgress) {
      const newTokens = Math.max(
        0,
        lastProgress.total - (lastProgress.cache || 0),
      );
      const timeMs = lastProgress.time_ms || 0;
      const timeS = timeMs / 1000;
      promptStats = {
        tokens: newTokens,
        timeMs,
        tokensPerSecond: timeS > 0 ? newTokens / timeS : 0,
      };
    } else {
      promptStats = { tokens: 0, timeMs: 0, tokensPerSecond: 0 };
    }
    onDone(promptStats, tools.length);
  };

  try {
    const body: Record<string, any> = {
      messages: [{ role: 'system', content: substituteSystemPromptVariables(systemPrompt, currentProfile) }],
      max_tokens: 1,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      return_progress: true,
    };
    if (tools.length > 0) body.tools = tools;

    const timeout = AbortSignal.timeout(120_000);
    const combinedSignal = new AbortController();
    const abortCombined = () => combinedSignal.abort();
    signal.addEventListener('abort', abortCombined);
    timeout.addEventListener('abort', abortCombined);

    const res = await fetch(getServerUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combinedSignal.signal,
    });

    signal.removeEventListener('abort', abortCombined);
    timeout.removeEventListener('abort', abortCombined);

    if (!res.body) {
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') {
            emitDone();
            break;
          }

          try {
            const data = JSON.parse(dataStr);

            if (data.prompt_progress && !data.usage) {
              const { total, processed, time_ms, cache } = data.prompt_progress;
              lastProgress = { total, processed, time_ms, cache };
              const pct =
                total > 0
                  ? Math.min(100, Math.round((processed / total) * 100))
                  : 0;
              if (onProgress) {
                onProgress({
                  progress: pct,
                  promptN: processed,
                  promptMs: time_ms || 0,
                  total,
                });
              }
              if (total > 0 && processed >= total && !promptStats) {
                const newTokens = Math.max(0, total - (cache || 0));
                const timeS = (time_ms || 0) / 1000;
                promptStats = {
                  tokens: newTokens,
                  timeMs: time_ms || 0,
                  tokensPerSecond: timeS > 0 ? newTokens / timeS : 0,
                };
                if (onDone) onDone(promptStats, tools.length);
              }
              continue;
            }

            if (data.usage && !promptStats) {
              const pFromUsage: GenerationStats = {
                tokens: data.timings?.prompt_n ?? data.usage.prompt_tokens ?? 0,
                timeMs: data.timings?.prompt_ms || 0,
                tokensPerSecond: data.timings?.prompt_per_second || 0,
              };
              promptStats = pFromUsage;
              if (onDone) onDone(pFromUsage, tools.length);
            }
          } catch (e) {
          }
        }
      }
      // Fallback: stream ended without [DONE] or explicit stats
      emitDone();
    } finally {
      reader.releaseLock();
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
    } else {
      console.error('[chat] preload error:', e?.message ?? e);
    }
    emitDone();
  }
}

export async function loadProfile(
  profile: Profile,
  onStatus?: (data: { phase: string; message: string }) => void,
): Promise<{ success: boolean; error?: string; profile?: any }> {
  const prevMutex = loadProfileMutex;
  let releaseMutex: () => void;
  loadProfileMutex = new Promise<void>((r) => { releaseMutex = r; });
  await prevMutex;

  try {
    console.log('[chat] Loading Profile:', profile.name);
    onStatus?.({ phase: 'fetching', message: `Fetching Profile…` });

    let serverErrorLog = '';

    try {
      // Start unload in background
      const unloadPromise = unloadModel();

      // Cancel any in-flight system prompt preload
      if (preloadAbortController) {
        preloadAbortController.abort();
        preloadAbortController = null;
      }

      // Prep work + optimizer run concurrently with old server shutdown
      const settings = loadSettings();
      const fullModelPath = path.join(getModelsDirectory(), profile.model);
      const backendFolder = await detectBackend();
      console.log(`Backend: ${backendFolder}`);
      const serverBin =
        process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
      const serverPath = path.join(getAssetPath('bin', backendFolder), serverBin);

      const vramMB = settings.allocatedVRAM ?? 4096;
      const ramMB = settings.allocatedRAM ?? 8192;

      const fullProjectorPath = profile.projector
        ? path.join(getModelsDirectory(), profile.projector)
        : undefined;

      let result: { ngl: number; ctx: number; memory: any };
      let updatedProfile: any;

      const autoOptimizer = (profile as any).autoOptimizer;
      const hasValidCustom =
        autoOptimizer === 'custom' &&
        typeof (profile as any).layers === 'number' &&
        typeof (profile as any).contextSize === 'number';
      const hasValidCached =
        autoOptimizer &&
        autoOptimizer !== 'custom' &&
        typeof (profile as any).layers === 'number' &&
        typeof (profile as any).contextSize === 'number' &&
        (profile as any).allocatedVRAM === vramMB &&
        (profile as any).allocatedRAM === ramMB;

      if (hasValidCustom || hasValidCached) {
        result = {
          ngl: (profile as any).layers,
          ctx: (profile as any).contextSize,
          memory: null,
        };
      } else {
        const mode =
          autoOptimizer && autoOptimizer !== 'custom'
            ? autoOptimizer
            : 'longest-context';
        onStatus?.({ phase: 'solving', message: `Optimizing Profile "${profile.name}"…` });
        const optResult = await getOrRunOptimizer(
          fullModelPath,
          vramMB,
          ramMB,
          mode === 'most-gpu',
          fullProjectorPath,
          profile,
        );
        result = optResult;
        (profile as any).layers = optResult.ngl;
        (profile as any).contextSize = optResult.ctx;
        (profile as any).autoOptimizer = mode;
        (profile as any).allocatedVRAM = vramMB;
        (profile as any).allocatedRAM = ramMB;
        updatedProfile = { ...profile };
      }

      // Check our Async unloader
      onStatus?.({ phase: 'unloading', message: 'Unloading Previous Profile…' });
      await unloadPromise;

      lastResolvedMemory = result.memory;
      currentContextSize = result.ctx;

      onStatus?.({ phase: 'loadprofile', message: `Loading New Profile…` });
      if (!chatFunctions)
        chatFunctions = createChatFunctions();
      activeTools = (profile.tools || [])
        .map((t) => chatFunctions[t])
        .filter(Boolean)
        .map((f) => ({
          type: 'function',
          function: {
            name:
              f.name ||
              Object.keys(chatFunctions).find((k) => chatFunctions[k] === f),
            description: f.description,
            parameters: f.params,
          },
        }));

      const spawnArgs = [
        '--model',
        fullModelPath,
        '--n-gpu-layers',
        (profile as any).gpuLayersAuto ? 'auto' : result.ngl.toString(),
        '--ctx-size',
        result.ctx.toString(),
        '--port',
        ((profile as any).port ?? 8080).toString(),
        '--host',
        (profile as any).host ?? '127.0.0.1',
        '--parallel',
        ((profile as any).parallel !== undefined && (profile as any).parallel !== -1 ? (profile as any).parallel : 1).toString(),
        '--metrics',
      ];
      if ((profile as any).corsOrigins && (profile as any).corsOrigins !== '*') {
        spawnArgs.push('--cors-origins', (profile as any).corsOrigins);
      }
      if ((profile as any).corsMethods && (profile as any).corsMethods !== 'GET, POST, DELETE, OPTIONS') {
        spawnArgs.push('--cors-methods', (profile as any).corsMethods);
      }
      if ((profile as any).corsHeaders && (profile as any).corsHeaders !== '*') {
        spawnArgs.push('--cors-headers', (profile as any).corsHeaders);
      }
      if ((profile as any).corsCredentials === false) {
        spawnArgs.push('--no-cors-credentials');
      }
      if (profile.kvOffload === false) spawnArgs.push('--no-kv-offload');
      if (profile.mmap === false) spawnArgs.push('--no-mmap');
      if (profile.mlock === true) spawnArgs.push('--mlock');
      spawnArgs.push('--cache-type-k', (profile as any).cacheTypeK ?? 'f16');
      spawnArgs.push('--cache-type-v', (profile as any).cacheTypeV ?? 'f16');
      if ((profile as any).flashAttn) {
        spawnArgs.push('--flash-attn', (profile as any).flashAttn);
      }

      // Mixture of Experts (MoE)
      if (profile.cpuMoe === true) spawnArgs.push('--cpu-moe');
      if (profile.nCpuMoe !== undefined && profile.nCpuMoe > 0) {
        spawnArgs.push('--n-cpu-moe', profile.nCpuMoe.toString());
      }

      if (fullProjectorPath) {
        spawnArgs.push('--mmproj', fullProjectorPath);
        currentProjector = fullProjectorPath;
      } else {
        currentProjector = null;
      }

      // Draft model (speculative decoding)
      if (profile.specType && profile.specType.length > 0) {
        spawnArgs.push('--spec-type', profile.specType.join(','));

        const draftModelPath = profile.draftModelFilename
          ? path.join(getModelsDirectory(), `${profile.draftModelAuthor}/${profile.draftModelFolder}/${profile.draftModelFilename}`)
          : undefined;
        if (draftModelPath && fs.existsSync(draftModelPath) && profile.specType.includes('draft-simple')) {
          spawnArgs.push('--spec-draft-model', draftModelPath);
        }

        if (profile.specDraftNMax !== undefined && profile.specDraftNMax !== 3) {
          spawnArgs.push('--spec-draft-n-max', profile.specDraftNMax.toString());
        }
        if (profile.specDraftNMin !== undefined && profile.specDraftNMin !== 0) {
          spawnArgs.push('--spec-draft-n-min', profile.specDraftNMin.toString());
        }
        if (profile.specDraftPSplit !== undefined && profile.specDraftPSplit !== 0.10) {
          spawnArgs.push('--draft-p-split', profile.specDraftPSplit.toFixed(2));
        }
        if (profile.specDraftPMin !== undefined && profile.specDraftPMin !== 0.00) {
          spawnArgs.push('--draft-p-min', profile.specDraftPMin.toFixed(2));
        }
      }

      console.log(`NGL=${result.ngl}, Context=${result.ctx}, autoOptimizer=${(profile as any).autoOptimizer}`);
      onStatus?.({ phase: 'starting', message: 'Loading AI Model…' });

      // Defensive kill: ensure no stale server process before spawning
      if (serverProcess) {
        await unloadModel();
      }

      serverProcess = spawn(serverPath, spawnArgs);

      serverProcess.stderr?.on('data', (d) => {
        serverErrorLog += d.toString();
      });

      let ready = false;
      for (let i = 0; i < 45; i++) {
        try {
          const host = (profile as any).host ?? '127.0.0.1';
          const port = (profile as any).port ?? 8080;
          const res = await fetch(`http://${host}:${port}/health`);
          if (res.ok) {
            ready = true;
            break;
          }
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!ready) {
        console.error('[llama-server] Startup failed. Logs:\n', serverErrorLog);
        const errorLines = serverErrorLog
          .split('\n')
          .filter((l) => /\bE\b/.test(l) || l.includes('error'))
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 10);
        const detail = errorLines.length > 0
          ? errorLines.join('\n')
          : serverErrorLog.trim().slice(0, 2000);
        throw new Error(`Inference server failed to respond.\n\n${detail}`);
      }

      const resolvedSystemPrompt = substituteSystemPromptVariables(profile.systemPrompt, profile);
      const systemTokens = (await tokenize(resolvedSystemPrompt)) ?? 0;
      const toolTokens =
        activeTools.length > 0
          ? ((await tokenize(JSON.stringify(activeTools))) ?? 0)
          : 0;
      lastUsage = { used: systemTokens + toolTokens, total: result.ctx };

      onStatus?.({ phase: 'ready', message: '' });
      currentProfile = profile;
      messageHistory = [{ role: 'system', content: resolvedSystemPrompt }];

      if (updatedProfile) {
        return { success: true, profile: updatedProfile, backend: backendFolder };
      }
      return { success: true, backend: backendFolder };
    } catch (error: any) {
      onStatus?.({ phase: 'ready', message: '' });
      return { success: false, error: error.message };
    }
  } finally {
    releaseMutex?.();
  }
}

export async function sendMessage(
  text: string,
  onToken: (t: string, type?: 'thought' | 'comment') => void,
  contentParts?: { kind: string; url?: string; filePath?: string; text?: string }[],
  onProgress?: (data: {
    progress: number;
    promptN: number;
    promptMs: number;
    total: number;
  }) => void,
  onPromptDone?: (stats: GenerationStats) => void,
): Promise<SendMessageResponse> {
  if (!currentProfile) throw new Error('No profile loaded');

  const userTokens = (await tokenize(text)) ?? 0;
  let currentNewTokens = userTokens;
  if (lastUsage) {
    lastUsage = { used: lastUsage.used + userTokens, total: lastUsage.total };
  }

  const userContent: any[] = [];
  if (contentParts && contentParts.length > 0) {
    for (const part of contentParts) {
      if (part.kind === 'image_url' && part.url) {
        userContent.push({ type: 'image_url', image_url: { url: part.url } });
      } else if (part.kind === 'text' && part.text) {
        userContent.push({ type: 'text', text: part.text });
      }
    }
  }
  userContent.push({ type: 'text', text });

  messageHistory.push({ role: 'user', content: userContent });
  abortController = new AbortController();
  aborted = false;

  const runCompletion = async (): Promise<SendMessageResponse> => {
    const response = await fetch(getServerUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildChatBody(messageHistory, activeTools)),
      signal: abortController?.signal,
    });

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();
    let fullResponse = '';
    const toolCalls: any[] = [];
    let stats: GenerationStats | undefined;
    let promptStats: GenerationStats | undefined;

    try {
      while (true) {
        let readResult;
        try {
          readResult = await reader!.read();
        } catch {
          // Stream error — exit loop gracefully
          break;
        }
        const { done, value } = readResult;
        if (done) break;
        if (aborted) {
          // Drain remaining bytes so the HTTP parser finishes cleanly
          try {
            while (true) {
              const { done: d } = await reader!.read();
              if (d) break;
            }
          } catch {}
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;

          try {
            const data = JSON.parse(dataStr);

            // Progress event during prompt processing (return_progress: true sends prompt_progress)
            if (data.prompt_progress && !data.usage) {
              const { total, processed, time_ms, cache } = data.prompt_progress;
              const pct =
                total > 0
                  ? Math.min(100, Math.round((processed / total) * 100))
                  : 0;
              if (onProgress) {
                onProgress({
                  progress: pct,
                  promptN: processed,
                  promptMs: time_ms || 0,
                  total,
                });
              }
              // Prompt processing complete — send stats immediately
              if (total > 0 && processed >= total && !promptStats) {
                const timeS = (time_ms || 0) / 1000;
                const pStats: GenerationStats = {
                  tokens: currentNewTokens,
                  timeMs: time_ms || 0,
                  tokensPerSecond: timeS > 0 ? currentNewTokens / timeS : 0,
                };
                promptStats = pStats;
                if (onPromptDone) onPromptDone(pStats);
              }
              continue;
            }

            if (data.usage) {
              lastUsage = {
                used: data.usage.total_tokens,
                total: currentContextSize || 2048,
              };
              addTokenUsage(
                data.usage.prompt_tokens ?? 0,
                data.usage.completion_tokens ?? 0,
              );
              stats = {
                tokens: data.usage.completion_tokens,
                timeMs: data.timings?.predicted_ms || 0,
                tokensPerSecond: data.timings?.predicted_per_second || 0,
              };
              const pFromUsage: GenerationStats = {
                tokens: currentNewTokens,
                timeMs: data.timings?.prompt_ms || 0,
                tokensPerSecond: data.timings?.prompt_per_second || 0,
              };
              // Only set if not already sent via progress events
              if (!promptStats) {
                promptStats = pFromUsage;
                if (onPromptDone) onPromptDone(pFromUsage);
              }
            }

            const delta = data.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              fullResponse += delta.content;
              onToken(delta.content);
            }
            if (delta.reasoning_content) {
              onToken(delta.reasoning_content, 'thought');
            }
            if (delta.tool_calls) {
              delta.tool_calls.forEach((tc: any) => {
                if (!toolCalls[tc.index])
                  toolCalls[tc.index] = { id: tc.id, name: '', args: '' };
                if (tc.function?.name)
                  toolCalls[tc.index].name = tc.function.name;
                if (tc.function?.arguments)
                  toolCalls[tc.index].args += tc.function.arguments;
              });
            }

            if (lastUsage && !data.usage) {
              lastUsage = { used: lastUsage.used + 1, total: lastUsage.total };
            }
          } catch (e) {}
        }
      }
    } finally {
      reader.releaseLock();
      currentReader = null;
    }

    if (aborted) return { content: 'Aborted' };

    if (toolCalls.length > 0) {
      const toolCallRequests = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      }));
      const toolCallRequestStr = JSON.stringify(toolCallRequests);
      const toolCallRequestTokens = (await tokenize(toolCallRequestStr)) ?? 0;
      let totalResultTokens = 0;
      messageHistory.push({
        role: 'assistant',
        tool_calls: toolCallRequests,
      });
      for (const tc of toolCalls) {
        const handler = chatFunctions[tc.name]?.handler;
        if (emitFunctionEvent) emitFunctionEvent('calling', tc.name, '');
        if (emitFunctionEvent) emitFunctionEvent('call', tc.name, tc.args);
        let result = await handler(JSON.parse(tc.args));

        // Check if tool requests user input
        if (result && typeof result === 'object' && result._userInput) {
          const inputReq: UserInputRequest = {
            requestId: tc.id,
            type: result._userInput.type || 'confirm',
            prompt: result._userInput.prompt || `Allow ${tc.name}?`,
            options: result._userInput.options,
            allowOther: result._userInput.allowOther,
            toolName: tc.name,
            toolParams: JSON.parse(tc.args),
          };
          if (emitFunctionEvent) emitFunctionEvent('input-request', tc.name, JSON.stringify(inputReq));
          const userResponse = await waitForUserInput();

          if (inputReq.type === 'confirm') {
            if (userResponse.action === 'confirmed') {
              // Re-call handler with confirmation
              result = await handler({ ...JSON.parse(tc.args), _confirmed: true });
            } else {
              result = { _denied: true, message: 'User denied this action.' };
            }
          } else {
            // select / freeform: use user's response directly as tool result
            result = { _userResponse: userResponse.action, value: userResponse.value };
          }
        }

        const resultStr = JSON.stringify(result);
        if (lastUsage) {
          const resultTokens = (await tokenize(resultStr)) ?? 0;
          totalResultTokens += resultTokens;
          lastUsage = {
            used: lastUsage.used + resultTokens,
            total: lastUsage.total,
          };
        }
        if (emitFunctionEvent) emitFunctionEvent('result', tc.name, resultStr);
        messageHistory.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr,
        });
      }
      currentNewTokens = toolCallRequestTokens + totalResultTokens;
      return runCompletion();
    }

    return { content: fullResponse, stats, promptStats };
  };

  try {
    const result = await runCompletion();
    messageHistory.push({ role: 'assistant', content: result.content });
    return result;
  } catch (e: any) {
    if (e.name === 'AbortError' || aborted) return { content: 'Aborted' };
    throw e;
  }
}

export async function abort() {
  aborted = true;
  cancelPendingInput();
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  // The main read loop's inner drain loop handles stream cleanup.
  // Do NOT cancel the reader — that leaves the llhttp parser paused.
}

export async function unloadModel() {
  const proc = serverProcess;
  if (proc) {
    serverProcess = null;
    currentProjector = null;
    proc.kill();
    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
    });
  }
  messageHistory = [];
  currentContextSize = null;
  lastUsage = null;
}

export function hasConversationContext(): boolean {
  return messageHistory.length > 1;
}

export function isServerRunning(): boolean {
  return serverProcess !== null;
}

export function getServerPid(): number | null {
  return serverProcess?.pid ?? null;
}

export function getContextSize() {
  return currentContextSize;
}
export function getContextUsage() {
  return lastUsage;
}
export function getModelMemoryUsage() {
  return lastResolvedMemory ? { ...lastResolvedMemory } : null;
}
export function getCurrentProfile() {
  return currentProfile;
}
export function getActiveTools(): any[] {
  return activeTools;
}
export function hasProjector() {
  return currentProjector !== null;
}

export async function tokenize(text: string): Promise<number | null> {
  try {
    const res = await fetch(getServerUrl('/tokenize'), {
      method: 'POST',
      body: JSON.stringify({ content: text }),
    });
    return (await res.json()).tokens?.length || 0;
  } catch {
    return null;
  }
}

onMemorySettingsChanged(() => {
  if (currentProfile) loadProfile(currentProfile).catch(console.error);
});
