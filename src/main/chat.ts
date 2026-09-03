import * as fs from 'fs';
import { spawn, exec, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import util from 'util';
import { randomUUID } from 'crypto';
import { graphics } from 'systeminformation';
import {
  loadSettings,
  onMemorySettingsChanged,
  getModelsDirectory,
} from './settings';
import type { AppSettings } from './settings';
import type { Profile } from '../renderer/types/profile';
// eslint-disable-next-line import/no-cycle
import { createChatFunctions } from './chatFunctions';
import { solveMaxConfig, getOrRunOptimizer } from './estimator';
import { addTokenUsage, addWebSearch, getUsage } from './usage';
import type { UsageStore } from '../renderer/utils/usage';
import * as store from './sessionStore';
import type {
  ChatHistoryMsg,
  GenerationStatsData,
  MediaDisplayItem,
  Message,
  MessageSegment,
  SavedSession,
  SessionStatus,
  Source,
  StreamEventPayload,
  UserInputRequest,
  UserInputResponse,
} from '../shared/chatTypes';
import { mergeSources } from '../shared/chatTypes';

export interface GenerationStats {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
  responseTokens?: number;
  thinkingTokens?: number;
  toolTokens?: number;
}

export interface SendMessageResponse {
  content: string;
  stats?: GenerationStats;
  promptStats?: GenerationStats;
}

export type { SessionStatus };
export type { UserInputRequest, UserInputResponse, StreamEventPayload };

interface PendingToolInput {
  request: UserInputRequest;
  resolve: (value: UserInputResponse) => void;
  reject: (err: Error) => void;
}

interface SessionStream {
  sessionId: string;
  profileId: string;
  title: string;
  createdAt: number;
  messages: Message[];
  history: ChatHistoryMsg[];
  pinned: boolean;
  sources: Source[];
  status: SessionStatus;
  abortController: AbortController | null;
  currentReader: ReadableStreamDefaultReader<Uint8Array> | null;
  aborted: boolean;
  failed: boolean;
  messageCounter: number;
  segmentCounter: number;
  toolQueue: string[];
  pendingSegmentIds: string[];
  pendingInput: PendingToolInput | null;
  isReprocessing: boolean;
  systemInserted: boolean;
  streamingTool: { name: string; text: string } | null;
  promptProgress: number;
}

// --- State ---
let serverProcess: ChildProcess | null = null;
let currentProfile: Profile | null = null;
let currentProjector: string | null = null;
let chatFunctions: any = null;
let activeTools: any[] = [];
let emitStreamEvent: ((payload: StreamEventPayload) => void) | null = null;

const sessions = new Map<string, SessionStream>();

// Provide live session access to sessionStore for extension use without circular import
store.setLiveSessionsProvider(() => sessions);
store.setSessionChangedCallback((id: string) => emitSessionChanged(id));

let currentSystemPrompt = '';
let lastPreloadStats: { stats: GenerationStatsData; toolCount: number } | null =
  null;

// Ensures only one loadProfile() runs at a time
let loadProfileMutex: Promise<void> = Promise.resolve();

let preloadAbortController: AbortController | null = null;
let lastResolvedMemory: any = null;
let currentContextSize: number | null = null;
let lastUsage: { used: number; total: number } | null = null;

export function getCumulativeTokenUsage(): UsageStore {
  return getUsage();
}

const execAsync = util.promisify(exec);

export function setStreamEventCallback(
  cb: (payload: StreamEventPayload) => void,
) {
  emitStreamEvent = cb;
}

// --- Stream event helpers ---
function emit(payload: StreamEventPayload): void {
  emitStreamEvent?.(payload);
}

function emitSessionChanged(sessionId: string): void {
  const s = sessions.get(sessionId);
  emit({
    type: 'session-changed',
    sessionId,
    streaming: s ? s.status !== 'idle' : false,
  });
}

class SlotUnavailableError extends Error {
  constructor() {
    super('No generation slot is free');
    this.name = 'SlotUnavailableError';
  }
}

function isSlotUnavailableError(status: number, message: string): boolean {
  if (status === 503) return true;
  return /no slot is free|no available slot|slot.*(not.*free|busy)/i.test(
    message,
  );
}

function persistSessionState(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  const saved: SavedSession = {
    id: s.sessionId,
    profileId: s.profileId,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: Date.now(),
    messages: store.sanitizeMessagesForStorage(s.messages),
    history: s.history,
    pinned: s.pinned,
    sources: s.sources,
  };
  store.saveSession(saved);
}

function getSessionState(sessionId: string): SessionStream | null {
  let s = sessions.get(sessionId);
  if (!s) {
    // Rebuild in-memory state from the persisted store (e.g. after a restart
    // or when a session was never loaded into memory).
    const stored = store.getSession(sessionId);
    if (!stored) return null;
    s = {
      sessionId,
      profileId: stored.profileId,
      title: stored.title,
      createdAt: stored.createdAt,
      messages: stored.messages,
      history: stored.history,
      pinned: !!stored.pinned,
      sources: stored.sources ?? [],
      status: 'idle',
      abortController: null,
      currentReader: null,
      aborted: false,
      failed: false,
      messageCounter: stored.messages.reduce(
        (max, m) => Math.max(max, m.id + 1),
        0,
      ),
      segmentCounter: 0,
      toolQueue: [],
      pendingSegmentIds: [],
      pendingInput: null,
      isReprocessing: false,
      systemInserted: stored.messages.some((m) => m.role === 'system'),
      streamingTool: null,
      promptProgress: 0,
    };
    sessions.set(sessionId, s);
  }
  return s;
}

// --- Pending user input (per session) ---
function waitForSessionInput(
  s: SessionStream,
  request: UserInputRequest,
): Promise<UserInputResponse> {
  return new Promise((resolve, reject) => {
    s.pendingInput = { request, resolve, reject };
  });
}

export function resolveUserInput(
  sessionId: string,
  response: UserInputResponse,
): boolean {
  const s = sessions.get(sessionId);
  if (!s?.pendingInput) return false;
  s.pendingInput.resolve(response);
  s.pendingInput = null;
  emit({ type: 'user-input-resolved', sessionId });
  emitSessionChanged(sessionId);
  return true;
}

function cancelPendingInput(s: SessionStream): void {
  if (s.pendingInput) {
    s.pendingInput.reject(new Error('User input request cancelled'));
    s.pendingInput = null;
  }
}

// --- Session lifecycle ---
export function startSession(profileId: string, title: string): string {
  const sessionId = randomUUID();
  const state: SessionStream = {
    sessionId,
    profileId,
    title: title.trim() || 'Untitled session',
    createdAt: Date.now(),
    messages: [],
    history: [],
    pinned: false,
    sources: [],
    status: 'idle',
    abortController: null,
    currentReader: null,
    aborted: false,
    failed: false,
    messageCounter: 0,
    segmentCounter: 0,
    toolQueue: [],
    pendingSegmentIds: [],
    pendingInput: null,
    isReprocessing: false,
    systemInserted: false,
    streamingTool: null,
    promptProgress: 0,
  };
  sessions.set(sessionId, state);
  persistSessionState(sessionId);
  emitSessionChanged(sessionId);
  return sessionId;
}

export function getSessionView(sessionId: string) {
  const s = getSessionState(sessionId);
  if (!s) return null;
  return {
    session: {
      id: s.sessionId,
      profileId: s.profileId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: Date.now(),
      messages: s.messages,
      history: s.history,
      pinned: s.pinned,
      sources: s.sources,
    },
    status: s.status,
    streaming: s.status !== 'idle',
    streamingTool: s.streamingTool,
    progress: s.promptProgress,
    pendingInput: s.pendingInput?.request ?? null,
  };
}

export function deleteSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) {
    s.aborted = true;
    cancelPendingInput(s);
    s.abortController?.abort();
    sessions.delete(sessionId);
  }
  store.deleteSession(sessionId);
  emitSessionChanged(sessionId);
}

export function getSessionForTool(
  sessionId: string,
): SavedSession | null {
  const s = getSessionState(sessionId);
  if (s) {
    return {
      id: s.sessionId,
      profileId: s.profileId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: Date.now(),
      messages: s.messages,
      history: s.history,
      pinned: s.pinned,
      sources: s.sources,
    };
  }
  return store.getSession(sessionId);
}

export function listSessionsForTool(profileId: string): SavedSession[] {
  // Return sessions for profileId; prefer in-memory state when available
  // to get live messages/titles, falling back to persisted store.
  const persisted = store.listSessions(profileId);
  const merged = persisted.map((saved) => {
    const live = sessions.get(saved.id);
    if (!live) return saved;
    return {
      ...saved,
      title: live.title,
      messages: live.messages,
      history: live.history,
      pinned: live.pinned,
      sources: live.sources,
    };
  });
  // Sort by updatedAt; live sessions use current time approximation
  // Already sorted by store, but re-sort after merging live titles
  return merged.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function renameSessionSynced(
  id: string,
  title: string,
): SavedSession | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const s = sessions.get(id);
  if (s) {
    s.title = trimmed;
    persistSessionState(id);
    emitSessionChanged(id);
    return {
      id: s.sessionId,
      profileId: s.profileId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: Date.now(),
      messages: s.messages,
      history: s.history,
      pinned: s.pinned,
      sources: s.sources,
    };
  }
  const updated = store.renameSession(id, trimmed);
  if (updated) emitSessionChanged(id);
  return updated;
}

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

function getServerBinName(): string {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

// Resolves which llama-server binary to launch. Explicit selection wins, then
// the "Default" backend (first recommended download, preferring CUDA, then
// OpenCL/Adreno, then Vulkan), then the first download, then bundled assets.
async function resolveBackend(
  settings: AppSettings,
): Promise<{ backendFolder: string; serverPath: string }> {
  const serverBin = getServerBinName();
  const downloads = settings.backendDownloads ?? [];
  const backendDir =
    settings.backendDirectory ||
    path.join(path.dirname(getModelsDirectory()), 'llama');
  const customPaths = settings.customBinaryPaths ?? [];
  const pathFor = (folder: string) => path.join(backendDir, folder, serverBin);

  const selected = settings.selectedBackend;
  if (selected && selected !== 'Default') {
    if (customPaths.includes(selected) && fs.existsSync(selected)) {
      return { backendFolder: selected, serverPath: selected };
    }
    const match = downloads.find((d) => d.folder === selected);
    if (match && fs.existsSync(pathFor(match.folder))) {
      return { backendFolder: match.folder, serverPath: pathFor(match.folder) };
    }
  }

  const patterns = [/cuda/i, /opencl|adreno/i, /vulkan/i];
  const hit = patterns
    .map((pattern) =>
      downloads.find(
        (d) => pattern.test(d.folder) && fs.existsSync(pathFor(d.folder)),
      ),
    )
    .find(Boolean);
  if (hit) {
    return { backendFolder: hit.folder, serverPath: pathFor(hit.folder) };
  }

  const first = downloads.find((d) => fs.existsSync(pathFor(d.folder)));
  if (first)
    return { backendFolder: first.folder, serverPath: pathFor(first.folder) };

  const folder = await detectBackend();
  return {
    backendFolder: folder,
    serverPath: getAssetPath('bin', folder, serverBin),
  };
}

function getServerUrl(path: string = ''): string {
  const host = currentProfile?.host || '127.0.0.1';
  const port = currentProfile?.port || 9931;
  return `http://${host}:${port}${path}`;
}

// --- Build llama-server launch arguments ---
// Single source of truth used by loadProfile() and exposed to the renderer
// (chat:getLaunchArgs) so previews always match the real server invocation.

export interface LlamaServerLaunchConfig {
  modelPath: string;
  projectorPath?: string;
  ngl: number;
  ctx: number;
}

/**
 * Quote-aware arg splitter for custom flags / manual command.
 * Handles single + double quotes and backslash escaping. Value-less flags (e.g. --verbose) become one token.
 * Shell metachars like ; | & are treated as literal chars (spawn has no shell) – allowed, let server fail.
 * Exported for preview IPC & tests.
 */
export function splitShellArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && !inSingle) {
      const next = input[i + 1];
      // Preserve Windows path backslashes: only treat as escape when escaping quote/backslash/space
      if (inDouble) {
        if (next === '"' || next === '\\') {
          escaped = true;
          continue;
        }
        cur += ch;
        continue;
      }
      if (next === '"' || next === "'" || next === '\\' || next === ' ' || next === '\t') {
        escaped = true;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  // If quotes were left unclosed, we still return what we have – let it crash, per spec allow saving anything
  return out;
}

export function stripBinaryPrefix(args: string[]): string[] {
  if (args.length === 0) return args;
  const first = args[0];
  const base = first.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (base === 'llama-server' || base === 'llama-server.exe') {
    return args.slice(1);
  }
  return args;
}

export function buildLlamaServerArgs(
  profile: Partial<Profile>,
  config: LlamaServerLaunchConfig,
): string[] {
  // Manual full replace – no injection, fully user-controlled
  if ((profile as any).useCustomLaunch) {
    const raw = ((profile as any).customLaunchCommand ?? '').trim();
    // Allow empty manual to surface as empty args (will let server fail, per spec)
    if (raw.length === 0) return [];
    const tokens = splitShellArgs(raw);
    return stripBinaryPrefix(tokens);
  }
  // Model Arguments
  const spawnArgs = ['--model', config.modelPath];
  spawnArgs.push(
    '--n-gpu-layers',
    (profile as any).gpuLayersAuto ? 'auto' : config.ngl.toString(),
    '--ctx-size',
    config.ctx.toString(),
  );

  // Projector Arguments
  if (config.projectorPath) {
    spawnArgs.push('--mmproj', config.projectorPath);
  }
  if ((profile as any).mmprojOffload === false) {
    spawnArgs.push('--no-mmproj-offload');
  }
  if (
    (profile as any).imageMinTokens !== undefined &&
    (profile as any).imageMinTokens > 0
  ) {
    spawnArgs.push(
      '--image-min-tokens',
      (profile as any).imageMinTokens.toString(),
    );
  }
  if (
    (profile as any).imageMaxTokens !== undefined &&
    (profile as any).imageMaxTokens > 0
  ) {
    spawnArgs.push(
      '--image-max-tokens',
      (profile as any).imageMaxTokens.toString(),
    );
  }
  if (
    (profile as any).mtmdBatchMaxTokens !== undefined &&
    (profile as any).mtmdBatchMaxTokens !== 1024
  ) {
    spawnArgs.push(
      '--mtmd-batch-max-tokens',
      (profile as any).mtmdBatchMaxTokens.toString(),
    );
  }

  // Draft Model Arguments
  if (profile.specType && profile.specType.length > 0) {
    spawnArgs.push('--spec-type', profile.specType.join(','));

    const draftModelPath = profile.draftModelFilename
      ? path.join(
          getModelsDirectory(),
          `${profile.draftModelAuthor}/${profile.draftModelFolder}/${profile.draftModelFilename}`,
        )
      : undefined;
    if (
      draftModelPath &&
      fs.existsSync(draftModelPath) &&
      profile.specType.includes('draft-simple')
    ) {
      spawnArgs.push('--spec-draft-model', draftModelPath);
    }

    if (profile.specDraftNMax !== undefined && profile.specDraftNMax !== 3) {
      spawnArgs.push('--spec-draft-n-max', profile.specDraftNMax.toString());
    }
    if (profile.specDraftNMin !== undefined && profile.specDraftNMin !== 0) {
      spawnArgs.push('--spec-draft-n-min', profile.specDraftNMin.toString());
    }
    if (
      profile.specDraftPSplit !== undefined &&
      profile.specDraftPSplit !== 0.1
    ) {
      spawnArgs.push('--draft-p-split', profile.specDraftPSplit.toFixed(2));
    }
    if (profile.specDraftPMin !== undefined && profile.specDraftPMin !== 0.0) {
      spawnArgs.push('--draft-p-min', profile.specDraftPMin.toFixed(2));
    }
  }

  // MoE Arguments
  if (profile.cpuMoe === true) spawnArgs.push('--cpu-moe');
  if (
    profile.nCpuMoe !== undefined &&
    profile.nCpuMoe > 0 &&
    profile.cpuMoe !== true
  ) {
    spawnArgs.push('--n-cpu-moe', profile.nCpuMoe.toString());
  }

  // Cache Arguments
  if (profile.kvOffload === false) spawnArgs.push('--no-kv-offload');
  if ((profile as any).flashAttn) {
    spawnArgs.push('--flash-attn', (profile as any).flashAttn);
  }
  spawnArgs.push('--cache-type-k', (profile as any).cacheTypeK ?? 'f16');
  spawnArgs.push('--cache-type-v', (profile as any).cacheTypeV ?? 'f16');

  // Memory Arguments
  if (profile.mmap === false) spawnArgs.push('--no-mmap');
  if (profile.mlock === true) spawnArgs.push('--mlock');
  if (profile.repack === false) spawnArgs.push('--no-repack');
  if ((profile as any).contextShift === true) spawnArgs.push('--context-shift');

  // Context Scaling Arguments (only applied when different from server defaults)
  const scalingMethod = (profile as any).rope?.scaling;
  if (scalingMethod) {
    spawnArgs.push('--rope-scaling', scalingMethod);
  }

  // RoPE parameters only make sense when a scaling method is active
  if (scalingMethod) {
    if (
      (profile as any).rope?.scale !== undefined &&
      (profile as any).rope.scale !== 1.0
    ) {
      spawnArgs.push('--rope-scale', (profile as any).rope.scale.toString());
    }
    if ((profile as any).rope?.freqBase !== undefined) {
      spawnArgs.push(
        '--rope-freq-base',
        (profile as any).rope.freqBase.toString(),
      );
    }
    if (
      (profile as any).rope?.freqScale !== undefined &&
      (profile as any).rope.freqScale !== 1.0
    ) {
      spawnArgs.push(
        '--rope-freq-scale',
        (profile as any).rope.freqScale.toString(),
      );
    }
  }

  // YaRN parameters only apply when the YaRN method is selected
  if (scalingMethod === 'yarn') {
    if (
      (profile as any).yarn?.origCtx !== undefined &&
      (profile as any).yarn.origCtx !== 0
    ) {
      spawnArgs.push(
        '--yarn-orig-ctx',
        (profile as any).yarn.origCtx.toString(),
      );
    }
    if (
      (profile as any).yarn?.extFactor !== undefined &&
      (profile as any).yarn.extFactor !== -1.0
    ) {
      spawnArgs.push(
        '--yarn-ext-factor',
        (profile as any).yarn.extFactor.toString(),
      );
    }
    if (
      (profile as any).yarn?.attnFactor !== undefined &&
      (profile as any).yarn.attnFactor !== -1.0
    ) {
      spawnArgs.push(
        '--yarn-attn-factor',
        (profile as any).yarn.attnFactor.toString(),
      );
    }
    if (
      (profile as any).yarn?.betaSlow !== undefined &&
      (profile as any).yarn.betaSlow !== -1.0
    ) {
      spawnArgs.push(
        '--yarn-beta-slow',
        (profile as any).yarn.betaSlow.toString(),
      );
    }
    if (
      (profile as any).yarn?.betaFast !== undefined &&
      (profile as any).yarn.betaFast !== -1.0
    ) {
      spawnArgs.push(
        '--yarn-beta-fast',
        (profile as any).yarn.betaFast.toString(),
      );
    }
  }

  // Server Arguments
  spawnArgs.push(
    '--host',
    (profile as any).host ?? '127.0.0.1',
    '--port',
    ((profile as any).port ?? 9931).toString(),
    '--parallel',
    ((profile as any).parallel !== undefined && (profile as any).parallel !== -1
      ? (profile as any).parallel
      : 1
    ).toString(),
  );

  // CORS Arguments
  if ((profile as any).corsCredentials === false) {
    spawnArgs.push('--no-cors-credentials');
  }
  if ((profile as any).corsOrigins && (profile as any).corsOrigins !== '*') {
    spawnArgs.push('--cors-origins', (profile as any).corsOrigins);
  }
  if (
    (profile as any).corsMethods &&
    (profile as any).corsMethods !== 'GET, POST, DELETE, OPTIONS'
  ) {
    spawnArgs.push('--cors-methods', (profile as any).corsMethods);
  }
  if ((profile as any).corsHeaders && (profile as any).corsHeaders !== '*') {
    spawnArgs.push('--cors-headers', (profile as any).corsHeaders);
  }

  // Custom Flags – one string per row, each row may be "--flag" (no value) or "--flag value"
  // Split each row with quote awareness so "--foo 'bar baz'" works, then append tokens verbatim.
  if (Array.isArray((profile as any).customFlags)) {
    for (const line of (profile as any).customFlags as string[]) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      spawnArgs.push(...splitShellArgs(trimmed));
    }
  }

  // Static Server Arguments
  spawnArgs.push('--metrics', '--no-ui');

  return spawnArgs;
}

// --- Build request body, only including profile fields that are defined ---
function buildChatBody(
  messages: any[],
  tools: any[],
  thinkingTokensOverride?: number,
): Record<string, any> {
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
  if (p?.seed !== undefined && p.seed !== -1) body.seed = p.seed;

  // Advanced samplers
  if (p?.typicalP !== undefined && p.typicalP !== 1.0)
    body.typical_p = p.typicalP;
  if (p?.topNSigma !== undefined && p.topNSigma !== -1.0)
    body.top_n_sigma = p.topNSigma;
  if (p?.ignoreEos === true) body.ignore_eos = true;

  // XTC sampler
  if (p?.xtc?.probability !== undefined && p.xtc.probability !== 0)
    body.xtc_probability = p.xtc.probability;
  if (p?.xtc?.threshold !== undefined && p.xtc.threshold !== 0.1)
    body.xtc_threshold = p.xtc.threshold;

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

  // DRY sampling
  if (p?.repeatPenalty?.dry?.enabled) {
    const dry = p.repeatPenalty.dry;
    if (dry.multiplier !== undefined) body.dry_multiplier = dry.multiplier;
    if (dry.base !== undefined) body.dry_base = dry.base;
    if (dry.allowedLength !== undefined)
      body.dry_allowed_length = dry.allowedLength;
    if (dry.penaltyLastN !== undefined)
      body.dry_penalty_last_n = dry.penaltyLastN;
    if (dry.sequenceBreakers !== undefined)
      body.dry_sequence_breakers = dry.sequenceBreakers;
  }

  // Thinking / reasoning budget
  // Mirrors the llama.cpp webui (tools/ui/src/lib/services/chat.service.ts): thinking is
  // toggled via chat_template_kwargs.enable_thinking, budgeted per-request via
  // reasoning_budget_tokens, and reasoning is parsed into reasoning_content via reasoning_format.
  const thinkingTokens = thinkingTokensOverride ?? p?.thinkingTokens ?? 8192;
  body.reasoning_format = 'auto';
  body.reasoning_budget_tokens = thinkingTokens;
  body.chat_template_kwargs = {
    ...(body.chat_template_kwargs ?? {}),
    enable_thinking: thinkingTokens !== 0,
  };
  body.reasoning_control = true;

  return body;
}

function substituteSystemPromptVariables(
  prompt: string,
  profile: Profile | null,
): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const datetimeStr = `${dateStr} ${timeStr}`;
  const dayOfWeek = now.toLocaleDateString(undefined, { weekday: 'long' });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const profilename = profile?.name ?? '';
  const modelname =
    profile?.modelFilename ??
    (profile?.model ? path.basename(profile.model) : '');
  const contextlength =
    currentContextSize != null ? String(currentContextSize) : '';

  return prompt.replace(
    /\{(date|time|datetime|dayOfWeek|timezone|profilename|modelname|contextlength)\}/g,
    (_match, key) => {
      switch (key) {
        case 'date':
          return dateStr;
        case 'time':
          return timeStr;
        case 'datetime':
          return datetimeStr;
        case 'dayOfWeek':
          return dayOfWeek;
        case 'timezone':
          return timezone;
        case 'profilename':
          return profilename;
        case 'modelname':
          return modelname;
        case 'contextlength':
          return contextlength;
        default:
          return _match;
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
    lastPreloadStats = { stats: promptStats, toolCount: tools.length };
    onDone(promptStats, tools.length);
  };

  try {
    const body: Record<string, any> = {
      messages: [
        {
          role: 'system',
          content: substituteSystemPromptVariables(
            systemPrompt,
            currentProfile,
          ),
        },
      ],
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
                lastPreloadStats = {
                  stats: promptStats,
                  toolCount: tools.length,
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
              lastPreloadStats = { stats: pFromUsage, toolCount: tools.length };
              if (onDone) onDone(pFromUsage, tools.length);
            }
          } catch (e) {}
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
): Promise<{
  success: boolean;
  error?: string;
  profile?: any;
  backend?: string;
}> {
  const prevMutex = loadProfileMutex;
  let releaseMutex: () => void = () => {};
  loadProfileMutex = new Promise<void>((r) => {
    releaseMutex = r;
  });
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
      const { backendFolder, serverPath } = await resolveBackend(settings);
      console.log(`Backend: ${backendFolder}`);

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
        onStatus?.({
          phase: 'solving',
          message: `Optimizing Profile "${profile.name}"…`,
        });
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
      onStatus?.({
        phase: 'unloading',
        message: 'Unloading Previous Profile…',
      });
      await unloadPromise;

      lastResolvedMemory = result.memory;
      currentContextSize = result.ctx;

      onStatus?.({ phase: 'loadprofile', message: `Loading New Profile…` });
      if (!chatFunctions) chatFunctions = createChatFunctions();
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

      // Filter projector tools when the model has no projector loaded
      if (!fullProjectorPath) {
        activeTools = activeTools.filter((t) => {
          const f = chatFunctions[t.function.name];
          return !f || f.displayType !== 'projector';
        });
      }

      const spawnArgs = buildLlamaServerArgs(profile, {
        modelPath: fullModelPath,
        projectorPath: fullProjectorPath,
        ngl: result.ngl,
        ctx: result.ctx,
      });

      if (fullProjectorPath) {
        currentProjector = fullProjectorPath;
      } else {
        currentProjector = null;
      }

      console.log(
        `NGL=${result.ngl}, Context=${result.ctx}, autoOptimizer=${(profile as any).autoOptimizer}`,
      );
      onStatus?.({ phase: 'starting', message: 'Loading AI Model…' });

      // Defensive kill: ensure no stale server process before spawning
      if (serverProcess) {
        await unloadModel();
      }

      // OpenVINO runtime tuning: expose device selection and stateful
      // execution via GGML_* environment variables (no-op on other backends)
      const spawnEnv: Record<string, string | undefined> = { ...process.env };
      if (/openvino/i.test(backendFolder)) {
        const ovDevice = settings.openvinoDevice || 'CPU';
        spawnEnv.GGML_OPENVINO_DEVICE = ovDevice;
        if (settings.openvinoStateful && ovDevice !== 'NPU') {
          spawnEnv.GGML_OPENVINO_STATEFUL_EXECUTION = '1';
        }
      }

      const proc = spawn(serverPath, spawnArgs, { env: spawnEnv });
      serverProcess = proc;

      // Self-heal: if the server crashes or exits on its own, clear the
      // stale handle so future loads don't try to unload a dead process.
      // Identity guard prevents a late-fired exit from clobbering a
      // freshly spawned replacement (unloadModel nulls before killing).
      proc.once('exit', () => {
        if (serverProcess === proc) {
          serverProcess = null;
          currentProjector = null;
        }
      });

      proc.stderr?.on('data', (d) => {
        serverErrorLog += d.toString();
      });

      let ready = false;
      for (let i = 0; i < 45; i++) {
        // Abort immediately if server was shut down while still loading (all phases)
        if (serverProcess !== proc) {
          throw new Error('Server shutdown requested');
        }
        try {
          const host = (profile as any).host ?? '127.0.0.1';
          const port = (profile as any).port ?? 9931;
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
        const detail =
          errorLines.length > 0
            ? errorLines.join('\n')
            : serverErrorLog.trim().slice(0, 2000);
        throw new Error(`Inference server failed to respond.\n\n${detail}`);
      }

      const resolvedSystemPrompt = substituteSystemPromptVariables(
        profile.systemPrompt,
        profile,
      );
      const systemTokens = (await tokenize(resolvedSystemPrompt)) ?? 0;
      const toolTokens =
        activeTools.length > 0
          ? ((await tokenize(JSON.stringify(activeTools))) ?? 0)
          : 0;
      lastUsage = { used: systemTokens + toolTokens, total: result.ctx };

      onStatus?.({ phase: 'ready', message: '' });
      currentProfile = profile;
      currentSystemPrompt = resolvedSystemPrompt;
      lastPreloadStats = null;

      if (updatedProfile) {
        return {
          success: true,
          profile: updatedProfile,
          backend: backendFolder,
        };
      }
      return { success: true, backend: backendFolder };
    } catch (error: any) {
      onStatus?.({ phase: 'ready', message: '' });
      return { success: false, error: error.message };
    }
  } finally {
    releaseMutex();
  }
}

// --- Message construction (mirrors the renderer's display logic) ---
function appendAssistantToken(
  s: SessionStream,
  token: string,
  segmentType?: 'thought' | 'comment' | 'tool',
): void {
  const messages = s.messages;
  const last = messages[messages.length - 1];

  let currentType: 'thought' | 'comment' | 'normal' = 'normal';
  if (segmentType === 'thought') currentType = 'thought';
  else if (segmentType === 'comment') currentType = 'comment';

  if (last && last.role === 'assistant') {
    const updatedContent = [...last.content];
    const lastSegment = updatedContent[updatedContent.length - 1];

    if (lastSegment && lastSegment.type === currentType) {
      updatedContent[updatedContent.length - 1] = {
        ...lastSegment,
        text: lastSegment.text + token,
      };
    } else {
      s.segmentCounter += 1;
      updatedContent.push({
        id: `seg-${Date.now()}-${s.segmentCounter}`,
        text: token,
        type: currentType,
      });
    }

    s.messages = [
      ...messages.slice(0, -1),
      { ...last, content: updatedContent },
    ];
    return;
  }

  const id = s.messageCounter;
  s.messageCounter += 1;

  let initialType: 'thought' | 'comment' | 'normal' = 'normal';
  if (segmentType === 'thought') initialType = 'thought';
  else if (segmentType === 'comment') initialType = 'comment';

  s.segmentCounter += 1;
  s.messages = [
    ...messages,
    {
      id,
      role: 'assistant',
      content: [
        {
          id: `seg-${Date.now()}-${s.segmentCounter}`,
          text: token.replace(/^\s+/, ''),
          type: initialType,
        },
      ],
    },
  ];
}

function handleFunctionCalling(s: SessionStream, name: string): string {
  const updatedMessages = [...s.messages];
  const lastMessage = updatedMessages[updatedMessages.length - 1];

  const segId = randomUUID();
  s.pendingSegmentIds.push(segId);

  const toolSegment: MessageSegment = {
    id: segId,
    text: '',
    type: 'tool',
    toolName: name,
    toolStatus: 'calling',
  };

  if (lastMessage?.role === 'assistant') {
    lastMessage.content = [...lastMessage.content, toolSegment];
  } else {
    const assistantMessage: Message = {
      id: s.messageCounter,
      role: 'assistant',
      content: [toolSegment],
    };
    s.messageCounter += 1;
    updatedMessages.push(assistantMessage);
  }

  s.toolQueue.push(toolSegment.id);
  s.messages = updatedMessages;
  s.streamingTool = {
    name,
    text: s.streamingTool?.name === name ? (s.streamingTool.text ?? '') : '',
  };
  return segId;
}

function handleFunctionCall(
  s: SessionStream,
  name: string,
  params: string,
  segId?: string,
): void {
  s.streamingTool = null;
  const updatedMessages = [...s.messages];
  const lastMessage = updatedMessages[updatedMessages.length - 1];

  const targetId = segId ?? s.toolQueue[0];
  if (lastMessage?.role === 'assistant' && targetId) {
    const toolSegment = lastMessage.content.find((seg) => seg.id === targetId);
    if (toolSegment && toolSegment.type === 'tool') {
      toolSegment.toolParams = params;
    }
  }

  s.messages = updatedMessages;
}

function handleFunctionResult(
  s: SessionStream,
  payload: any,
  segId?: string,
): void {
  s.isReprocessing = true;
  const updatedMessages = [...s.messages];
  const lastMessage = updatedMessages[updatedMessages.length - 1];

  const targetId = segId ?? s.toolQueue[0];
  if (lastMessage?.role === 'assistant' && targetId) {
    const toolSegment = lastMessage.content.find((seg) => seg.id === targetId);
    if (toolSegment && toolSegment.type === 'tool') {
      toolSegment.toolStatus = 'done';
      toolSegment.toolResult = payload.result;
      const imgData = payload._image;
      if (imgData) {
        toolSegment.displayedImage = {
          url: imgData.url,
          altText: imgData.altText,
        };
      }
    }
  }

  if (segId) {
    s.toolQueue = s.toolQueue.filter((id) => id !== segId);
  } else {
    s.toolQueue.shift();
  }
  s.messages = updatedMessages;
}

function handlePromptDone(
  s: SessionStream,
  promptStats: GenerationStatsData,
): void {
  if (s.isReprocessing) {
    s.isReprocessing = false;
    if (s.pendingSegmentIds.length > 0) {
      const ids = s.pendingSegmentIds.splice(0);
      const updated = [...s.messages];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = {
          ...last,
          content: last.content.map((seg) =>
            seg.type === 'tool' && ids.includes(seg.id)
              ? { ...seg, reprocessStats: promptStats }
              : seg,
          ),
        };
        s.messages = updated;
      }
    }
    return;
  }

  const updated = [...s.messages];
  for (let i = updated.length - 1; i >= 0; i -= 1) {
    if (updated[i].role === 'user' && !updated[i].promptStats) {
      updated[i] = { ...updated[i], promptStats };
      break;
    }
  }
  s.messages = updated;
}

function finishSession(sessionId: string, stats?: GenerationStats): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.status = 'idle';
  if (stats && s.messages.length > 0) {
    const last = s.messages[s.messages.length - 1];
    if (last.role === 'assistant' && !last.stats) {
      s.messages = [...s.messages.slice(0, -1), { ...last, stats }];
    }
  }
  s.abortController = null;
  s.currentReader = null;
  s.streamingTool = null;
  s.promptProgress = 0;
  cancelPendingInput(s);
  persistSessionState(sessionId);
  emit({ type: 'done', sessionId, ...(stats ? { stats } : {}) });
  emitSessionChanged(sessionId);
}

export function failSession(sessionId: string, message: string): void {
  const s = sessions.get(sessionId);
  if (!s || s.failed) return;
  s.failed = true;
  s.aborted = true;
  s.abortController?.abort();
  s.abortController = null;
  s.currentReader = null;
  s.status = 'idle';
  cancelPendingInput(s);
  persistSessionState(sessionId);
  emit({ type: 'done', sessionId });
  emit({ type: 'error', sessionId, message });
  emitSessionChanged(sessionId);
}

// --- Streaming engine ---
export async function sendMessage(
  sessionId: string,
  text: string,
  contentParts?: {
    kind: string;
    url?: string;
    filePath?: string;
    text?: string;
  }[],
  displayItems?: MediaDisplayItem[],
  thinkingTokens?: number,
): Promise<SendMessageResponse> {
  if (!currentProfile) throw new Error('No profile loaded');
  const s = getSessionState(sessionId);
  if (!s) throw new Error('Session not found');
  if (s.status !== 'idle') throw new Error('Session is already generating');

  const userTokens = (await tokenize(text)) ?? 0;
  let currentNewTokens = userTokens;
  if (lastUsage) {
    lastUsage = { used: lastUsage.used + userTokens, total: lastUsage.total };
  }

  const userContent: any[] = [];
  if (contentParts && contentParts.length > 0) {
    contentParts.forEach((part) => {
      if (part.kind === 'image_url' && part.url) {
        userContent.push({ type: 'image_url', image_url: { url: part.url } });
      } else if (part.kind === 'text' && part.text) {
        userContent.push({ type: 'text', text: part.text });
      }
    });
  }
  userContent.push({ type: 'text', text });

  // Build the user Message (mirrors the renderer's construction)
  s.segmentCounter += 1;
  const userMsg: Message = {
    id: s.messageCounter,
    role: 'user',
    content: [
      {
        id: `seg-${Date.now()}-${s.segmentCounter}`,
        text,
        type: 'normal',
        mediaItems:
          displayItems && displayItems.length > 0 ? displayItems : undefined,
      },
    ],
  };
  s.messageCounter += 1;

  const nextMessages = [...s.messages];
  if (!s.systemInserted && lastPreloadStats) {
    nextMessages.push({
      id: s.messageCounter,
      role: 'system',
      content: [
        {
          id: `seg-sys-${Date.now()}`,
          text:
            lastPreloadStats.toolCount > 0
              ? `System Prompt with ${lastPreloadStats.toolCount} tools`
              : 'System Prompt',
          type: 'normal',
        },
      ],
      promptStats: lastPreloadStats.stats,
    });
    s.messageCounter += 1;
  }
  s.systemInserted = true;
  nextMessages.push(userMsg);
  s.messages = nextMessages;

  // Ensure conversation history includes the current system prompt
  if (s.history[0]?.role !== 'system' && currentSystemPrompt) {
    s.history = [
      { role: 'system', content: currentSystemPrompt },
      ...s.history,
    ];
  }
  s.history.push({ role: 'user', content: userContent });
  persistSessionState(sessionId);

  s.status = 'generating';
  s.aborted = false;
  s.failed = false;
  s.abortController = new AbortController();
  s.promptProgress = 0;
  s.streamingTool = null;
  emitSessionChanged(sessionId);

  // Token counts per output category, accumulated across all tool-loop rounds
  // so the breakdown covers the full message (response, thinking, tool calls).
  let responseTokenCount = 0;
  let thinkingTokenCount = 0;
  let toolTokenCount = 0;

  const runCompletion = async (): Promise<SendMessageResponse> => {
    const response = await fetch(getServerUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildChatBody(s.history, activeTools, thinkingTokens),
      ),
      signal: s.abortController?.signal,
    });

    if (!response.ok) {
      let serverMessage = '';
      try {
        const errData = await response.json();
        serverMessage = errData?.error?.message ?? JSON.stringify(errData);
      } catch {
        serverMessage = `HTTP ${response.status}`;
      }
      if (isSlotUnavailableError(response.status, serverMessage)) {
        emit({ type: 'slot-unavailable', sessionId });
        throw new SlotUnavailableError();
      }
      throw new Error(serverMessage || `HTTP ${response.status}`);
    }

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    s.currentReader = reader;
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
        if (s.aborted) {
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
              s.promptProgress = pct;
              emit({
                type: 'progress',
                sessionId,
                progress: pct,
              });
              // Prompt processing complete — send stats immediately
              if (total > 0 && processed >= total && !promptStats) {
                const timeS = (time_ms || 0) / 1000;
                const pStats: GenerationStats = {
                  tokens: currentNewTokens,
                  timeMs: time_ms || 0,
                  tokensPerSecond: timeS > 0 ? currentNewTokens / timeS : 0,
                };
                promptStats = pStats;
                handlePromptDone(s, pStats);
                emit({
                  type: 'prompt-done',
                  sessionId,
                  stats: pStats,
                });
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
                responseTokens: responseTokenCount,
                thinkingTokens: thinkingTokenCount,
                toolTokens: toolTokenCount,
              };
              const pFromUsage: GenerationStats = {
                tokens: currentNewTokens,
                timeMs: data.timings?.prompt_ms || 0,
                tokensPerSecond: data.timings?.prompt_per_second || 0,
              };
              // Only set if not already sent via progress events
              if (!promptStats) {
                promptStats = pFromUsage;
                handlePromptDone(s, pFromUsage);
                emit({
                  type: 'prompt-done',
                  sessionId,
                  stats: pFromUsage,
                });
              }
            }

            const delta = data.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              fullResponse += delta.content;
              responseTokenCount += 1;
              if (s.promptProgress !== 0) {
                s.promptProgress = 0;
                emit({ type: 'progress', sessionId, progress: 0 });
              } else {
                s.promptProgress = 0;
              }
              appendAssistantToken(s, delta.content);
              emit({
                type: 'token',
                sessionId,
                token: delta.content,
              });
            }
            if (delta.reasoning_content) {
              if (s.promptProgress !== 0) {
                s.promptProgress = 0;
                emit({ type: 'progress', sessionId, progress: 0 });
              } else {
                s.promptProgress = 0;
              }
              thinkingTokenCount += 1;
              appendAssistantToken(s, delta.reasoning_content, 'thought');
              emit({
                type: 'token',
                sessionId,
                token: delta.reasoning_content,
                segmentType: 'thought',
              });
            }
            if (delta.tool_calls) {
              delta.tool_calls.forEach((tc: any) => {
                if (!toolCalls[tc.index])
                  toolCalls[tc.index] = { id: tc.id, name: '', args: '', segId: '' };
                if (tc.function?.name) {
                  if (!toolCalls[tc.index].segId) {
                    const segId = handleFunctionCalling(s, tc.function.name);
                    toolCalls[tc.index].segId = segId;
                    toolCalls[tc.index].name = tc.function.name;
                    emit({
                      type: 'function-calling',
                      sessionId,
                      id: segId,
                      toolCallId: tc.id,
                      name: tc.function.name,
                      tags: chatFunctions[tc.function.name]?.tags,
                    });
                  } else {
                    toolCalls[tc.index].name = tc.function.name;
                  }
                }
                if (tc.function?.arguments) {
                  toolCalls[tc.index].args += tc.function.arguments;
                  toolTokenCount += 1;
                  if (s.streamingTool) {
                    s.streamingTool = {
                      ...s.streamingTool,
                      text: s.streamingTool.text + tc.function.arguments,
                    };
                  }
                  emit({
                    type: 'token',
                    sessionId,
                    token: tc.function.arguments,
                    segmentType: 'tool',
                  });
                }
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
      s.currentReader = null;
    }

    if (s.aborted) {
      finishSession(sessionId);
      return { content: 'Aborted' };
    }

    if (toolCalls.length > 0) {
      s.status = 'tool-running';
      emitSessionChanged(sessionId);
      const toolCallRequests = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      }));
      const toolCallRequestStr = JSON.stringify(toolCallRequests);
      const toolCallRequestTokens = (await tokenize(toolCallRequestStr)) ?? 0;
      let totalResultTokens = 0;
      s.history.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCallRequests,
      });
      // Emit all function-call params upfront so every card becomes expandable immediately
      for (const tc of toolCalls) {
        if (chatFunctions[tc.name]?.tags?.includes('web_search')) addWebSearch();
        handleFunctionCall(s, tc.name, tc.args, tc.segId);
        emit({
          type: 'function-call',
          sessionId,
          id: tc.segId,
          toolCallId: tc.id,
          name: tc.name,
          params: tc.args,
          tags: chatFunctions[tc.name]?.tags,
        });
      }
      // --- Parallel tool execution with configurable concurrency, interactive deferral ---
      // UI (messages / checkmarks) commits immediately per completion order,
      // LLM history (s.history) is deferred and applied in index order.
      const rawLimit = (loadSettings().toolConcurrencyLimit ?? 10) as number;
      const concurrencyLimit = rawLimit === 0 ? 0 : Math.max(1, Math.floor(rawLimit));

      type BufferedLLM = {
        resultStr: string;
        payload: any;
        imageData: any;
        sourcesData: any;
        topSourcesData: any;
      };

      const firstResults: PromiseSettledResult<any>[] = new Array(toolCalls.length);
      const llmBuffers: (BufferedLLM | undefined)[] = new Array(toolCalls.length);
      const isInteractive: boolean[] = new Array(toolCalls.length).fill(false);

      const prepareBuffer = (result: any, tc: any): BufferedLLM => {
        let modelContent: any = result;
        let imageData: any = null;
        if (result && typeof result === 'object' && '_response' in result) {
          modelContent = (result as any)._response;
          imageData = (result as any)._image ?? null;
        }
        /* eslint-disable no-underscore-dangle */
        const sourcesData =
          result && typeof result === 'object' && '_sources' in result ? (result as any)._sources : undefined;
        const topSourcesData =
          result && typeof result === 'object' && '_top_sources' in result ? (result as any)._top_sources : undefined;
        /* eslint-enable no-underscore-dangle */
        const resultStr = JSON.stringify(modelContent);
        const payload: any = { result: resultStr };
        if (imageData && tc.name !== 'read_media_file') payload._image = imageData;
        if (sourcesData) payload._sources = sourcesData;
        if (topSourcesData) payload._top_sources = topSourcesData;
        return { resultStr, payload, imageData, sourcesData, topSourcesData };
      };

      const commitImmediateUI = (idx: number, buffered: BufferedLLM): void => {
        const tc = toolCalls[idx];
        const { payload, sourcesData, topSourcesData } = buffered;
        const toolTags = chatFunctions[tc.name]?.tags;
        if (sourcesData || topSourcesData) {
          const incoming: Source[] = [];
          if (Array.isArray(sourcesData)) {
            incoming.push(
              ...sourcesData.map((src: any) => ({
                title: src.title,
                url: src.url,
                kind: 'other' as const,
              })),
            );
          }
          if (Array.isArray(topSourcesData) && toolTags?.includes('top_source')) {
            incoming.push(
              ...topSourcesData.map((src: any) => ({
                title: src.title,
                url: src.url,
                kind: 'top' as const,
              })),
            );
          }
          if (incoming.length > 0) {
            s.sources = mergeSources(s.sources, incoming);
          }
        }
        handleFunctionResult(s, payload, tc.segId);
        emit({
          type: 'function-result',
          sessionId,
          id: tc.segId,
          toolCallId: tc.id,
          name: tc.name,
          result: buffered.resultStr,
          _image: buffered.imageData && tc.name !== 'read_media_file' ? buffered.imageData : undefined,
          _sources: sourcesData,
          _top_sources: topSourcesData,
          tags: chatFunctions[tc.name]?.tags,
        });
        persistSessionState(sessionId);
      };

      const commitDeferredLLM = async (idx: number): Promise<void> => {
        const tc = toolCalls[idx];
        const buffered = llmBuffers[idx];
        if (!buffered) return;
        if (lastUsage) {
          const resultTokens = (await tokenize(buffered.resultStr)) ?? 0;
          totalResultTokens += resultTokens;
          lastUsage = { used: lastUsage.used + resultTokens, total: lastUsage.total };
        }
        s.history.push({ role: 'tool', tool_call_id: tc.id, content: buffered.resultStr });
        if (buffered.imageData && chatFunctions[tc.name]?.displayType === 'projector') {
          s.history.push({
            role: 'tool',
            content: [
              { type: 'text', text: `[Image from tool: ${buffered.imageData.altText || 'media'}]` },
              { type: 'image_url', image_url: { url: buffered.imageData.url } },
            ],
          });
        }
      };

      // Phase 1: parallel first invocation with immediate UI per completion order
      await (async () => {
        const runOne = async (idx: number): Promise<void> => {
          if (s.aborted) {
            firstResults[idx] = { status: 'rejected', reason: new Error('Aborted') } as PromiseRejectedResult;
            return;
          }
          const tc = toolCalls[idx];
          try {
            const h = chatFunctions[tc.name]?.handler;
            if (!h) throw new Error(`Tool handler not found: ${tc.name}`);
            const toolContext = { sessionId, profileId: s.profileId };
            const v = await h(JSON.parse(tc.args), toolContext);
            firstResults[idx] = { status: 'fulfilled', value: v } as PromiseFulfilledResult<any>;
            if (v && typeof v === 'object' && (v as any)._userInput) {
              isInteractive[idx] = true;
              // interactive probe stays in calling state until Phase 3
              return;
            }
            const buffered = prepareBuffer(v, tc);
            llmBuffers[idx] = buffered;
            commitImmediateUI(idx, buffered);
          } catch (e) {
            firstResults[idx] = { status: 'rejected', reason: e } as PromiseRejectedResult;
            const buffered = prepareBuffer({ error: e instanceof Error ? e.message : String(e) }, tc);
            llmBuffers[idx] = buffered;
            commitImmediateUI(idx, buffered);
          }
        };

        if (concurrencyLimit === 0) {
          await Promise.all(toolCalls.map((_, i) => runOne(i)));
        } else {
          let next = 0;
          const workers = Array(Math.min(concurrencyLimit, toolCalls.length))
            .fill(0)
            .map(async () => {
              // eslint-disable-next-line no-await-in-loop
              while (next < toolCalls.length) {
                if (s.aborted) break;
                const idx = next;
                next += 1;
                // eslint-disable-next-line no-await-in-loop
                await runOne(idx);
              }
            });
          await Promise.all(workers);
        }
      })();

      // Build index lists (interactive probe vs non-interactive)
      const nonInteractiveIndices: number[] = [];
      const interactiveIndices: number[] = [];
      for (let i = 0; i < toolCalls.length; i += 1) {
        if (isInteractive[i]) interactiveIndices.push(i);
        else nonInteractiveIndices.push(i);
      }

      // Phase 3: interactive sequential after all non-interactive (preserves single pendingInput)
      // Immediate UI for interactive stays deferred until after user response; LLM buffers filled here
      const sortedInteractive = [...interactiveIndices].sort((a, b) => a - b);
      for (const idx of sortedInteractive) {
        if (s.aborted) break;
        const rInter = firstResults[idx];
        if (!rInter || rInter.status !== 'fulfilled') continue;
        const tc = toolCalls[idx];
        const firstVal = (rInter as PromiseFulfilledResult<any>).value;
        const userInput = (firstVal as any)._userInput;
        const inputReq: UserInputRequest = {
          requestId: tc.id,
          type: userInput.type || 'confirm',
          title: userInput.title || (userInput.type === 'confirm' ? 'Action Required' : 'Question'),
          prompt: userInput.prompt || `Allow ${tc.name}?`,
          options: userInput.options,
          toolName: tc.name,
          toolParams: JSON.parse(tc.args),
        };
        s.status = 'awaiting-tool';
        emit({ type: 'user-input', sessionId, request: inputReq });
        emitSessionChanged(sessionId);
        // eslint-disable-next-line no-await-in-loop
        const userResponse = await waitForSessionInput(s, inputReq);
        s.status = 'tool-running';
        emitSessionChanged(sessionId);
        const handler = chatFunctions[tc.name]?.handler;
        const toolContext = { sessionId, profileId: s.profileId };
        let finalResult: any;
        if (inputReq.type === 'confirm') {
          if (userResponse.action === 'confirmed') {
            // eslint-disable-next-line no-await-in-loop
            finalResult = await handler({ ...JSON.parse(tc.args), _confirmed: true }, toolContext);
          } else {
            finalResult = { _denied: true, message: 'User denied this action.' };
          }
        } else {
          finalResult = { _userResponse: userResponse.action, value: userResponse.value };
        }
        const buffered = prepareBuffer(finalResult, tc);
        llmBuffers[idx] = buffered;
        commitImmediateUI(idx, buffered);
      }

      // Final: deferred LLM history in global index order (0..n-1) so model sees original call order
      // This runs after immediate UI checks have already been emitted per completion order,
      // but before the next model turn.
      const allSorted = Array.from({ length: toolCalls.length }, (_, i) => i).sort((a, b) => a - b);
      for (const idx of allSorted) {
        if (s.aborted) break;
        if (!llmBuffers[idx]) continue;
        // eslint-disable-next-line no-await-in-loop
        await commitDeferredLLM(idx);
      }
      if (toolCalls.length > 0) {
        persistSessionState(sessionId);
      }

      currentNewTokens = toolCallRequestTokens + totalResultTokens;
      return runCompletion();
    }

    return { content: fullResponse, stats, promptStats };
  };

  try {
    const result = await runCompletion();
    s.history.push({ role: 'assistant', content: result.content });
    finishSession(sessionId, result.stats);
    return result;
  } catch (e: any) {
    if (e.name === 'AbortError' || s.aborted) {
      finishSession(sessionId);
      return { content: 'Aborted' };
    }
    if (e instanceof SlotUnavailableError) {
      finishSession(sessionId);
      return { content: '' };
    }
    failSession(sessionId, e?.message ?? 'Unknown error');
    throw e;
  }
}

export async function abort(sessionId?: string | null) {
  if (sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.aborted = true;
    cancelPendingInput(s);
    if (s.abortController) {
      s.abortController.abort();
      s.abortController = null;
    }
    return;
  }
  // Abort every live stream (teardown)
  sessions.forEach((s) => {
    s.aborted = true;
    cancelPendingInput(s);
    if (s.abortController) {
      s.abortController.abort();
      s.abortController = null;
    }
  });
  // The main read loop's inner drain loop handles stream cleanup.
  // Do NOT cancel the reader — that leaves the llhttp parser paused.
}

function abortAllStreams(): void {
  sessions.forEach((s) => {
    s.aborted = true;
    cancelPendingInput(s);
    if (s.abortController) {
      s.abortController.abort();
      s.abortController = null;
    }
  });
}

export async function unloadModel() {
  const proc = serverProcess;
  if (proc) {
    serverProcess = null;
    currentProjector = null;
    abortAllStreams();
    // Persist partial content before the streams die with the server
    sessions.forEach((s) => {
      persistSessionState(s.sessionId);
      emitSessionChanged(s.sessionId);
    });
    proc.kill();
    // 'exit' only ever emits once — a process that already crashed
    // (or failed to spawn) would leave this await hanging forever
    if (proc.exitCode === null && proc.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        proc.once('error', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
  currentContextSize = null;
  lastUsage = null;
  currentSystemPrompt = '';
  lastPreloadStats = null;
}

export function hasConversationContext(): boolean {
  let hasContext = false;
  sessions.forEach((s) => {
    if (s.history.length > 1) hasContext = true;
  });
  return hasContext;
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
