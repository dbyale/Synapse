import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  loadSettings,
  onMemorySettingsChanged,
  getModelsDirectory,
} from './settings';
import { resolveBackend } from './backendPaths';
import type { ContextShiftSettings, Profile } from '../renderer/types/profile';
import { DEFAULT_CONTEXT_SHIFT } from '../renderer/types/profile';
// eslint-disable-next-line import/no-cycle
import { createChatFunctions } from './chatFunctions';
import {
  getOrRunOptimizer,
  FitCancelledError,
  resolveBudgets,
} from './estimator';
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
  /** Streamed chars at the last anchor; the estimate counts chars after it. */
  usageBasisLen: number;
  /** Chars streamed this turn (content + reasoning + tool args). */
  streamedLen: number;
  /** Context-limit retry used this turn (single rescue per turn). */
  rescueDone: boolean;
}

// --- State ---
let serverProcess: ChildProcess | null = null;
let currentProfile: Profile | null = null;
let currentProjector: string | null = null;
let chatFunctions: any = null;
let activeTools: any[] = [];
let emitStreamEvent: ((payload: StreamEventPayload) => void) | null = null;

// --- llama-server stderr tail + crash propagation ---
// Persistent (module-scope) so a crash AFTER a successful load can still
// surface its last ~5 stderr lines. Previously this buffer was local to
// loadProfile() and discarded on success, so post-load crashes only flipped
// the online pill with no logs.
let lastServerStderr = '';
let serverStopRequested = false;

export interface ServerCrashInfo {
  logs: string[];
  exitCode: number | null;
  signalCode: string | null;
}

let emitServerCrash: ((info: ServerCrashInfo) => void) | null = null;

function appendServerStderr(chunk: string): void {
  lastServerStderr += chunk;
  // Bound memory: keep only the recent tail.
  if (lastServerStderr.length > 50000) {
    lastServerStderr = lastServerStderr.slice(-50000);
  }
}

export function getLastServerLogLines(count = 5): string[] {
  return lastServerStderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-count);
}

// Known llama.cpp failure signatures mapped to friendly messages. Scanned
// against the full stderr buffer; every match is shown (in listed order)
// instead of the raw 5-line tail. Captures (architecture, filepath) are
// interpolated; the raw log stays available via getServerLog().
export function matchKnownServerErrors(log: string): string[] {
  const matched: string[] = [];

  const archMatch = log.match(/unknown model architecture:\s*'([^']+)'/);
  if (archMatch) {
    matched.push(
      `Model Architecture "${archMatch[1]}" Unsupported.\nTry Using A Different Model, or Report an Issue`,
    );
  }

  if (/failed to create MTP context/.test(log)) {
    matched.push(
      'Model Does Not Support MTP, but MTP is Enabled.\nUse An MTP Supported Model, or Disable MTP in Profile -> Performance -> Draft Model',
    );
  }

  if (/mismatch between text model[\s\S]*?and mmproj/.test(log)) {
    matched.push(
      'Mismatching Model and Projector.\nTry installing a different Projector, or Remove the Projector.',
    );
  }

  const ggufMatch = log.match(/failed to open GGUF file\s*'([^']+)'/);
  if (ggufMatch) {
    matched.push(
      `The Following Model Is Missing or Corrupted\n"${ggufMatch[1]}"`,
    );
  }

  return matched;
}

export function getServerErrorDetail(): string {
  const known = matchKnownServerErrors(lastServerStderr);
  if (known.length > 0) return known.join('\n');
  const tail = getLastServerLogLines(5);
  return tail.length > 0 ? tail.join('\n') : '(no server output captured)';
}

export function setServerCrashCallback(
  cb: (info: ServerCrashInfo) => void,
): void {
  emitServerCrash = cb;
}

export function getServerLog(): string {
  return lastServerStderr;
}

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
  s.usageBasisLen = s.streamedLen;
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
      streamedLen: 0,
      rescueDone: false,
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
    streamedLen: 0,
    rescueDone: false,
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
  // Fitted placement triple from the optimizer. Only meaningful together
  // with an explicit ngl — manual-mode gpuLayersAuto only (see below).
  tensorSplit?: string | null;
  tensorOverrides?: string | null;
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

// Best-effort record of ngl/ctx from a FULL manual launch command, for
// usage tracking and logging only (the server launches the raw tokens).
// Returns ngl 0 / ctx null when absent or unparseable — both degrade to
// the existing fallbacks downstream. Exported for preview IPC & tests.
export function parseManualLaunchRecord(raw: string): {
  ngl: number;
  ctx: number | null;
} {
  const tokens = stripBinaryPrefix(splitShellArgs(raw));
  const valueAfter = (...flags: string[]): string | null => {
    for (let i = 0; i < tokens.length - 1; i += 1) {
      if (flags.includes(tokens[i])) return tokens[i + 1] ?? null;
    }
    return null;
  };
  const nglRaw = valueAfter('--n-gpu-layers', '-ngl', '--gpu-layers');
  const ctxRaw = valueAfter('--ctx-size', '-c');
  const nglParsed = nglRaw !== null ? parseInt(nglRaw, 10) : NaN;
  const ctxParsed = ctxRaw !== null ? parseInt(ctxRaw, 10) : NaN;
  return {
    ngl: Number.isNaN(nglParsed) ? 0 : nglParsed,
    ctx: Number.isNaN(ctxParsed) ? null : ctxParsed,
  };
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
  // Auto layers apply in manual mode only. The Synapse Optimizer always
  // launches its explicit ngl + triple (the triple is invalid under auto),
  // so a default-on hidden toggle can never silently drop the solution.
  const layersAuto =
    (profile as any).autoOptimizer === 'custom' &&
    (profile as any).gpuLayersAuto;
  spawnArgs.push(
    '--n-gpu-layers',
    layersAuto ? 'auto' : config.ngl.toString(),
    '--ctx-size',
    config.ctx.toString(),
  );
  // Fitted tensor placement from the optimizer. Part of the (ngl, -ts, -ot)
  // triple: only valid with an explicit ngl. With gpuLayersAuto the server
  // fits live at startup, and pinned overrides would make its fit throw when
  // it needs to adjust — so omit both and let the server solve.
  if (!layersAuto) {
    if (config.tensorSplit) spawnArgs.push('-ts', config.tensorSplit);
    if (config.tensorOverrides)
      spawnArgs.push('-ot', config.tensorOverrides);
  }

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

      const { mode: budgetMode, vramMB, ramMB } = resolveBudgets(settings);

      const fullProjectorPath = profile.projector
        ? path.join(getModelsDirectory(), profile.projector)
        : undefined;

      let result: {
        ngl: number;
        ctx: number;
        tensorSplit?: string | null;
        tensorOverrides?: string | null;
        memory: any;
      };
      let updatedProfile: any;

      const { autoOptimizer } = profile as any;
      const hasValidCustom =
        autoOptimizer === 'custom' &&
        typeof (profile as any).layers === 'number' &&
        typeof (profile as any).contextSize === 'number';
      // Manual mode pins fixed budgets and caches the solution; automatic
      // fits live free memory, so it always re-solves on load rather than
      // trusting a possibly-stale cached placement.
      const budgetsMatch =
        (profile as any).allocatedVRAM === vramMB &&
        (profile as any).allocatedRAM === ramMB;
      const hasValidCached =
        budgetMode !== 'automatic' &&
        autoOptimizer &&
        autoOptimizer !== 'custom' &&
        typeof (profile as any).layers === 'number' &&
        typeof (profile as any).contextSize === 'number' &&
        budgetsMatch &&
        // Triple-aware caches only: profiles optimized before -ts/-ot
        // forwarding existed carry no triple and must re-solve once.
        'tensorSplit' in (profile as any) &&
        'tensorOverrides' in (profile as any);

      // A FULL manual launch command replaces the whole server invocation,
      // so the optimizer result would be discarded anyway — skip the solve.
      // (Additional customFlags rows still merge into a fitted launch and
      // keep the optimizer below.) Empty commands fall through to the
      // normal path and fail fast at spawn, per spec.
      const manualCmd = (profile as any).useCustomLaunch
        ? ((profile as any).customLaunchCommand ?? '').trim()
        : '';
      if (manualCmd.length > 0) {
        const manual = parseManualLaunchRecord(manualCmd);
        result = {
          ngl: manual.ngl,
          ctx: manual.ctx ?? 2048,
          tensorSplit: null,
          tensorOverrides: null,
          memory: null,
        };
      } else if (hasValidCustom) {
        // User-pinned ngl/ctx: a stale optimizer triple must NOT ride along,
        // it was solved for different values.
        result = {
          ngl: (profile as any).layers,
          ctx: (profile as any).contextSize,
          tensorSplit: null,
          tensorOverrides: null,
          memory: null,
        };
      } else if (hasValidCached) {
        result = {
          ngl: (profile as any).layers,
          ctx: (profile as any).contextSize,
          tensorSplit: (profile as any).tensorSplit ?? null,
          tensorOverrides: (profile as any).tensorOverrides ?? null,
          memory: null,
        };
      } else {
        // Single Synapse Optimizer: the user picks ctx (profile.contextSize),
        // the fitter picks layers (+triple) for exactly that ctx.
        const mode = 'synapse';
        const requestedCtx =
          typeof (profile as any).contextSize === 'number'
            ? (profile as any).contextSize
            : 4096;
        onStatus?.({
          phase: 'solving',
          message: `Optimizing Profile "${profile.name}"…`,
        });
        let optResult;
        try {
          optResult = await getOrRunOptimizer(
            fullModelPath,
            vramMB,
            ramMB,
            requestedCtx,
            fullProjectorPath,
            profile,
          );
        } catch (e) {
          if (e instanceof FitCancelledError) {
            throw new Error('Profile load superseded by a newer request');
          }
          throw e;
        }
        result = optResult;
        (profile as any).layers = optResult.ngl;
        (profile as any).contextSize = optResult.ctx;
        (profile as any).autoOptimizer = mode;
        // Automatic mode stores no fixed budgets; stamping them would fake
        // a manual cache hit later.
        if (budgetMode === 'manual') {
          (profile as any).allocatedVRAM = vramMB;
          (profile as any).allocatedRAM = ramMB;
        } else {
          delete (profile as any).allocatedVRAM;
          delete (profile as any).allocatedRAM;
        }
        (profile as any).tensorSplit = optResult.tensorSplit ?? null;
        (profile as any).tensorOverrides = optResult.tensorOverrides ?? null;
        updatedProfile = { ...profile };
      }

      // Check our Async unloader
      onStatus?.({
        phase: 'unloading',
        message: 'Unloading Previous Profile…',
      });
      await unloadPromise;

      // Fresh slate for the new server: drop the old run's tail so a new
      // failure can't show stale lines, and clear the intentional-stop flag
      // set by unloadModel() so unexpected exits count as crashes.
      lastServerStderr = '';
      serverStopRequested = false;

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
        tensorSplit: result.tensorSplit ?? null,
        tensorOverrides: result.tensorOverrides ?? null,
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
      // Unexpected exits also snapshot the error detail (friendly preset
      // when a known signature matches, else the last ~5 stderr lines) and
      // push a 'chat:server-crashed' event so ChatPage can show them
      // (previously only the online pill flipped with no logs).
      proc.once('exit', (code: number | null, signal: string | null) => {
        if (serverProcess === proc) {
          serverProcess = null;
          currentProjector = null;
          if (!serverStopRequested) {
            const detail = getServerErrorDetail();
            const logs =
              detail === '(no server output captured)'
                ? []
                : detail.split('\n');
            console.error(
              '[llama-server] Crashed. Exit:',
              code,
              'Signal:',
              signal,
              'Tail:\n',
              logs.join('\n'),
            );
            emitServerCrash?.({
              logs,
              exitCode: code,
              signalCode: signal,
            });
          }
        }
      });

      proc.stderr?.on('data', (d) => {
        appendServerStderr(d.toString());
      });

      proc.once('error', (err: Error) => {
        appendServerStderr(`spawn error: ${err.message}\n`);
      });

      let ready = false;
      // Wall-clock budget for the server to become ready. Huge models
      // (100B+ params) can legitimately take minutes while still loading.
      const STARTUP_WAIT_SEC = 120;
      for (let i = 0; i < STARTUP_WAIT_SEC; i++) {
        // Abort immediately if server was shut down while still loading (all phases).
        // An unexpected exit (crash) surfaces the friendly preset or stderr
        // tail instead of the generic shutdown message so the error card has
        // something to show.
        if (serverProcess !== proc) {
          if (serverStopRequested) {
            throw new Error('Server shutdown requested');
          }
          const detail = getServerErrorDetail();
          throw new Error(`Inference server crashed.\n${detail}`);
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
        const detail = getServerErrorDetail();
        // A dead process here means it crashed mid-load (the loop above
        // throws for that case, so this is a fallback). A LIVE process means
        // the model simply needed longer than the wait budget — the common
        // case for very large models — which deserves its own message rather
        // than the generic startup-failure text.
        if (serverProcess === proc && proc.exitCode === null) {
          console.error(
            `[llama-server] Startup timed out after ${STARTUP_WAIT_SEC}s waiting for /health ` +
              `(model=${path.basename(fullModelPath)}, ` +
              `NGL=${result.ngl}, Context=${result.ctx}). ` +
              `The server process is still alive, so the model was likely still loading — ` +
              `very large models can take several minutes. Last server output:\n` +
              `${lastServerStderr.slice(-4000)}`,
          );
          throw new Error(
            `Inference server timed out after ${STARTUP_WAIT_SEC}s while loading the model.\n` +
              `The server was still running, so a large model may simply need more time to load.\n${detail}`,
          );
        }
        console.error(
          '[llama-server] Startup failed. Logs:\n',
          lastServerStderr,
        );
        throw new Error(`Inference server failed to respond.\n${detail}`);
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

// Effective per-shift removal amount, with migration from the old minimum
// setting. Callers treat 0 as "nothing to remove".
function shiftTokensToShift(cs: ContextShiftSettings): number {
  const v =
    cs.tokensToShift ??
    cs.minTokensToClear ??
    DEFAULT_CONTEXT_SHIFT.tokensToShift;
  return Math.max(0, v);
}

// --- Universal context shift ---
// Single method for every shift. Drops/splices the oldest history entries
// until tokensToRemove are freed. System prompt is never touched, attachment
// stubs are skipped (they already count 0 via shiftMessageText), and nothing
// is ever substituted — only removed or spliced.

// Attachment entries are kept in place and excluded from all counting.
function isAttachmentEntry(
  m: ChatHistoryMsg,
  cs: ContextShiftSettings,
): boolean {
  return (
    !!cs.preserveAttachments &&
    m?.role === 'user' &&
    Array.isArray(m.content) &&
    m.content.some((part: any) => part?.type === 'image_url')
  );
}

// Char offset holding at least target tokens (binary search, no snapping).
async function findTokenPrefixLength(
  text: string,
  target: number,
): Promise<number> {
  if (target <= 0 || text.length === 0) return 0;
  // eslint-disable-next-line no-use-before-define
  const whole = (await tokenize(text)) ?? 0;
  if (whole < target) return text.length;
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    // eslint-disable-next-line no-await-in-loop, no-use-before-define
    const n = (await tokenize(text.slice(0, mid))) ?? 0;
    if (n >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Set the cutoff divider on one display message, clearing it elsewhere.
function setCutoffOnMessage(s: SessionStream, id: number): void {
  s.messages = s.messages.map((m) => {
    if (m.id === id) return { ...m, contextCutoff: true };
    if (m.contextCutoff) return { ...m, contextCutoff: false };
    return m;
  });
}

// Cutoff divider after the newest fully-dropped message.
function markShiftCutoff(s: SessionStream, firstKept: number): void {
  const { userIndexes } = collectShiftIndexes(s);
  const cleared = userIndexes.filter((idx) => idx < firstKept).length;
  let seen = 0;
  let cutoffId: number | null = null;
  for (let i = 0; i < s.messages.length; i += 1) {
    const m = s.messages[i];
    if (m.role === 'user' && !m.failed) {
      seen += 1;
      if (seen === cleared + 1) {
        if (i > 0) cutoffId = s.messages[i - 1].id;
        break;
      }
    }
  }
  if (cutoffId !== null) setCutoffOnMessage(s, cutoffId);
}

// Render-time split marker on the spliced message (tools via ordinal).
function markShiftSplice(
  s: SessionStream,
  splitEntry: ChatHistoryMsg,
  dropChars: number,
  toolOrdinal = 0,
): void {
  if (splitEntry.msgId === undefined || dropChars <= 0) return;
  const targetId = splitEntry.msgId;
  const target = s.messages.find((msg) => msg.id === targetId);
  if (!target) return;
  if (splitEntry.role === 'tool' && typeof splitEntry.content === 'string') {
    const ordinal = toolOrdinal;
    const chars = Math.max(0, Math.min(dropChars, splitEntry.content.length));
    s.messages = s.messages.map((msg) =>
      msg.id === targetId
        ? {
            ...msg,
            contextSpliceChars: chars,
            contextSpliceTool: { ordinal, chars },
          }
        : msg,
    );
    return;
  }
  s.messages = s.messages.map((msg) =>
    msg.id === targetId ? { ...msg, contextSpliceChars: dropChars } : msg,
  );
}

// Injected as the tool result when a call never runs because a shift
// removed its record. History-only; display shows it via the normal result.
const TOOL_INTERRUPTED_NOTICE =
  'Tool Call was interrupted as Context Overflowed';

// Spill removal forward from index `from` until `need` tokens are freed.
// Skips attachments, empty entries and assistant tool-call records (kept in
// place: negligible cost and preserves call/result pairing). Whole-drops
// array/media entries, splices the first string entry that covers the rest.
async function spillForward(
  s: SessionStream,
  cs: ContextShiftSettings,
  perMessage: number[],
  from: number,
  need: number,
): Promise<{
  freed: number;
  dropTo: number;
  split: {
    entryIdx: number;
    kept: ChatHistoryMsg;
    dropChars: number;
    ordinal: number;
  } | null;
}> {
  let acc = 0;
  let dropTo = from;
  for (let j = from; j < s.history.length; j += 1) {
    const m = s.history[j];
    if (isAttachmentEntry(m, cs)) continue;
    if (m?.role === 'assistant' && m.tool_calls?.length) continue;
    const t = perMessage[j] ?? 0;
    if (t <= 0) continue;
    if (typeof m.content === 'string' && m.content && acc + t >= need) {
      const head = need - acc;
      // eslint-disable-next-line no-await-in-loop
      const raw = await findTokenPrefixLength(m.content, head);
      const dropChars = Math.min(raw, m.content.length - 1);
      if (dropChars <= 0) {
        acc += t;
        dropTo = j + 1;
        if (acc >= need) break;
        continue;
      }
      const headText = m.content.slice(0, dropChars);
      // eslint-disable-next-line no-await-in-loop, no-use-before-define
      const headTokens = (await tokenize(headText)) ?? head;
      const kept: ChatHistoryMsg = {
        role: m.role,
        content: m.content.slice(dropChars),
      };
      if (m.tool_call_id !== undefined) kept.tool_call_id = m.tool_call_id;
      if (m.msgId !== undefined) kept.msgId = m.msgId;
      let ordinal = 0;
      if (m.role === 'tool' && m.msgId !== undefined) {
        for (let i = 0; i < j; i += 1) {
          const h = s.history[i];
          if (
            h?.role === 'tool' &&
            typeof h.content === 'string' &&
            h.content &&
            h.msgId === m.msgId
          ) {
            ordinal += 1;
          }
        }
      }
      return {
        freed: acc + headTokens,
        dropTo: j,
        split: { entryIdx: j, kept, dropChars, ordinal },
      };
    }
    acc += t;
    dropTo = j + 1;
    if (acc >= need) break;
  }
  return { freed: acc, dropTo, split: null };
}

// Repairs tool call/result pairing after a shift. Records are treated like
// any other entry, so a shift can strand a call without its result (or a
// result without its call). Missing results are injected as interruption
// notices; orphan results are dropped. History-only; display untouched.
async function repairToolPairing(
  s: SessionStream,
  total: number,
  injectTrailing = true,
): Promise<void> {
  const pending = new Map<string, number>();
  const orphanIdx = new Set<number>();
  const missingByRecord = new Map<number, { id: string; msgId?: number }[]>();
  const flushPending = (): void => {
    const ids = Array.from(pending.keys());
    for (let k = 0; k < ids.length; k += 1) {
      const id = ids[k];
      const rec = pending.get(id) as number;
      const entry = s.history[rec];
      const list = missingByRecord.get(rec) ?? [];
      list.push({ id, msgId: entry?.msgId });
      missingByRecord.set(rec, list);
    }
    pending.clear();
  };
  for (let i = 0; i < s.history.length; i += 1) {
    const m = s.history[i];
    if (m?.role === 'assistant' && m.tool_calls?.length) {
      flushPending();
      for (let k = 0; k < m.tool_calls.length; k += 1) {
        const c = m.tool_calls[k];
        if (c?.id && !pending.has(c.id)) pending.set(c.id, i);
      }
    } else if (m?.role === 'tool' && typeof m.tool_call_id === 'string') {
      if (pending.has(m.tool_call_id)) pending.delete(m.tool_call_id);
      else orphanIdx.add(i);
    } else if (m?.role === 'user') {
      flushPending();
    }
  }
  // Trailing pending calls belong to the in-flight leg whose results have
  // not been pushed yet — only the pre-execution shift may leave them alone.
  if (injectTrailing) flushPending();
  if (orphanIdx.size === 0 && missingByRecord.size === 0) return;
  // eslint-disable-next-line no-use-before-define
  const noticeTokens = (await tokenize(TOOL_INTERRUPTED_NOTICE)) ?? 0;
  let orphanFreed = 0;
  let injected = 0;
  const next: ChatHistoryMsg[] = [];
  for (let i = 0; i < s.history.length; i += 1) {
    if (orphanIdx.has(i)) {
      const t = shiftMessageText(s.history[i]);
      if (t) {
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        orphanFreed += (await tokenize(t)) ?? 0;
      }
      continue;
    }
    next.push(s.history[i]);
    const miss = missingByRecord.get(i);
    if (miss) {
      for (let k = 0; k < miss.length; k += 1) {
        const { id, msgId } = miss[k];
        injected += 1;
        next.push({
          role: 'tool',
          tool_call_id: id,
          content: TOOL_INTERRUPTED_NOTICE,
          ...(msgId !== undefined ? { msgId } : {}),
        });
      }
    }
  }
  s.history = next;
  if (lastUsage) {
    anchorUsage(
      s,
      Math.max(0, lastUsage.used + noticeTokens * injected - orphanFreed),
      total,
    );
  }
}

// Core shift: remove tokensToRemove oldest-first with role edge cases.
// Returns tokens actually freed.
async function shiftContext(
  s: SessionStream,
  sessionId: string,
  tokensToRemove: number,
  total: number,
  label: string,
): Promise<number> {
  const cs = currentContextShift;
  if (!cs?.enabled || !lastUsage || tokensToRemove <= 0) return 0;
  const systemEnd = s.history[0]?.role === 'system' ? 1 : 0;
  if (s.history.length <= systemEnd) return 0;

  // Measure each entry oldest-first; attachments count 0.
  const perMessage: number[] = new Array(s.history.length).fill(0);
  for (let i = systemEnd; i < s.history.length; i += 1) {
    const m = s.history[i];
    if (isAttachmentEntry(m, cs)) continue;
    const t = shiftMessageText(m);
    if (!t) continue;
    // eslint-disable-next-line no-await-in-loop, no-use-before-define
    perMessage[i] = (await tokenize(t)) ?? 0;
  }

  // Walk to the cut entry holding the target's tail.
  let accBefore = 0;
  let cutIdx = -1;
  for (let i = systemEnd; i < s.history.length; i += 1) {
    if (isAttachmentEntry(s.history[i], cs)) continue;
    if (perMessage[i] <= 0) continue;
    if (accBefore + perMessage[i] >= tokensToRemove) {
      cutIdx = i;
      break;
    }
    accBefore += perMessage[i];
  }
  // The most-recent user prompt is never dropped: the server template
  // requires a user query in context.
  let recentUser = -1;
  for (let i = s.history.length - 1; i >= systemEnd; i -= 1) {
    if (s.history[i]?.role === 'user') {
      recentUser = i;
      break;
    }
  }
  if (cutIdx === -1) {
    // Target exceeds removable content: drop everything but attachments
    // and the most-recent user prompt.
    let freed = 0;
    const next: ChatHistoryMsg[] = [];
    for (let i = 0; i < s.history.length; i += 1) {
      if (
        i < systemEnd ||
        i === recentUser ||
        isAttachmentEntry(s.history[i], cs)
      )
        next.push(s.history[i]);
      else freed += perMessage[i];
    }
    if (freed <= 0) return 0;
    s.history = next;
    anchorUsage(s, Math.max(0, lastUsage.used - freed), total);
    await repairToolPairing(s, total, label !== 'tool-round-pre');
    persistSessionState(sessionId);
    emit({ type: 'context-shift', sessionId });
    emitSessionChanged(sessionId);
    // eslint-disable-next-line no-console
    console.log(`[context-shift] ${label} shift applied`, {
      sessionId,
      freedTokens: freed,
      remaining: total - lastUsage.used,
    });
    return freed;
  }

  const cut = s.history[cutIdx];
  const headNeed = tokensToRemove - accBefore;

  // User cut: older prompts whole-drop; the most-recent prompt is kept
  // and its share spills forward into the following model response.
  if (cut.role === 'user' && cutIdx !== recentUser) {
    const dropped = accBefore + perMessage[cutIdx];
    const next: ChatHistoryMsg[] = [];
    for (let i = 0; i < s.history.length; i += 1) {
      if (i < systemEnd) next.push(s.history[i]);
      else if (i < cutIdx) {
        if (isAttachmentEntry(s.history[i], cs)) next.push(s.history[i]);
        // else dropped (already counted in accBefore)
      } else if (i === cutIdx) {
        // drop whole
      } else next.push(s.history[i]);
    }
    s.history = next;
    anchorUsage(s, Math.max(0, lastUsage.used - dropped), total);
    await repairToolPairing(s, total, label !== 'tool-round-pre');
    markShiftCutoff(s, cutIdx + 1);
    persistSessionState(sessionId);
    emit({ type: 'context-shift', sessionId });
    emitSessionChanged(sessionId);
    // eslint-disable-next-line no-console
    console.log(`[context-shift] ${label} shift applied`, {
      sessionId,
      freedTokens: dropped,
      remaining: total - lastUsage.used,
    });
    return dropped;
  }

  // Most-recent user cut: keep the prompt, spill its share forward into
  // the following response. With nothing after it, old turns still drop.
  if (cut.role === 'user') {
    const spill = await spillForward(
      s,
      cs,
      perMessage,
      cutIdx + 1,
      headNeed + perMessage[cutIdx],
    );
    const dropped = accBefore + spill.freed;
    if (dropped <= 0) return 0;
    const splitOrig = spill.split ? s.history[spill.split.entryIdx] : undefined;
    const next: ChatHistoryMsg[] = [];
    for (let i = 0; i < s.history.length; i += 1) {
      if (i < systemEnd) next.push(s.history[i]);
      else if (i < cutIdx) {
        if (isAttachmentEntry(s.history[i], cs)) next.push(s.history[i]);
        // else dropped (already counted in accBefore)
      } else if (i === cutIdx) next.push(s.history[i]);
      else if (i < spill.dropTo) {
        const m = s.history[i];
        if (
          isAttachmentEntry(m, cs) ||
          perMessage[i] <= 0 ||
          (m?.role === 'assistant' && m.tool_calls?.length)
        ) {
          next.push(m);
        }
        // else whole-dropped by the spill
      } else if (spill.split && i === spill.split.entryIdx) {
        next.push(spill.split.kept);
      } else next.push(s.history[i]);
    }
    s.history = next;
    anchorUsage(s, Math.max(0, lastUsage.used - dropped), total);
    await repairToolPairing(s, total, label !== 'tool-round-pre');
    markShiftCutoff(s, cutIdx);
    if (spill.split && splitOrig) {
      markShiftSplice(s, splitOrig, spill.split.dropChars, spill.split.ordinal);
    }
    persistSessionState(sessionId);
    emit({ type: 'context-shift', sessionId });
    emitSessionChanged(sessionId);
    // eslint-disable-next-line no-console
    console.log(`[context-shift] ${label} shift applied`, {
      sessionId,
      freedTokens: dropped,
      remaining: total - lastUsage.used,
    });
    return dropped;
  }

  // Assistant cut: keep the owning user prompt, take extra from the head.
  if (cut.role === 'assistant') {
    let ownerUser = -1;
    for (let i = cutIdx - 1; i >= systemEnd; i -= 1) {
      if (s.history[i]?.role === 'user') {
        ownerUser = i;
        break;
      }
    }
    const ownerTokens =
      ownerUser >= 0 && !isAttachmentEntry(s.history[ownerUser], cs)
        ? perMessage[ownerUser]
        : 0;
    const need = headNeed + (ownerUser >= 0 ? ownerTokens : 0);
    if (typeof cut.content !== 'string' || !cut.content) {
      // Un-splittable (e.g. tool-call record): drop whole, keep owner.
      const next: ChatHistoryMsg[] = [];
      for (let i = 0; i < s.history.length; i += 1) {
        if (i < systemEnd) next.push(s.history[i]);
        else if (i < cutIdx) {
          if (i === ownerUser || isAttachmentEntry(s.history[i], cs))
            next.push(s.history[i]);
        } else if (i === cutIdx) {
          // drop whole
        } else next.push(s.history[i]);
      }
      const dropped =
        accBefore - (ownerUser >= 0 ? ownerTokens : 0) + perMessage[cutIdx];
      if (dropped <= 0) return 0;
      s.history = next;
      anchorUsage(s, Math.max(0, lastUsage.used - dropped), total);
      await repairToolPairing(s, total, label !== 'tool-round-pre');
      markShiftCutoff(s, cutIdx + 1);
      persistSessionState(sessionId);
      emit({ type: 'context-shift', sessionId });
      emitSessionChanged(sessionId);
      // eslint-disable-next-line no-console
      console.log(`[context-shift] ${label} shift applied`, {
        sessionId,
        freedTokens: dropped,
        remaining: total - lastUsage.used,
      });
      return dropped;
    }
    const raw = await findTokenPrefixLength(cut.content, need);
    const drop = Math.min(raw, cut.content.length - 1);
    if (drop <= 0) return 0;
    const head = cut.content.slice(0, drop);
    // eslint-disable-next-line no-use-before-define
    const headTokens = (await tokenize(head)) ?? need;
    const kept: ChatHistoryMsg = {
      role: cut.role,
      content: cut.content.slice(drop),
    };
    if (cut.tool_calls !== undefined) kept.tool_calls = cut.tool_calls;
    if (cut.tool_call_id !== undefined) kept.tool_call_id = cut.tool_call_id;
    if (cut.msgId !== undefined) kept.msgId = cut.msgId;
    const next: ChatHistoryMsg[] = [];
    for (let i = 0; i < s.history.length; i += 1) {
      if (i < systemEnd) next.push(s.history[i]);
      else if (i < cutIdx) {
        if (i === ownerUser || isAttachmentEntry(s.history[i], cs))
          next.push(s.history[i]);
      } else if (i === cutIdx) next.push(kept);
      else next.push(s.history[i]);
    }
    const dropped = accBefore - (ownerUser >= 0 ? ownerTokens : 0) + headTokens;
    s.history = next;
    anchorUsage(s, Math.max(0, lastUsage.used - dropped), total);
    await repairToolPairing(s, total, label !== 'tool-round-pre');
    markShiftCutoff(s, cutIdx);
    markShiftSplice(s, cut, drop);
    persistSessionState(sessionId);
    emit({ type: 'context-shift', sessionId });
    emitSessionChanged(sessionId);
    // eslint-disable-next-line no-console
    console.log(`[context-shift] ${label} shift applied`, {
      sessionId,
      freedTokens: dropped,
      remaining: total - lastUsage.used,
    });
    return dropped;
  }

  // Tool cut: splice right there, keep the tail.
  if (typeof cut.content !== 'string' || !cut.content) {
    // Un-splittable array/media tool entry: drop whole.
    const next: ChatHistoryMsg[] = [];
    for (let i = 0; i < s.history.length; i += 1) {
      if (i < systemEnd) next.push(s.history[i]);
      else if (i < cutIdx) {
        if (isAttachmentEntry(s.history[i], cs)) next.push(s.history[i]);
      } else if (i === cutIdx) {
        // drop whole
      } else next.push(s.history[i]);
    }
    const dropped = accBefore + perMessage[cutIdx];
    if (dropped <= 0) return 0;
    s.history = next;
    anchorUsage(s, Math.max(0, lastUsage.used - dropped), total);
    await repairToolPairing(s, total, label !== 'tool-round-pre');
    markShiftCutoff(s, cutIdx + 1);
    persistSessionState(sessionId);
    emit({ type: 'context-shift', sessionId });
    emitSessionChanged(sessionId);
    // eslint-disable-next-line no-console
    console.log(`[context-shift] ${label} shift applied`, {
      sessionId,
      freedTokens: dropped,
      remaining: total - lastUsage.used,
    });
    return dropped;
  }
  // Same owner rule as assistant cuts, but only for the most-recent turn:
  // older tool turns cut right where they land.
  let turnOwner = -1;
  for (let i = cutIdx - 1; i >= systemEnd; i -= 1) {
    if (s.history[i]?.role === 'user') {
      turnOwner = i;
      break;
    }
  }
  const keepOwner = turnOwner === recentUser && recentUser >= 0;
  const ownerExtra =
    keepOwner && !isAttachmentEntry(s.history[turnOwner], cs)
      ? perMessage[turnOwner]
      : 0;
  const raw = await findTokenPrefixLength(cut.content, headNeed + ownerExtra);
  const drop = Math.min(raw, cut.content.length - 1);
  if (drop <= 0) return 0;
  const head = cut.content.slice(0, drop);
  // eslint-disable-next-line no-use-before-define
  const headTokens = (await tokenize(head)) ?? headNeed + ownerExtra;
  const kept: ChatHistoryMsg = {
    role: cut.role,
    content: cut.content.slice(drop),
  };
  if (cut.tool_call_id !== undefined) kept.tool_call_id = cut.tool_call_id;
  if (cut.msgId !== undefined) kept.msgId = cut.msgId;
  // Ordinal of this result among its display message's tool segments
  // (chronological, unaffected by what was dropped ahead of it).
  let ordinal = 0;
  for (let i = systemEnd; i < cutIdx; i += 1) {
    const h = s.history[i];
    if (
      h?.role === 'tool' &&
      typeof h.content === 'string' &&
      h.content &&
      cut.msgId !== undefined &&
      h.msgId === cut.msgId
    ) {
      ordinal += 1;
    }
  }
  const next: ChatHistoryMsg[] = [];
  for (let i = 0; i < s.history.length; i += 1) {
    if (i < systemEnd) next.push(s.history[i]);
    else if (i < cutIdx) {
      if (i === turnOwner && keepOwner) next.push(s.history[i]);
      else if (isAttachmentEntry(s.history[i], cs)) next.push(s.history[i]);
    } else if (i === cutIdx) next.push(kept);
    else next.push(s.history[i]);
  }
  const dropped = accBefore - ownerExtra + headTokens;
  s.history = next;
  anchorUsage(s, Math.max(0, lastUsage.used - dropped), total);
  await repairToolPairing(s, total);
  markShiftCutoff(s, cutIdx);
  markShiftSplice(s, cut, drop, ordinal);
  persistSessionState(sessionId);
  emit({ type: 'context-shift', sessionId });
  emitSessionChanged(sessionId);
  // eslint-disable-next-line no-console
  console.log(`[context-shift] ${label} shift applied`, {
    sessionId,
    freedTokens: dropped,
    remaining: total - lastUsage.used,
  });
  return dropped;
}

// Trigger: tokensRemainingUntilShift decides IF, tokensToShift decides HOW
// MUCH (X*K to cover the deficit, including any incoming message).
async function ensureFit(
  s: SessionStream,
  sessionId: string,
  label: string,
  incomingTokens = 0,
): Promise<void> {
  const cs = currentContextShift;
  if (!cs?.enabled || !lastUsage) return;
  const total = currentContextSize ?? lastUsage.total;
  const perShift = shiftTokensToShift(cs);
  if (perShift <= 0) return;
  const deficit =
    lastUsage.used + incomingTokens + cs.tokensRemainingUntilShift - total;
  if (deficit <= 0) return;
  const k = Math.max(1, Math.ceil(deficit / perShift));
  await shiftContext(s, sessionId, perShift * k, total, label);
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
    s.usageBasisLen = s.streamedLen;
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
  s.usageBasisLen = s.streamedLen;
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

// Id of the live assistant display message taking streamed output, for
// linking history entries to the bubbles they render in.
function liveAssistantId(s: SessionStream): number | undefined {
  const m = s.messages[s.messages.length - 1];
  return m?.role === 'assistant' ? m.id : undefined;
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

  // Pre-send shift: the new user turn just landed and nothing has been
  // sent yet. Runs whenever the general toggle is on (no mid-chat gate).
  await ensureFit(s, sessionId, 'pre-fetch');

  s.status = 'generating';
  s.aborted = false;
  s.failed = false;
  s.abortController = new AbortController();
  s.promptProgress = 0;
  s.streamingTool = null;
  s.streamedLen = 0;
  s.rescueDone = false;
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
              s.streamedLen += delta.content.length;
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
              s.streamedLen += delta.reasoning_content.length;
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
                  s.streamedLen += tc.function.arguments.length;
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
                Math.max(0, Math.floor((s.streamedLen - s.usageBasisLen) / 4));
              lastUsage = { used: est, total: lastUsage.total };
              if (s.streamedLen - s.usageBasisLen >= 2048) {
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
          } catch (e) {}
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
      s.currentReader = null;
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
      if (lastUsage && !s.aborted) {
        anchorUsage(s, lastUsage.used + toolCallRequestTokens, lastUsage.total);
      }
      // Pre-execution shift: the call record just landed and nothing has
      // run yet. Calls whose record does not survive are never executed;
      // their interruption is recorded as the result instead.
      if (
        currentContextShift?.enabled &&
        currentContextShift?.midChatShiftEnabled &&
        !s.aborted
      ) {
        await ensureFit(s, sessionId, 'tool-round-pre');
      }
      const liveCallIds = new Set<string>();
      for (let hi = 0; hi < s.history.length; hi += 1) {
        const m = s.history[hi];
        if (m?.role === 'assistant' && m.tool_calls?.length) {
          for (let ci = 0; ci < m.tool_calls.length; ci += 1) {
            const c = m.tool_calls[ci];
            if (c?.id) liveCallIds.add(c.id);
          }
        }
      }
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
          if (!liveCallIds.has(tc.id)) {
            // Shift dropped this call's record: never run it.
            const buffered = prepareBuffer(
              { _response: TOOL_INTERRUPTED_NOTICE },
              tc,
            );
            llmBuffers[idx] = buffered;
            commitImmediateUI(idx, buffered);
            firstResults[idx] = {
              status: 'fulfilled',
              value: { _interrupted: true },
            } as PromiseFulfilledResult<any>;
            return;
          }
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

      // Tool-round shift: results just landed in history (often huge) and
      // no stream is live. Record tokens were counted pre-execution above.
      if (
        currentContextShift?.enabled &&
        currentContextShift?.midChatShiftEnabled
      ) {
        await ensureFit(s, sessionId, 'tool-round');
      }

      currentNewTokens = toolCallRequestTokens + totalResultTokens;
      return runCompletion();
    }

    return { content: fullResponse, stats, promptStats };
  };

  const driveTurn = async (): Promise<SendMessageResponse> => {
    const result = await runCompletion();
    s.history.push({
      role: 'assistant',
      content: result.content,
      msgId: liveAssistantId(s),
    });
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
    // Rescue: the server proved the prompt too large. Re-establish truth
    // from history, shift once via the universal method, and retry the turn.
    // Gated only on the general toggle (no mid-chat gate).
    {
      const csRescue = currentContextShift;
      const rescueCode =
        e instanceof PreAcceptError
          ? (e.code ?? classifyPreAcceptError(e.status, e?.message ?? ''))
          : undefined;
      if (
        rescueCode === 'context-exceeded' &&
        !s.rescueDone &&
        csRescue?.enabled
      ) {
        s.rescueDone = true;
        // The server just proved the counters wrong: re-establish truth from
        // history before measuring the deficit.
        await refreshUsageFromHistory(sessionId);
        if (!lastUsage) {
          // eslint-disable-next-line no-console
          console.log('[context-shift] rescue aborted; no usage', {
            sessionId,
          });
        } else {
          const usedBefore = lastUsage.used;
          await ensureFit(s, sessionId, 'rescue');
          if (lastUsage.used < usedBefore && !s.aborted) {
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
    // Intentional stop: suppress the 'server-crashed' push for this exit.
    // loadProfile() clears the flag after awaiting the old server's
    // shutdown and before spawning its replacement.
    serverStopRequested = true;
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
