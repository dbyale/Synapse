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
import type { ContextShiftSettings, Profile } from '../renderer/types/profile';
import { DEFAULT_CONTEXT_SHIFT } from '../renderer/types/profile';
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
  totalTokens?: number;
  isColdStart?: boolean;
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
  /** Authoritative usage total at the last anchor (prompt/usage/snap/send). */
  usageBasisTokens: number;
  /** streamedLen value at the last anchor; the estimate counts chars after it. */
  usageBasisLen: number;
  /** Set when a mid-generation context shift is requested; distinct from user abort. */
  midShiftRequested: boolean;
  /** Chars streamed this turn (content + reasoning); O(1) re-arm clock. */
  midShiftStreamedLen: number;
  /** Streamed-char watermark: generation may only trigger at or past this. */
  midShiftNextAllowedAt: number;
  /** Tokens of the live response dropped from context so far (all types). */
  midShiftDroppedTokens: number;
  /** Rescue retry (trim + one leg retry on context-exceeded) used this turn. */
  midShiftRescueDone: boolean;
  /** History index of the mid-shift prefill assistant entry (-1 if none). */
  midShiftPrefillIndex: number;
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
let currentContextShift: ContextShiftSettings | null = null;
// Session whose history lastUsage was measured against. lastUsage is global
// but histories are per-session: whenever these diverge (restored chat,
// session switch, unload, profile/ctx change) the counters are fiction until
// refreshUsageFromHistory re-anchors them.
let usageSessionId: string | null = null;

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

// Anchor the usage estimator: record an authoritative total and restart the
// char clock. Every direct lastUsage write should go through here (except the
// per-object estimator itself) so the running estimate never double-counts.
function anchorUsage(s: SessionStream, used: number, total: number): void {
  s.usageBasisTokens = used;
  s.usageBasisLen = s.midShiftStreamedLen;
  lastUsage = { used, total };
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
  failedMessageId?: number;

  status?: number;

  code: 'slot-unavailable' = 'slot-unavailable';

  constructor(failedMessageId?: number, status?: number) {
    super('No generation slot is free');
    this.name = 'SlotUnavailableError';
    this.failedMessageId = failedMessageId;
    this.status = status;
  }
}

/** Thrown when the server rejects the prompt before accepting it. */
class PreAcceptError extends Error {
  code: 'context-exceeded' | 'connection' | 'slot-unavailable' | 'rejected';

  failedMessageId: number;

  status?: number;

  constructor(
    message: string,
    code: 'context-exceeded' | 'connection' | 'slot-unavailable' | 'rejected',
    failedMessageId: number,
    status?: number,
  ) {
    super(message);
    this.name = 'PreAcceptError';
    this.code = code;
    this.failedMessageId = failedMessageId;
    this.status = status;
  }
}

export type PreAcceptErrorCode = PreAcceptError['code'];

export function isContextLengthError(status: number, message: string): boolean {
  if (!message) return false;
  return /context|n_ctx|nctx|ctx.?size|prompt.*too (long|large)|exceed.*(context|token|limit|n_ctx)|too many tokens|input.*too long|maximum context|out of context|kv cache|no space in the kv/i.test(
    message,
  );
}

export function isConnectionErrorMessage(message: string): boolean {
  if (!message) return false;
  return /failed to fetch|fetch failed|econnrefused|econnreset|econnaborted|enotfound|network|socket hang up|connection (refused|reset|closed|aborted|lost)|net::|load failed|server.+not.+respond|no response body/i.test(
    message,
  );
}

export function classifyPreAcceptError(
  status: number | undefined,
  message: string,
): PreAcceptErrorCode {
  const msg = message ?? '';
  if (status !== undefined && isSlotUnavailableError(status, msg))
    return 'slot-unavailable';
  if (isContextLengthError(status ?? 0, msg)) return 'context-exceeded';
  if (
    status === undefined ||
    status === 0 ||
    isConnectionErrorMessage(msg) ||
    /no response body/i.test(msg)
  )
    return 'connection';
  return 'rejected';
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
    // Migrate legacy segId-based splice markers to char offsets (absolute
    // over the message's joined prose); unresolvable markers are dropped.
    const messages = stored.messages.map((m) => {
      const legacy = (m as any)?.contextSpliceAt as
        | { segId?: string; offset?: number }
        | undefined;
      if (!legacy || typeof legacy.offset !== 'number') {
        if (legacy !== undefined) {
          const cleaned = { ...m };
          delete (cleaned as any).contextSpliceAt;
          return cleaned;
        }
        return m;
      }
      let acc = 0;
      let chars: number | null = null;
      for (let i = 0; i < m.content.length; i += 1) {
        const seg = m.content[i];
        if (
          seg.type === 'normal' ||
          seg.type === 'thought' ||
          seg.type === 'comment'
        ) {
          if (seg.id === legacy.segId) {
            chars = acc + Math.max(0, Math.min(legacy.offset, seg.text.length));
            break;
          }
          acc += seg.text.length;
        }
      }
      const migrated = { ...m };
      delete (migrated as any).contextSpliceAt;
      if (chars !== null) migrated.contextSpliceChars = chars;
      return migrated;
    });
    s = {
      sessionId,
      profileId: stored.profileId,
      title: stored.title,
      createdAt: stored.createdAt,
      messages,
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
      usageBasisTokens: 0,
      usageBasisLen: 0,
      midShiftRequested: false,
      midShiftStreamedLen: 0,
      midShiftNextAllowedAt: 0,
      midShiftDroppedTokens: 0,
      midShiftRescueDone: false,
      midShiftPrefillIndex: -1,
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
    usageBasisTokens: 0,
    usageBasisLen: 0,
    midShiftRequested: false,
    midShiftStreamedLen: 0,
    midShiftNextAllowedAt: 0,
    midShiftDroppedTokens: 0,
    midShiftRescueDone: false,
    midShiftPrefillIndex: -1,
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

export function getSessionForTool(sessionId: string): SavedSession | null {
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
      if (
        next === '"' ||
        next === "'" ||
        next === '\\' ||
        next === ' ' ||
        next === '\t'
      ) {
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
    const { dry } = p.repeatPenalty;
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
      const totalTokens = lastProgress.total;
      const isColdStart = (lastProgress.cache || 0) === 0 && totalTokens > 0;
      promptStats = {
        tokens: newTokens,
        timeMs,
        tokensPerSecond: timeS > 0 ? newTokens / timeS : 0,
        totalTokens,
        isColdStart,
      };
    } else {
      promptStats = {
        tokens: 0,
        timeMs: 0,
        tokensPerSecond: 0,
        totalTokens: 0,
        isColdStart: false,
      };
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
                const totalTokens = total;
                const isColdStart = (cache || 0) === 0 && totalTokens > 0;
                promptStats = {
                  tokens: newTokens,
                  timeMs: time_ms || 0,
                  tokensPerSecond: timeS > 0 ? newTokens / timeS : 0,
                  totalTokens,
                  isColdStart,
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
              const tokens =
                data.timings?.prompt_n ?? data.usage.prompt_tokens ?? 0;
              const totalTokens = data.usage.total_tokens ?? tokens;
              // usage path: if totalTokens is significantly larger than prompt_n, treat as cold
              const isColdStart = totalTokens > tokens + 64;
              const pFromUsage: GenerationStats = {
                tokens,
                timeMs: data.timings?.prompt_ms || 0,
                tokensPerSecond: data.timings?.prompt_per_second || 0,
                totalTokens,
                isColdStart,
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

      const { autoOptimizer } = profile as any;
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
      // Totals changed: any session's counters need re-anchoring on next use.
      usageSessionId = null;

      onStatus?.({ phase: 'ready', message: '' });
      currentProfile = profile;
      currentContextShift = profile.contextShift ?? null;
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
  const { messages } = s;
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

function collectShiftIndexes(s: SessionStream): {
  systemEnd: number;
  userIndexes: number[];
} {
  const systemEnd = s.history[0]?.role === 'system' ? 1 : 0;
  const userIndexes: number[] = [];
  for (let i = systemEnd; i < s.history.length; i += 1) {
    if (s.history[i].role === 'user') userIndexes.push(i);
  }
  return { systemEnd, userIndexes };
}

// Text eligible for freeing per history entry (text and tool-call payloads;
// kept media still counts against the budget, so image_url parts excluded).
function shiftMessageText(m: ChatHistoryMsg): string {
  const parts: string[] = [];
  if (typeof m.content === 'string') {
    parts.push(m.content);
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  if (m.tool_calls && m.tool_calls.length > 0) {
    parts.push(JSON.stringify(m.tool_calls));
  }
  return parts.join('\n');
}

// eslint-disable-next-line no-use-before-define
async function bulkShiftTokens(
  s: SessionStream,
  from: number,
  to: number,
): Promise<number> {
  const texts: string[] = [];
  for (let i = from; i < to; i += 1) {
    const t = shiftMessageText(s.history[i]);
    if (t) texts.push(t);
  }
  if (texts.length === 0) return 0;
  // eslint-disable-next-line no-use-before-define
  return (await tokenize(texts.join('\n'))) ?? 0;
}

// Effective per-shift removal amount, with migration from the old minimum
// setting. Callers treat 0 as "nothing to remove".
function shiftTokensToShift(cs: ContextShiftSettings): number {
  const v =
    cs.tokensToShift ??
    cs.minTokensToClear ??
    DEFAULT_CONTEXT_SHIFT.tokensToShift;
  return Math.max(0, v);
}

// A droppable span of history for one shift.
interface ShiftUnit {
  start: number;
  end: number; // exclusive
  tokens: number;
  // Splittable text in order, or null for whole-drop-only units. Assistant
  // tool-call records travel whole with their group so call/result pairing
  // stays intact; media/array content is never split.
  splitParts: { entryIdx: number; text: string }[] | null;
}

// Build droppable units over [systemEnd, cap). Plain user/assistant/tool
// strings are splittable; an assistant tool-call record plus its following
// tool entries form one atomic group (splittable only inside result strings,
// call records always travel with kept results); media/array content and
// empty entries are whole-drop only.
function buildShiftUnits(
  s: SessionStream,
  systemEnd: number,
  cap: number,
  perMessage: number[],
): ShiftUnit[] {
  const units: ShiftUnit[] = [];
  let i = systemEnd;
  while (i < cap) {
    const m = s.history[i];
    if (m?.role === 'assistant' && m?.tool_calls && m.tool_calls.length > 0) {
      const parts: { entryIdx: number; text: string }[] = [];
      let tokens = perMessage[i] ?? 0;
      let j = i + 1;
      while (j < cap && s.history[j]?.role === 'tool') {
        const tm = s.history[j];
        tokens += perMessage[j] ?? 0;
        if (typeof tm.content === 'string' && tm.content) {
          parts.push({ entryIdx: j, text: tm.content });
        }
        j += 1;
      }
      units.push({
        start: i,
        end: j,
        tokens,
        splitParts: parts.length > 0 ? parts : null,
      });
      i = j;
    } else if (typeof m?.content === 'string' && m.content) {
      units.push({
        start: i,
        end: i + 1,
        tokens: perMessage[i] ?? 0,
        splitParts: [{ entryIdx: i, text: m.content }],
      });
      i += 1;
    } else {
      units.push({
        start: i,
        end: i + 1,
        tokens: perMessage[i] ?? 0,
        splitParts: null,
      });
      i += 1;
    }
  }
  return units;
}

export interface ShiftCut {
  /** Entries [systemEnd, dropTo) are fully removed. */
  dropTo: number;
  /** Straddling unit/entry split, if the target lands mid-entry. */
  split: { unitEnd: number; entryIdx: number; inner: number } | null;
  /** Authoritative freed estimate for the removed text. */
  freedTokens: number;
}

// Unified cut: oldest-first until targetTokens are freed, splitting any
// entry (user, assistant, or old tool result) when the amount lands inside
// it. System entries and everything from the newest user turn on (the live
// turn, its tool entries and partial output) are always shielded, so a shift
// can never wipe the active exchange no matter how large the target is.
// Display bubbles stay intact; split entries are marked for render-time
// splitting via their msgId link.
async function computeShiftCut(
  s: SessionStream,
  cs: ContextShiftSettings,
  targetTokens: number,
  onProgress?: (fraction: number) => void,
): Promise<ShiftCut> {
  const empty: ShiftCut = { dropTo: 0, split: null, freedTokens: 0 };
  const { systemEnd, userIndexes } = collectShiftIndexes(s);
  if (s.history.length <= systemEnd || targetTokens <= 0) {
    return { ...empty, dropTo: systemEnd };
  }
  const newestUserDefault = s.history.length;
  let newestUser = newestUserDefault;
  if (userIndexes.length > 0) {
    newestUser = userIndexes[userIndexes.length - 1];
  }
  const cap = Math.min(s.history.length, newestUser);
  if (cap <= systemEnd) {
    return { ...empty, dropTo: systemEnd };
  }

  // Measure each entry in parallel, then prefix-sum over the range.
  const perMessage: number[] = new Array(s.history.length).fill(0);
  const targets: { idx: number; text: string }[] = [];
  for (let i = systemEnd; i < cap; i += 1) {
    const t = shiftMessageText(s.history[i]);
    if (t) targets.push({ idx: i, text: t });
  }
  const completedRef = { n: 0 };
  await Promise.all(
    targets.map(async ({ idx, text }) => {
      // eslint-disable-next-line no-use-before-define
      const n = (await tokenize(text)) ?? 0;
      perMessage[idx] = n;
      completedRef.n += 1;
      onProgress?.(
        targets.length > 0 ? (completedRef.n / targets.length) * 0.8 : 1,
      );
      return n;
    }),
  );
  onProgress?.(0.8);

  const units = buildShiftUnits(s, systemEnd, cap, perMessage);
  let acc = 0;
  let dropTo = systemEnd;
  let split: ShiftCut['split'] = null;
  for (let ui = 0; ui < units.length; ui += 1) {
    const u = units[ui];
    if (acc >= targetTokens) break;
    if (
      u.splitParts &&
      u.splitParts.length > 0 &&
      acc + u.tokens > targetTokens
    ) {
      // Straddle: binary-search the drop offset within the unit's splittable
      // text, then snap forward to a markdown block boundary.
      const concat = u.splitParts.map((p) => p.text).join('');
      const need = targetTokens - acc;
      // eslint-disable-next-line no-use-before-define,no-await-in-loop
      const raw = await findTokenPrefixLength(concat, need, (fraction) =>
        onProgress?.(0.8 + 0.2 * fraction),
      );
      // eslint-disable-next-line no-use-before-define
      const snapped = snapSpliceOffset(concat, raw);
      const drop = Math.min(snapped, concat.length - 1);
      if (drop > 0) {
        let rem = drop;
        let entryIdx = -1;
        let inner = 0;
        for (let pi = 0; pi < u.splitParts.length; pi += 1) {
          const { entryIdx: partIdx, text: partText } = u.splitParts[pi];
          const plen = partText.length;
          if (rem < plen) {
            entryIdx = partIdx;
            inner = rem;
            break;
          }
          rem -= plen;
        }
        if (entryIdx >= 0) {
          split = { unitEnd: u.end, entryIdx, inner };
          break;
        }
        // Fell off the end (rounding): whole-drop below.
      }
      // Degenerate (single-char unit): whole-drop below.
    }
    acc += u.tokens;
    dropTo = u.end;
  }
  onProgress?.(1);

  if (dropTo <= systemEnd && !split) {
    return { ...empty, dropTo: systemEnd };
  }
  // Authoritative freed estimate: whole-dropped entries (bulk) plus the
  // straddler head. Unit totals above include tool-call JSON that the head
  // excludes, so accumulation may stop marginally early — always on the
  // floor-preserving side.
  // eslint-disable-next-line no-use-before-define
  const wholeFreed = await bulkShiftTokens(s, systemEnd, dropTo);
  let headFreed = 0;
  if (split) {
    const sp = split;
    const unit = units.find(
      (u) => u.start <= sp.entryIdx && sp.entryIdx < u.end,
    );
    if (unit && unit.splitParts) {
      let head = '';
      for (let pi = 0; pi < unit.splitParts.length; pi += 1) {
        const part = unit.splitParts[pi];
        if (part.entryIdx < sp.entryIdx) {
          head += part.text;
        } else if (part.entryIdx === sp.entryIdx) {
          head += part.text.slice(0, sp.inner);
          break;
        } else {
          break;
        }
      }
      if (head) {
        // eslint-disable-next-line no-use-before-define
        headFreed = (await tokenize(head)) ?? 0;
      }
    }
  }
  const freedTokens = wholeFreed + headFreed;
  if (freedTokens <= 0) {
    return { ...empty, dropTo: systemEnd };
  }
  return { dropTo, split, freedTokens };
}

// Set the cutoff divider on one display message, clearing it elsewhere.
function setCutoffOnMessage(s: SessionStream, id: number): void {
  s.messages = s.messages.map((m) => {
    if (m.id === id) return { ...m, contextCutoff: true };
    if (m.contextCutoff) return { ...m, contextCutoff: false };
    return m;
  });
}

// Applies a unified cut: whole-dropped entries removed (media stubs kept),
// the straddler replaced by its kept tail with call records preserved, usage
// decremented, and both markers placed (cutoff divider after the newest
// fully-dropped message, render-time split on the straddled message via its
// msgId link). Display text is never modified here.
async function applyShiftCut(
  s: SessionStream,
  cs: ContextShiftSettings,
  cut: ShiftCut,
  total: number,
): Promise<void> {
  const { systemEnd, userIndexes } = collectShiftIndexes(s);
  if (cut.dropTo <= systemEnd && !cut.split) return;
  const oldHistoryLength = s.history.length;
  const splitEnd = cut.split ? cut.split.unitEnd : cut.dropTo;
  const splitEntry = cut.split ? s.history[cut.split.entryIdx] : undefined;

  const nextHistory: ChatHistoryMsg[] = [];
  for (let i = 0; i < s.history.length; i += 1) {
    const m = s.history[i];
    if (i < systemEnd || i >= splitEnd) {
      nextHistory.push(m);
    } else if (cut.split && i >= cut.dropTo) {
      if (i < cut.split.entryIdx) {
        // Straddler-group prefix: keep call records so kept results stay
        // paired, drop earlier result text.
        if (
          m?.role === 'assistant' &&
          m?.tool_calls &&
          m.tool_calls.length > 0
        ) {
          nextHistory.push(m);
        }
      } else if (i === cut.split.entryIdx) {
        if (typeof m.content === 'string') {
          const kept: ChatHistoryMsg = {
            role: m.role,
            content: m.content.slice(cut.split.inner),
          };
          if (m.tool_call_id !== undefined) kept.tool_call_id = m.tool_call_id;
          if (m.msgId !== undefined) kept.msgId = m.msgId;
          nextHistory.push(kept);
        } else {
          nextHistory.push(m);
        }
      } else {
        nextHistory.push(m);
      }
    } else {
      const keepMedia =
        m.role === 'user' &&
        cs.preserveAttachments &&
        Array.isArray(m.content) &&
        m.content.some((part: any) => part?.type === 'image_url');
      if (keepMedia) {
        const stub: ChatHistoryMsg = {
          role: 'user',
          content: m.content.filter((part: any) => part?.type === 'image_url'),
        };
        if (m.msgId !== undefined) stub.msgId = m.msgId;
        nextHistory.push(stub);
      }
    }
  }
  s.history = nextHistory;

  if (lastUsage) {
    anchorUsage(
      s,
      Math.max(0, lastUsage.used - cut.freedTokens),
      total,
    );
  }

  // Cutoff divider after the newest fully-dropped message. Failed user
  // bubbles have no history entry, so they are excluded from the ordinal
  // mapping.
  const firstKept = cut.split ? cut.split.entryIdx : cut.dropTo;
  const clearedUserCount = userIndexes.filter((idx) => idx < firstKept).length;
  let seenUsers = 0;
  let cutoffId: number | null = null;
  if (!cut.split && cut.dropTo >= oldHistoryLength) {
    // Everything dropped: mark the newest display message so the divider
    // renders at the end of the visible chat.
    for (let i = s.messages.length - 1; i >= 0; i -= 1) {
      if (s.messages[i].role !== 'system') {
        cutoffId = s.messages[i].id;
        break;
      }
    }
  } else {
    for (let i = 0; i < s.messages.length; i += 1) {
      const m = s.messages[i];
      if (m.role === 'user' && !m.failed) {
        seenUsers += 1;
        if (seenUsers === clearedUserCount + 1) {
          if (i > 0) cutoffId = s.messages[i - 1].id;
          break;
        }
      }
    }
  }
  if (cutoffId !== null) {
    setCutoffOnMessage(s, cutoffId);
  }

  // Render-time split on the straddled message. Tool results address their
  // display segment by ordinal (chronological on both sides); prose offsets
  // are re-measured on display text when it holds thinking the history entry
  // lacks, otherwise the history offset applies directly (identical strings).
  if (cut.split && splitEntry?.msgId !== undefined) {
    const targetId: number = splitEntry.msgId;
    const target = s.messages.find((msg) => msg.id === targetId);
    if (
      target &&
      splitEntry.role === 'tool' &&
      typeof splitEntry.content === 'string'
    ) {
      let ordinal = -1;
      for (let i = 0; i <= cut.split.entryIdx; i += 1) {
        const h = s.history[i];
        if (
          h?.role === 'tool' &&
          typeof h.content === 'string' &&
          h.content &&
          h.msgId === targetId
        ) {
          ordinal += 1;
        }
      }
      if (ordinal >= 0) {
        const toolChars = Math.max(
          0,
          Math.min(cut.split.inner, splitEntry.content.length),
        );
        s.messages = s.messages.map((msg) =>
          msg.id === targetId
            ? {
                ...msg,
                contextSpliceChars: toolChars,
                contextSpliceTool: { ordinal, chars: toolChars },
              }
            : msg,
        );
      }
    } else if (target) {
      let chars: number | null = cut.split.inner;
      if (
        target.role === 'assistant' &&
        splitEntry.role === 'assistant' &&
        target.content.some(
          (seg) => seg.type === 'thought' || seg.type === 'comment',
        ) &&
        typeof splitEntry.content === 'string'
      ) {
        const prose = target.content
          .filter(
            (seg) =>
              seg.type === 'normal' ||
              seg.type === 'thought' ||
              seg.type === 'comment',
          )
          .map((seg) => seg.text)
          .join('');
        const headText = splitEntry.content.slice(0, cut.split.inner);
        // eslint-disable-next-line no-use-before-define
        const headTokens = headText ? ((await tokenize(headText)) ?? 0) : 0;
        if (headTokens > 0 && prose.length > 1) {
          // eslint-disable-next-line no-use-before-define
          const rawD = await findTokenPrefixLength(prose, headTokens);
          // eslint-disable-next-line no-use-before-define
          chars = Math.min(snapSpliceOffset(prose, rawD), prose.length - 1);
        }
      }
      if (chars !== null) {
        s.messages = s.messages.map((msg) =>
          msg.id === targetId ? { ...msg, contextSpliceChars: chars } : msg,
        );
      }
    }
  }
}

// Re-anchor the global counters to a session's actual history. Needed
// whenever the basis diverges: restored chats, session switches, unloads,
// profile/ctx changes. Without this, lastUsage reflects some other session
// (or nothing) and every budget gate decides on fiction. Single bulk
// tokenize; never throws (null on failure, counters untouched).
export async function refreshUsageFromHistory(
  sessionId: string,
): Promise<{ used: number; total: number } | null> {
  const s = sessions.get(sessionId) ?? getSessionState(sessionId);
  if (!s) return lastUsage;
  const total = currentContextSize ?? lastUsage?.total ?? 2048;
  const texts: string[] = [];
  for (let i = 0; i < s.history.length; i += 1) {
    const t = shiftMessageText(s.history[i]);
    if (t) texts.push(t);
  }
  if (texts.length === 0) {
    lastUsage = { used: 0, total };
    s.usageBasisTokens = 0;
    s.usageBasisLen = s.midShiftStreamedLen;
    usageSessionId = sessionId;
    return lastUsage;
  }
  let used: number | null = null;
  try {
    // eslint-disable-next-line no-use-before-define
    used = await tokenize(texts.join('\n'));
  } catch {
    used = null;
  }
  if (used === null) {
    // eslint-disable-next-line no-console
    console.log('[context-shift] usage refresh failed; keeping counters', {
      sessionId,
    });
    return lastUsage;
  }
  lastUsage = { used, total };
  s.usageBasisTokens = used;
  s.usageBasisLen = s.midShiftStreamedLen;
  usageSessionId = sessionId;
  // eslint-disable-next-line no-console
  console.log('[context-shift] usage refreshed from history', {
    sessionId,
    used,
    total,
    historyLen: s.history.length,
  });
  return lastUsage;
}

// Context shift: when the remaining context budget drops below the profile's
// threshold, remove ~tokensToShift oldest-first (splitting entries as
// needed, shielding system and the newest user turn). Display bubbles stay
// intact; split entries render divided around a cutoff marker.
async function applyContextShift(s: SessionStream): Promise<void> {
  const cs = currentContextShift;
  if (!cs?.enabled || !lastUsage) return;

  const total = currentContextSize ?? lastUsage.total;
  const remaining = total - lastUsage.used;
  if (remaining > cs.tokensRemainingUntilShift) return;

  const target = shiftTokensToShift(cs);
  // eslint-disable-next-line no-use-before-define
  const { freed } = await runShift(s, s.sessionId, total, target, 'post-turn');
  // eslint-disable-next-line no-use-before-define
  if (freed <= 0 && isOverMark()) {
    // eslint-disable-next-line no-use-before-define
    await handleHopelessShift(s, s.sessionId);
  }
}

// Budget check shared by the enabled-only checkpoints (tool-round, prefetch):
// integer-only, safe to evaluate anywhere. Unlike shouldRequestMidShift it
// carries no mid-chat requirement.
function isOverMark(): boolean {
  const cs = currentContextShift;
  if (!cs?.enabled || !lastUsage) return false;
  const total = currentContextSize ?? lastUsage.total;
  return total - lastUsage.used <= cs.tokensRemainingUntilShift;
}

// Id of the live assistant display message taking streamed output, for
// linking history entries to the bubbles they render in.
function liveAssistantId(s: SessionStream): number | undefined {
  const m = s.messages[s.messages.length - 1];
  return m?.role === 'assistant' ? m.id : undefined;
}

// Cheap pre-gate (no tokenize calls): is there at least one
// guaranteed-removable entry before the newest user turn? Media stubs kept
// under preserveAttachments do not count.
function hasTrimmableHistory(
  s: SessionStream,
  cs: ContextShiftSettings,
): boolean {
  let newestUserIdx = -1;
  for (let i = s.history.length - 1; i >= 0; i -= 1) {
    if (s.history[i]?.role === 'user') {
      newestUserIdx = i;
      break;
    }
  }
  const sysEnd = s.history[0]?.role === 'system' ? 1 : 0;
  if (newestUserIdx <= sysEnd) return false;
  for (let i = sysEnd; i < newestUserIdx; i += 1) {
    const m = s.history[i];
    const stubKept =
      cs.preserveAttachments &&
      m?.role === 'user' &&
      Array.isArray(m.content) &&
      m.content.some((part: any) => part?.type === 'image_url');
    if (!stubKept) return true;
  }
  return false;
}

// One shift: remove ~targetTokens oldest-first (splitting entries as
// needed), shield the newest user turn and everything after it, and report
// what was freed. Returns 0 when there was nothing productive to do —
// callers then check hopelessness (still over mark) separately.
async function runShift(
  s: SessionStream,
  sessionId: string,
  total: number,
  targetTokens: number,
  label: string,
): Promise<{ freed: number }> {
  const cs = currentContextShift;
  if (!cs || !lastUsage || targetTokens <= 0) return { freed: 0 };
  if (!hasTrimmableHistory(s, cs)) return { freed: 0 };
  const emitShiftProgress = (progress: number): void => {
    emit({
      type: 'shift-progress',
      sessionId,
      progress: Math.max(0, Math.min(100, Math.round(progress))),
    });
  };
  emitShiftProgress(4);
  const cut = await computeShiftCut(s, cs, targetTokens, (fraction) =>
    emitShiftProgress(4 + 86 * fraction),
  );
  const { systemEnd } = collectShiftIndexes(s);
  if ((cut.dropTo <= systemEnd && !cut.split) || cut.freedTokens <= 0) {
    return { freed: 0 };
  }
  await applyShiftCut(s, cs, cut, total);
  emitShiftProgress(96);
  if (lastUsage) {
    // eslint-disable-next-line no-console
    console.log(`[context-shift] ${label} shift applied`, {
      sessionId,
      dropTo: cut.dropTo,
      splitEntry: cut.split?.entryIdx ?? null,
      freedTokens: cut.freedTokens,
      remaining: total - lastUsage.used,
    });
  }
  persistSessionState(sessionId);
  emitShiftProgress(100);
  emit({ type: 'context-shift', sessionId });
  emitSessionChanged(sessionId);
  return { freed: cut.freedTokens };
}

// Hopeless case: over budget with nothing droppable outside the shields
// (typically one giant tool result filling the window). Substitute the newest
// tool entry's content with a short notice so the model understands and the
// conversation stays workable; display keeps the full output. Returns whether
// a substitution happened.
async function handleHopelessShift(
  s: SessionStream,
  sessionId: string,
): Promise<boolean> {
  for (let i = s.history.length - 1; i >= 0; i -= 1) {
    const m = s.history[i];
    if (
      m?.role === 'tool' &&
      typeof m.content === 'string' &&
      m.content &&
      m.tool_call_id
    ) {
      // eslint-disable-next-line no-use-before-define,no-await-in-loop
      const tokens = (await tokenize(m.content)) ?? 0;
      const total = currentContextSize ?? lastUsage?.total ?? 0;
      const notice =
        `[Context shift: the tool result above (${tokens} tokens) exceeded ` +
        `the available context window (${total} tokens), so only this notice ` +
        `was kept in model context. The full output remains visible in chat. ` +
        `Break the work into smaller steps or ask the user how to proceed.]`;
      s.history = [
        ...s.history.slice(0, i),
        { ...m, content: notice },
        ...s.history.slice(i + 1),
      ];
      // eslint-disable-next-line no-use-before-define,no-await-in-loop
      const noticeTokens = (await tokenize(notice)) ?? 0;
      // Only substitute when it actually frees space: replacing a small
      // result with a longer notice would grow context and stamp a
      // meaningless marker for negative benefit.
      if (tokens - noticeTokens <= 0) {
        // eslint-disable-next-line no-console
        console.log(
          '[context-shift] hopeless substitution skipped; no net benefit',
          { sessionId, entryIdx: i, tokens, keptTokens: noticeTokens },
        );
        return false;
      }
      if (lastUsage) {
        anchorUsage(
          s,
          Math.max(0, lastUsage.used - Math.max(0, tokens - noticeTokens)),
          currentContextSize ?? lastUsage.total,
        );
      }
      if (m.msgId !== undefined) {
        setCutoffOnMessage(s, m.msgId);
      }
      persistSessionState(sessionId);
      emit({ type: 'context-shift', sessionId });
      emitSessionChanged(sessionId);
      // eslint-disable-next-line no-console
      console.log('[context-shift] oversized tool result substituted', {
        sessionId,
        entryIdx: i,
        tokens,
        keptTokens: noticeTokens,
      });
      return true;
    }
  }
  // eslint-disable-next-line no-console
  console.log('[context-shift] hopeless: nothing droppable, no tool to shed', {
    sessionId,
  });
  return false;
}

// Chars of fresh output required between mid-chat shifts (~256 tokens at
// ~4 chars/token). Bounds shift cost without capping shift count.
const MID_SHIFT_REARM_CHARS = 1024;

// Headroom (tokens) a live splice may free beyond the current overage.
// Bounds response destruction when the configured per-shift amount exceeds
// what the live response can satisfy: without this, an unmeetable deficit
// annihilates the response down to the 1-char anchor and the resumed model
// babbles to EOS.
const MID_SPLICE_HEADROOM_TOKENS = 2048;

// Cheap per-token gate: integer compares only, no tokenize calls. Safe to
// evaluate on every streamed token.
function shouldRequestMidShift(s: SessionStream): boolean {
  const cs = currentContextShift;
  if (!cs?.enabled || !cs?.midChatShiftEnabled || !lastUsage) return false;
  if (s.aborted || s.midShiftRequested) return false;
  const total = currentContextSize ?? lastUsage.total;
  return total - lastUsage.used <= cs.tokensRemainingUntilShift;
}

// Smallest char prefix of text holding at least target tokens (binary search).
// Returns text.length when even the whole string is short (caller clamps).
async function findTokenPrefixLength(
  text: string,
  target: number,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  if (target <= 0 || text.length === 0) return 0;
  // eslint-disable-next-line no-use-before-define
  const whole = (await tokenize(text)) ?? 0;
  onProgress?.(0);
  if (whole < target) {
    onProgress?.(1);
    return text.length;
  }
  const estTotal = Math.max(1, Math.ceil(Math.log2(text.length)) + 1);
  let step = 0;
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    // eslint-disable-next-line no-use-before-define,no-await-in-loop
    const n = (await tokenize(text.slice(0, mid))) ?? 0;
    step += 1;
    onProgress?.(Math.min(1, step / estTotal));
    if (n >= target) hi = mid;
    else lo = mid + 1;
  }
  onProgress?.(1);
  return lo;
}

// Max extra chars a splice may drop past its token minimum to land on a
// markdown block boundary. Bounds over-dropping when a giant unbroken block
// (e.g. a huge code dump) straddles the deficit point.
const MAX_SPLICE_OVERDROP_CHARS = 2000;

// Snap a splice offset forward to a markdown block boundary so fenced code,
// tables and quotes stay renderable — and the model can continue cleanly —
// on both sides of the split. Snapping only ever moves forward, so the token
// minimum that produced minOffset stays satisfied. Returns minOffset unchanged
// when already at a boundary or when none is found within the overdrop cap.
function snapSpliceOffset(
  text: string,
  minOffset: number,
  maxOverdrop: number = MAX_SPLICE_OVERDROP_CHARS,
): number {
  if (minOffset <= 0 || minOffset >= text.length) return minOffset;
  const lines = text.split('\n');
  const starts: number[] = [];
  let pos = 0;
  lines.forEach((line) => {
    starts.push(pos);
    pos += line.length + 1;
  });
  // Line containing minOffset.
  let li = 0;
  while (li < lines.length - 1 && starts[li + 1] <= minOffset) li += 1;

  // Fence state before each line (CommonMark-lite: ``` or ~~~ runs).
  const inFenceBefore: boolean[] = [];
  const opensHere: boolean[] = [];
  const closesHere: boolean[] = [];
  let open: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    inFenceBefore.push(open !== null);
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    opensHere.push(!!m && open === null);
    closesHere.push(false);
    if (m) {
      const run = m[1];
      const rest = lines[i].slice(m[0].length);
      if (open === null) {
        open = { char: run[0], len: run.length };
      } else if (
        run[0] === open.char &&
        run.length >= open.len &&
        rest.trim() === ''
      ) {
        closesHere[i] = true;
        open = null;
      }
      // Otherwise: fence-like text inside a block — literal, ignore.
    }
  }

  const isBlank = (idx: number): boolean => lines[idx].trim() === '';
  // Already at a clean block start: line start outside fences, preceded by
  // start-of-text, a blank line, a fence close, or opening a fresh fence.
  if (
    !inFenceBefore[li] &&
    starts[li] === minOffset &&
    (li === 0 || isBlank(li - 1) || closesHere[li - 1] || opensHere[li])
  ) {
    return minOffset;
  }
  // Scan forward for the first clean line start within the overdrop cap.
  for (let i = li + 1; i < lines.length; i += 1) {
    const splitAt = starts[i];
    if (splitAt - minOffset > maxOverdrop) break;
    if (
      !inFenceBefore[i] &&
      (isBlank(i - 1) || closesHere[i - 1] || opensHere[i])
    ) {
      return splitAt;
    }
  }
  return minOffset;
}

// Mid-chat shift: shed ~tokensToShift of old content, then splice the live
// response for any remainder, and stage the kept remainder as an assistant
// prefill the resumed leg continues from. The splice covers all generated
// prose — normal output and thinking alike; display keeps everything and the
// absolute drop offset is recorded for render-time splitting.
async function performMidChatShift(
  s: SessionStream,
  sessionId: string,
): Promise<void> {
  const cs = currentContextShift;
  if (!cs || !lastUsage) return;
  const total = currentContextSize ?? lastUsage.total;
  const targetTokens = shiftTokensToShift(cs);
  const emitShiftProgress = (progress: number): void => {
    emit({
      type: 'shift-progress',
      sessionId,
      progress: Math.max(0, Math.min(100, Math.round(progress))),
    });
  };
  // Show immediately: the measurable work (token measuring) follows.
  emitShiftProgress(4);

  const cut = await computeShiftCut(s, cs, targetTokens, (fraction) =>
    emitShiftProgress(4 + 70 * fraction),
  );
  await applyShiftCut(s, cs, cut, total);
  const freedOldTurns = cut.freedTokens;

  // Splice over the whole live response in chronological segment order, so
  // thinking counts exactly like standard output and multi-leg responses
  // stay consistent (display always holds every leg; no per-leg carry needed
  // beyond the cumulative token target).
  const tailMsg = s.messages[s.messages.length - 1];
  const orderedSegs =
    tailMsg?.role === 'assistant'
      ? tailMsg.content.filter(
          (seg) =>
            seg.type === 'normal' ||
            seg.type === 'thought' ||
            seg.type === 'comment',
        )
      : [];
  const fullText = orderedSegs.map((seg) => seg.text).join('');
  const prevAbsoluteDrop =
    tailMsg?.role === 'assistant' ? (tailMsg.contextSpliceChars ?? 0) : 0;
  let absoluteDrop = prevAbsoluteDrop;
  let spliceRawDrop = 0;
  // Bound the live splice to what is needed to recover past the mark plus
  // headroom — never the whole configured amount. Chasing an unmeetable
  // deficit would eat the entire live response down to the anchor char.
  const overage = Math.max(
    0,
    (currentContextShift?.tokensRemainingUntilShift ?? 0) -
      (total - (lastUsage?.used ?? total)),
  );
  const deficit = Math.min(
    Math.max(0, targetTokens - freedOldTurns),
    overage + MID_SPLICE_HEADROOM_TOKENS,
  );
  if (deficit > 0 && fullText.length > 1) {
    const target = s.midShiftDroppedTokens + deficit;
    const raw = await findTokenPrefixLength(fullText, target, (fraction) =>
      emitShiftProgress(74 + 14 * fraction),
    );
    spliceRawDrop = raw;
    // Snap forward to a markdown block boundary so fenced code, tables and
    // quotes stay renderable (and continuable) on both sides of the split.
    const snapped = snapSpliceOffset(fullText, raw);
    // Always keep at least one char of context as the continuation anchor.
    const drop = Math.min(snapped, fullText.length - 1);
    if (drop > 0) {
      absoluteDrop = drop;
      s.midShiftDroppedTokens = target;
    }
  }
  const keptText =
    absoluteDrop > 0 ? fullText.slice(absoluteDrop) : fullText;

  // Stage the kept remainder as the prefill (replace the prior leg's
  // prefill when it is still the last history entry, else push). When no new
  // splice was needed, this extends the staged prefill over the full live
  // response, so previously dropped output stays dropped.
  if (keptText.length > 0) {
    const prefill: ChatHistoryMsg = { role: 'assistant', content: keptText };
    const tailId = tailMsg?.role === 'assistant' ? tailMsg.id : undefined;
    if (tailId !== undefined) prefill.msgId = tailId;
    const lastIdx = s.history.length - 1;
    const lastEntry = lastIdx >= 0 ? s.history[lastIdx] : undefined;
    if (
      s.midShiftPrefillIndex >= 0 &&
      lastEntry?.role === 'assistant' &&
      !lastEntry.tool_calls
    ) {
      s.history = [...s.history.slice(0, lastIdx), prefill];
      s.midShiftPrefillIndex = lastIdx;
    } else {
      s.history = [...s.history, prefill];
      s.midShiftPrefillIndex = s.history.length - 1;
    }
  }

  // Record the render-time split point when this shift moved it forward.
  // Display keeps the full text in both halves.
  if (absoluteDrop > prevAbsoluteDrop) {
    const tail = s.messages[s.messages.length - 1];
    if (tail?.role === 'assistant') {
      s.messages = [
        ...s.messages.slice(0, -1),
        { ...tail, contextSpliceChars: absoluteDrop },
      ];
    }
  }

  if (
    freedOldTurns <= 0 &&
    absoluteDrop <= prevAbsoluteDrop &&
    isOverMark()
  ) {
    await handleHopelessShift(s, sessionId);
  }

  // Re-arm the watermark: the next shift needs ~256 fresh tokens first, so
  // checks stay cheap and shifts cannot thrash back-to-back. No count cap:
  // shifts may repeat without limit while tokens keep streaming.
  s.midShiftNextAllowedAt = s.midShiftStreamedLen + MID_SHIFT_REARM_CHARS;
  emitShiftProgress(93);

  if (lastUsage) {
    // eslint-disable-next-line no-console
    console.log('[context-shift] mid-chat shift applied', {
      sessionId,
      dropTo: cut.dropTo,
      freedOldTurns,
      tokensToShift: targetTokens,
      spliceRawDrop,
      contextDropChars: absoluteDrop,
      newKeptLen: keptText.length,
      remaining: total - lastUsage.used,
    });
  }

  persistSessionState(sessionId);
  emitShiftProgress(100);
  emit({
    type: 'context-shift',
    sessionId,
    midChat: true,
    ...(lastUsage
      ? {
          remaining: total - lastUsage.used,
          freedTokens: freedOldTurns,
          threshold: cs.tokensRemainingUntilShift,
        }
      : {}),
  });
  emitSessionChanged(sessionId);
}

async function finishSession(
  sessionId: string,
  stats?: GenerationStats,
): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.status = 'idle';
  if (stats && s.messages.length > 0) {
    const last = s.messages[s.messages.length - 1];
    if (last.role === 'assistant' && !last.stats) {
      s.messages = [...s.messages.slice(0, -1), { ...last, stats }];
    }
  }
  await applyContextShift(s);
  s.abortController = null;
  s.currentReader = null;
  s.streamingTool = null;
  s.promptProgress = 0;
  cancelPendingInput(s);
  persistSessionState(sessionId);
  emit({ type: 'done', sessionId, ...(stats ? { stats } : {}) });
  emitSessionChanged(sessionId);
}

export function failSession(
  sessionId: string,
  message: string,
  opts?: {
    code?: PreAcceptErrorCode;
    failedMessageId?: number;
    userTokens?: number;
  },
): void {
  const s = sessions.get(sessionId);
  if (!s || s.failed) return;
  // Pre-accept failure of a specific user turn: strip it from LLM history so
  // the conversation is not poisoned, but keep the bubble visible as failed.
  if (opts?.failedMessageId !== undefined) {
    failUserTurnAsFailed(
      sessionId,
      opts.failedMessageId,
      message,
      opts.code ?? 'rejected',
      opts.userTokens ?? 0,
    );
    return;
  }
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

/**
 * Marks a user turn as failed (red X icon in UI) and removes it from the LLM
 * history. Only used when the server never accepted the prompt (pre-accept
 * failure: connection lost, context too large, slot busy, rejected).
 */
function failUserTurnAsFailed(
  sessionId: string,
  failedMessageId: number,
  message: string,
  code: PreAcceptErrorCode,
  userTokens: number,
): void {
  const s = sessions.get(sessionId);
  if (!s || s.failed) return;
  // Remove the just-pushed user entry from LLM history (last role==='user').
  // Pre-accept means history still ends at/near that entry — search from end
  // to avoid ever touching the system prompt at index 0.
  for (let i = s.history.length - 1; i >= 0; i -= 1) {
    if (s.history[i]?.role === 'user') {
      s.history = [...s.history.slice(0, i), ...s.history.slice(i + 1)];
      break;
    }
  }
  s.messages = s.messages.map((m) =>
    m.id === failedMessageId && m.role === 'user'
      ? { ...m, failed: true, error: message, errorCode: code }
      : m,
  );
  if (lastUsage && userTokens > 0) {
    anchorUsage(s, Math.max(0, lastUsage.used - userTokens), lastUsage.total);
  }
  s.failed = true;
  s.aborted = true;
  s.abortController?.abort();
  s.abortController = null;
  s.currentReader = null;
  s.status = 'idle';
  cancelPendingInput(s);
  persistSessionState(sessionId);
  emit({ type: 'done', sessionId });
  // Keep the legacy slot-unavailable event for the banner, plus the generic
  // error event carrying the failure code + message id for the red icon.
  if (code === 'slot-unavailable') {
    emit({ type: 'slot-unavailable', sessionId });
  }
  emit({ type: 'error', sessionId, message, code, failedMessageId });
  emitSessionChanged(sessionId);
}

/** Removes a failed user bubble from display state (history already clean). */
export function deleteFailedMessage(
  sessionId: string,
  messageId: number,
): boolean {
  const s = getSessionState(sessionId);
  if (!s) return false;
  const target = s.messages.find((m) => m.id === messageId);
  if (!target || !target.failed) return false;
  s.messages = s.messages.filter((m) => m.id !== messageId);
  persistSessionState(sessionId);
  emitSessionChanged(sessionId);
  return true;
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

  // Counters are global but histories are per-session: re-anchor to this
  // session's actual history unless server totals already did (same session,
  // same ctx). Otherwise every budget gate below decides on fiction.
  if (!lastUsage || usageSessionId !== sessionId) {
    await refreshUsageFromHistory(sessionId);
  }

  const userTokens = (await tokenize(text)) ?? 0;
  let currentNewTokens = userTokens;
  if (lastUsage) {
    anchorUsage(s, lastUsage.used + userTokens, lastUsage.total);
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
    const sysEntry: ChatHistoryMsg = {
      role: 'system',
      content: currentSystemPrompt,
    };
    const sysDisplayId = nextMessages.find((m) => m.role === 'system')?.id;
    if (sysDisplayId !== undefined) sysEntry.msgId = sysDisplayId;
    s.history = [sysEntry, ...s.history];
  }
  s.history.push({ role: 'user', content: userContent, msgId: userMsg.id });
  persistSessionState(sessionId);

  // Pre-fetch checkpoint: the new user turn just landed and nothing has been
  // sent yet, so stale history can shift with zero abort cost. Gated on plain
  // enabled; the current user turn is always shielded.
  {
    const csPre = currentContextShift;
    if (
      csPre?.enabled &&
      lastUsage &&
      hasTrimmableHistory(s, csPre) &&
      isOverMark()
    ) {
      const total = currentContextSize ?? lastUsage.total;
      // eslint-disable-next-line no-console
      console.log('[context-shift] pre-fetch trigger', {
        sessionId,
        remaining: total - (lastUsage?.used ?? 0),
        threshold: csPre.tokensRemainingUntilShift,
        historyLen: s.history.length,
      });
      const pre = await runShift(
        s,
        sessionId,
        total,
        shiftTokensToShift(csPre),
        'pre-fetch',
      );
      if (pre.freed <= 0 && isOverMark()) {
        await handleHopelessShift(s, sessionId);
      }
    }
  }

  s.status = 'generating';
  s.aborted = false;
  s.failed = false;
  s.abortController = new AbortController();
  s.promptProgress = 0;
  s.streamingTool = null;
  s.midShiftRequested = false;
  s.midShiftStreamedLen = 0;
  s.midShiftNextAllowedAt = 0;
  s.midShiftDroppedTokens = 0;
  s.midShiftPrefillIndex = -1;
  // Estimate from here: basis is the refreshed + optimistic total above.
  s.usageBasisTokens = lastUsage?.used ?? 0;
  s.usageBasisLen = 0;
  if (currentContextShift) {
    const csSnap = currentContextShift;
    // eslint-disable-next-line no-console
    console.log('[context-shift] turn start', {
      sessionId,
      enabled: csSnap.enabled,
      midChatShiftEnabled: csSnap.midChatShiftEnabled,
      tokensRemainingUntilShift: csSnap.tokensRemainingUntilShift,
      tokensToShift: shiftTokensToShift(csSnap),
      contextSize: currentContextSize,
      used: lastUsage?.used ?? null,
    });
  }
  emitSessionChanged(sessionId);

  // Token counts per output category, accumulated across all tool-loop rounds
  // so the breakdown covers the full message (response, thinking, tool calls).
  let responseTokenCount = 0;
  let thinkingTokenCount = 0;
  let toolTokenCount = 0;

  const runCompletion = async (): Promise<SendMessageResponse> => {
    let response: Response;
    try {
      response = await fetch(getServerUrl('/v1/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildChatBody(s.history, activeTools, thinkingTokens),
        ),
        signal: s.abortController?.signal,
      });
    } catch (e: any) {
      // User abort is not an error — let the outer catch finish gracefully.
      if (e?.name === 'AbortError' || s.aborted) throw e;
      const msg = e?.message ?? 'Connection failed';
      throw new PreAcceptError(msg, 'connection', userMsg.id);
    }

    if (!response.ok) {
      let serverMessage = '';
      try {
        const errData = await response.json();
        serverMessage = errData?.error?.message ?? JSON.stringify(errData);
      } catch {
        serverMessage = `HTTP ${response.status}`;
      }
      const finalMessage = serverMessage || `HTTP ${response.status}`;
      if (isSlotUnavailableError(response.status, finalMessage)) {
        throw new SlotUnavailableError(userMsg.id, response.status);
      }
      const code = classifyPreAcceptError(response.status, finalMessage);
      throw new PreAcceptError(finalMessage, code, userMsg.id, response.status);
    }

    if (!response.body) {
      throw new PreAcceptError('No response body', 'connection', userMsg.id);
    }
    const reader = response.body.getReader();
    s.currentReader = reader;
    const decoder = new TextDecoder();
    let fullResponse = '';
    let fullThinking = '';
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
              const newTokensServerProg = Math.max(0, total - (cache || 0));
              const isColdStartProg =
                newTokensServerProg > currentNewTokens + 64;
              emit({
                type: 'progress',
                sessionId,
                progress: pct,
                totalTokens: total,
                processedTokens: processed,
                isColdStart: isColdStartProg,
              });
              // Early absolute truth sync: single jump to final total on first progress tick so polling + bottom-right counter reflect absolute without waiting for prompt-done
              if (total > 0) {
                anchorUsage(s, total, currentContextSize || 2048);
              }
              // Prompt processing complete — send stats immediately
              if (total > 0 && processed >= total && !promptStats) {
                const timeS = (time_ms || 0) / 1000;
                const newTokensServer = Math.max(0, total - (cache || 0));
                const isColdStart = newTokensServer > currentNewTokens + 64;
                const pStats: GenerationStats = {
                  tokens: currentNewTokens,
                  timeMs: time_ms || 0,
                  tokensPerSecond: timeS > 0 ? newTokensServer / timeS : 0,
                  totalTokens: total,
                  isColdStart,
                };
                promptStats = pStats;
                // Sync global KV usage to authoritative total before next poll
                anchorUsage(s, total, currentContextSize || 2048);
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
              const promptN =
                data.timings?.prompt_n ??
                data.usage.prompt_tokens ??
                currentNewTokens;
              const isColdStartFromUsage = promptN > currentNewTokens + 64;
              anchorUsage(
                s,
                data.usage.total_tokens,
                currentContextSize || 2048,
              );
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
                totalTokens: data.usage.total_tokens,
                isColdStart: isColdStartFromUsage,
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
              s.midShiftStreamedLen += delta.content.length;
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
              fullThinking += delta.reasoning_content;
              s.midShiftStreamedLen += delta.reasoning_content.length;
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
                  toolCalls[tc.index] = {
                    id: tc.id,
                    name: '',
                    args: '',
                    segId: '',
                  };
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
                  s.midShiftStreamedLen += tc.function.arguments.length;
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

            // Running estimate between authoritative anchors: chars since the
            // anchor at ~4 chars/token. Exact-snapped every 2048 chars below.
            // (Replaces the old +1-per-network-packet heuristic, which lagged
            // reality whenever objects carried multiple tokens.)
            if (lastUsage && !data.usage) {
              const est =
                s.usageBasisTokens +
                Math.max(
                  0,
                  Math.floor((s.midShiftStreamedLen - s.usageBasisLen) / 4),
                );
              lastUsage = { used: est, total: lastUsage.total };
              if (s.midShiftStreamedLen - s.usageBasisLen >= 2048) {
                const snapText =
                  fullResponse +
                  fullThinking +
                  toolCalls.map((tc: any) => tc.args || '').join('');
                if (snapText.length > 0) {
                  // eslint-disable-next-line no-use-before-define,no-await-in-loop
                  const exact = (await tokenize(snapText)) ?? -1;
                  if (exact >= 0) {
                    anchorUsage(s, s.usageBasisTokens + exact, lastUsage.total);
                  }
                }
              }
            }

            // Mid-generation pressure: interrupt plain-text streaming (tool
            // legs are left to finish) so old context can shift and the
            // response front can splice before resuming. The re-arm watermark
            // keeps this to ~1 shift per 256 fresh tokens; the budget compare
            // itself is integer-only so checking every token is cheap.
            if (
              !s.midShiftRequested &&
              toolCalls.length === 0 &&
              delta &&
              (delta.content || delta.reasoning_content) &&
              (fullResponse.length > 0 || fullThinking.length > 0) &&
              s.midShiftStreamedLen >= s.midShiftNextAllowedAt &&
              shouldRequestMidShift(s)
            ) {
              if (lastUsage) {
                // eslint-disable-next-line no-console
                console.log('[context-shift] mid-generation trigger', {
                  sessionId,
                  remaining:
                    (currentContextSize ?? lastUsage.total) - lastUsage.used,
                  threshold:
                    currentContextShift?.tokensRemainingUntilShift ?? null,
                  streamedLen: s.midShiftStreamedLen,
                  usageBasis: s.usageBasisTokens,
                  legNormalLen: fullResponse.length,
                  legThinkingLen: fullThinking.length,
                });
              }
              s.midShiftRequested = true;
              s.abortController?.abort();
              break;
            }
          } catch (e) {}
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
      s.currentReader = null;
    }

    if (s.midShiftRequested) {
      // Auto-shift, not a user abort: trim/splice, then continue generating
      // from the staged prefill (tool-loop precedent for pause-mutate-resume).
      s.midShiftRequested = false;
      if (!s.aborted) {
        await performMidChatShift(s, sessionId);
        if (!s.aborted) {
          s.abortController = new AbortController();
          persistSessionState(sessionId);
          emitSessionChanged(sessionId);
          return runCompletion();
        }
      }
    }

    if (s.aborted) {
      await finishSession(sessionId);
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
      const toolDisplayId = liveAssistantId(s);
      s.history.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCallRequests,
        ...(toolDisplayId !== undefined ? { msgId: toolDisplayId } : {}),
      });
      // Emit all function-call params upfront so every card becomes expandable immediately
      for (const tc of toolCalls) {
        if (chatFunctions[tc.name]?.tags?.includes('web_search'))
          addWebSearch();
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
      const concurrencyLimit =
        rawLimit === 0 ? 0 : Math.max(1, Math.floor(rawLimit));

      type BufferedLLM = {
        resultStr: string;
        payload: any;
        imageData: any;
        sourcesData: any;
        topSourcesData: any;
      };

      const firstResults: PromiseSettledResult<any>[] = new Array(
        toolCalls.length,
      );
      const llmBuffers: (BufferedLLM | undefined)[] = new Array(
        toolCalls.length,
      );
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
          result && typeof result === 'object' && '_sources' in result
            ? (result as any)._sources
            : undefined;
        const topSourcesData =
          result && typeof result === 'object' && '_top_sources' in result
            ? (result as any)._top_sources
            : undefined;
        /* eslint-enable no-underscore-dangle */
        const resultStr = JSON.stringify(modelContent);
        const payload: any = { result: resultStr };
        if (imageData && tc.name !== 'read_media_file')
          payload._image = imageData;
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
          if (
            Array.isArray(topSourcesData) &&
            toolTags?.includes('top_source')
          ) {
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
          _image:
            buffered.imageData && tc.name !== 'read_media_file'
              ? buffered.imageData
              : undefined,
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
          anchorUsage(s, lastUsage.used + resultTokens, lastUsage.total);
        }
        s.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: buffered.resultStr,
          ...(toolDisplayId !== undefined ? { msgId: toolDisplayId } : {}),
        });
        if (
          buffered.imageData &&
          chatFunctions[tc.name]?.displayType === 'projector'
        ) {
          s.history.push({
            role: 'tool',
            content: [
              {
                type: 'text',
                text: `[Image from tool: ${buffered.imageData.altText || 'media'}]`,
              },
              { type: 'image_url', image_url: { url: buffered.imageData.url } },
            ],
            ...(toolDisplayId !== undefined ? { msgId: toolDisplayId } : {}),
          });
        }
      };

      // Phase 1: parallel first invocation with immediate UI per completion order
      await (async () => {
        const runOne = async (idx: number): Promise<void> => {
          if (s.aborted) {
            firstResults[idx] = {
              status: 'rejected',
              reason: new Error('Aborted'),
            } as PromiseRejectedResult;
            return;
          }
          const tc = toolCalls[idx];
          try {
            const h = chatFunctions[tc.name]?.handler;
            if (!h) throw new Error(`Tool handler not found: ${tc.name}`);
            const toolContext = { sessionId, profileId: s.profileId };
            const v = await h(JSON.parse(tc.args), toolContext);
            firstResults[idx] = {
              status: 'fulfilled',
              value: v,
            } as PromiseFulfilledResult<any>;
            if (v && typeof v === 'object' && (v as any)._userInput) {
              isInteractive[idx] = true;
              // interactive probe stays in calling state until Phase 3
              return;
            }
            const buffered = prepareBuffer(v, tc);
            llmBuffers[idx] = buffered;
            commitImmediateUI(idx, buffered);
          } catch (e) {
            firstResults[idx] = {
              status: 'rejected',
              reason: e,
            } as PromiseRejectedResult;
            const buffered = prepareBuffer(
              { error: e instanceof Error ? e.message : String(e) },
              tc,
            );
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
          title:
            userInput.title ||
            (userInput.type === 'confirm' ? 'Action Required' : 'Question'),
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
            finalResult = await handler(
              { ...JSON.parse(tc.args), _confirmed: true },
              toolContext,
            );
          } else {
            finalResult = {
              _denied: true,
              message: 'User denied this action.',
            };
          }
        } else {
          finalResult = {
            _userResponse: userResponse.action,
            value: userResponse.value,
          };
        }
        const buffered = prepareBuffer(finalResult, tc);
        llmBuffers[idx] = buffered;
        commitImmediateUI(idx, buffered);
      }

      // Final: deferred LLM history in global index order (0..n-1) so model sees original call order
      // This runs after immediate UI checks have already been emitted per completion order,
      // but before the next model turn.
      const allSorted = Array.from(
        { length: toolCalls.length },
        (_, i) => i,
      ).sort((a, b) => a - b);
      for (const idx of allSorted) {
        if (s.aborted) break;
        if (!llmBuffers[idx]) continue;
        // eslint-disable-next-line no-await-in-loop
        await commitDeferredLLM(idx);
      }
      if (toolCalls.length > 0) {
        persistSessionState(sessionId);
      }

      // Tool-round checkpoint: results just landed in history (often huge),
      // and no stream is live, so old content can shift with zero abort cost.
      // Gated on plain enabled; old tool results may split like any text,
      // the current turn always stays.
      {
        const csRound = currentContextShift;
        if (
          csRound?.enabled &&
          lastUsage &&
          !s.aborted &&
          hasTrimmableHistory(s, csRound) &&
          isOverMark()
        ) {
          const total = currentContextSize ?? lastUsage.total;
          if (lastUsage) {
            // eslint-disable-next-line no-console
            console.log('[context-shift] tool-round trigger', {
              sessionId,
              remaining: total - lastUsage.used,
              threshold: csRound.tokensRemainingUntilShift,
              historyLen: s.history.length,
            });
          }
          const round = await runShift(
            s,
            sessionId,
            total,
            shiftTokensToShift(csRound),
            'tool-round',
          );
          if (round.freed <= 0 && isOverMark()) {
            await handleHopelessShift(s, sessionId);
          }
        }
      }

      currentNewTokens = toolCallRequestTokens + totalResultTokens;
      return runCompletion();
    }

    return { content: fullResponse, stats, promptStats };
  };

  const driveTurn = async (): Promise<SendMessageResponse> => {
    const result = await runCompletion();
    // A mid-chat shift staged the kept response front as the last history
    // entry: merge the final leg into it instead of splitting history into
    // two adjacent assistant messages.
    const preIdx = s.midShiftPrefillIndex;
    if (preIdx >= 0 && preIdx < s.history.length) {
      const prev = s.history[preIdx];
      if (
        prev?.role === 'assistant' &&
        !prev.tool_calls &&
        preIdx === s.history.length - 1
      ) {
        const prevText = typeof prev.content === 'string' ? prev.content : '';
        const merged: ChatHistoryMsg = {
          role: 'assistant',
          content: `${prevText}${result.content}`,
        };
        if (prev.msgId !== undefined) merged.msgId = prev.msgId;
        s.history = [...s.history.slice(0, preIdx), merged];
      } else {
        s.history.push({
          role: 'assistant',
          content: result.content,
          msgId: liveAssistantId(s),
        });
      }
    } else {
      s.history.push({
        role: 'assistant',
        content: result.content,
        msgId: liveAssistantId(s),
      });
    }
    s.midShiftPrefillIndex = -1;
    await finishSession(sessionId, result.stats);
    return result;
  };

  try {
    const turnResult = await driveTurn();
    return turnResult;
  } catch (e: any) {
    if (e?.name === 'AbortError' || s.aborted) {
      await finishSession(sessionId);
      return { content: 'Aborted' };
    }
    // Bounded rescue: on a genuine budget rejection, shed old content once
    // and retry the turn instead of failing outright. Gated on plain
    // enabled; the current turn always stays, and an oversized tool result
    // is substituted rather than dropped blindly.
    {
      const csRescue = currentContextShift;
      const rescueCode =
        e instanceof PreAcceptError
          ? (e.code ?? classifyPreAcceptError(e.status, e?.message ?? ''))
          : undefined;
      if (
        rescueCode === 'context-exceeded' &&
        !s.midShiftRescueDone &&
        csRescue?.enabled &&
        hasTrimmableHistory(s, csRescue)
      ) {
        s.midShiftRescueDone = true;
        // The server just proved the counters wrong: re-establish truth from
        // history before deciding the cut. Without this, a stale remaining
        // sails past the mark gate and the rescue frees nothing.
        await refreshUsageFromHistory(sessionId);
        if (!lastUsage) {
          // eslint-disable-next-line no-console
          console.log('[context-shift] rescue aborted; no usage', {
            sessionId,
          });
        } else {
          const total = currentContextSize ?? lastUsage.total;
          // eslint-disable-next-line no-console
          console.log('[context-shift] rescue attempt', {
            sessionId,
            remaining: total - lastUsage.used,
            historyLen: s.history.length,
          });
          const rescuedShift = await runShift(
            s,
            sessionId,
            total,
            shiftTokensToShift(csRescue),
            'rescue',
          );
          let rescuedProgress = rescuedShift.freed > 0;
          if (!rescuedProgress && isOverMark()) {
            rescuedProgress = await handleHopelessShift(s, sessionId);
          }
          if (rescuedProgress && !s.aborted) {
            s.abortController = new AbortController();
            persistSessionState(sessionId);
            emitSessionChanged(sessionId);
            try {
              const rescued = await driveTurn();
              return rescued;
            } catch (e2: any) {
              if (e2?.name === 'AbortError' || s.aborted) {
                await finishSession(sessionId);
                return { content: 'Aborted' };
              }
              // A second failure (single retry spent) falls through to the
              // standard failure handling below with the fresh error.
              // eslint-disable-next-line no-ex-assign
              e = e2;
            }
          } else {
            // eslint-disable-next-line no-console
            console.log('[context-shift] rescue made no progress; failing', {
              sessionId,
            });
          }
        }
      }
    }
    // Pre-accept failures (server never received the prompt): strip the user
    // turn from LLM history, keep the bubble visible as failed. Abort and
    // post-accept (streaming/tool-follow-up) failures never mark a turn failed.
    if (e instanceof SlotUnavailableError || e instanceof PreAcceptError) {
      // Tool-loop follow-ups end with assistant/tool history — the original
      // user turn was already accepted, so leave history alone (legacy path).
      const lastHistory = s.history[s.history.length - 1];
      if (lastHistory?.role !== 'user') {
        failSession(sessionId, e?.message ?? 'Unknown error');
        throw e;
      }
      const failedMessageId = e.failedMessageId ?? userMsg.id;
      const code: PreAcceptErrorCode =
        e instanceof SlotUnavailableError
          ? 'slot-unavailable'
          : (e.code ?? classifyPreAcceptError(e.status, e?.message ?? ''));
      const message = e?.message ?? 'Unknown error';
      failSession(sessionId, message, {
        code,
        failedMessageId,
        userTokens,
      });
      // Enrich so ipc can propagate the code without re-failing the session.
      e.code = code;
      e.failedMessageId = failedMessageId;
      throw e;
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
  usageSessionId = null;
  currentContextShift = null;
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
