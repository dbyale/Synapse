export interface GenerationStatsData {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
  responseTokens?: number;
  thinkingTokens?: number;
  toolTokens?: number;
  totalTokens?: number;
  isColdStart?: boolean;
}

export interface MediaDisplayItem {
  type: 'image' | 'video' | 'document';
  url?: string;
  name?: string;
}

export interface MessageSegment {
  id: string;
  text: string;
  type: 'thought' | 'comment' | 'normal' | 'tool';
  toolName?: string;
  toolStatus?: 'calling' | 'done';
  toolParams?: string;
  toolResult?: string;
  reprocessStats?: GenerationStatsData;
  mediaItems?: MediaDisplayItem[];
  displayedImage?: {
    url: string;
    altText?: string;
  };
}

/** Render-time split point for an assistant message partially cleared by a
 * mid-chat context shift. The head (up to the split) was dropped from LLM
 * context but stays visible; the renderer shows head, cutoff marker, tail.
 * Stored on the single persisted message so reloads render the same split. */
export interface ContextSplice {
  /** Id of the display segment containing the split. */
  segId: string;
  /** Chars of that segment belonging to the cleared head. */
  offset: number;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: MessageSegment[];
  collapsed?: boolean;
  /** Set on the newest display message that was cleared from LLM context by a context shift; renders a cutoff divider after it. */
  contextCutoff?: boolean;
  /** Set on an in-progress assistant message whose leading output was cleared by a mid-chat shift; renders the message split around a cutoff divider. */
  contextSpliceAt?: ContextSplice;
  stats?: GenerationStatsData;
  promptStats?: GenerationStatsData;
  /** Set when the server rejected the prompt before accepting it (pre-accept failure). */
  failed?: boolean;
  /** Raw server/transport error for the failed turn (tooltip). */
  error?: string;
  /** Machine-readable failure kind for the failed turn. */
  errorCode?:
    | 'context-exceeded'
    | 'connection'
    | 'slot-unavailable'
    | 'rejected';
}

export interface ChatHistoryMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface Source {
  title: string;
  url: string;
  kind?: 'top' | 'other';
}

export interface SavedSession {
  id: string;
  profileId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  history: ChatHistoryMsg[];
  pinned?: boolean;
  sources?: Source[];
}

// Merges incoming sources into an existing list, deduped by URL, with new
// entries prepended and 'top' entries promoted.
export function mergeSources(existing: Source[], incoming: Source[]): Source[] {
  const existingUrls = new Set<string>();
  const kept = existing.filter((s) => {
    if (existingUrls.has(s.url)) return false;
    existingUrls.add(s.url);
    return true;
  });
  const seen = new Set(existingUrls);
  const toPrepend = incoming.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  return [
    ...toPrepend,
    ...kept.map((k) => {
      const promoted = incoming.find(
        (s) => s.url === k.url && s.kind === 'top',
      );
      return promoted ? { ...k, kind: 'top' as const } : k;
    }),
  ];
}

export type SessionStatus =
  | 'idle'
  | 'generating'
  | 'tool-running'
  | 'awaiting-tool';

export interface UserInputRequest {
  requestId: string;
  type: 'confirm' | 'select' | 'freeform';
  title: string;
  prompt: string;
  options?: string[];
  toolName: string;
  toolParams: any;
}

export interface UserInputResponse {
  action: 'confirmed' | 'denied' | 'selected';
  value?: string;
}

// Stream events pushed to the renderer. All session-scoped events carry the
// sessionId so the renderer can route them to the correct chat regardless of
// which chat (or page) is currently displayed.
export interface StreamEventPayload {
  type:
    | 'token'
    | 'progress'
    | 'prompt-done'
    | 'done'
    | 'error'
    | 'function-calling'
    | 'function-call'
    | 'function-result'
    | 'user-input'
    | 'user-input-resolved'
    | 'slot-unavailable'
    | 'session-changed'
    | 'context-shift'
    | 'shift-progress';
  sessionId: string;
  token?: string;
  segmentType?: 'thought' | 'comment' | 'tool';
  progress?: number;
  totalTokens?: number;
  processedTokens?: number;
  isColdStart?: boolean;
  stats?: GenerationStatsData;
  message?: string;
  /** Machine-readable failure kind for `error` events (pre-accept failures only). */
  code?: 'context-exceeded' | 'connection' | 'slot-unavailable' | 'rejected';
  /** Display message id of the failed user turn, if any. */
  failedMessageId?: number;
  name?: string;
  params?: string;
  tags?: string[];
  result?: string;
  id?: string;
  toolCallId?: string;
  _image?: { url: string; altText?: string };
  _sources?: { title: string; url: string }[];
  _top_sources?: { title: string; url: string }[];
  request?: UserInputRequest;
  streaming?: boolean;
  /** Set on `context-shift` events triggered mid-generation (vs post-turn). */
  midChat?: boolean;
  /** Context-shift diagnostics: tokens remaining at shift time. */
  remaining?: number;
  /** Context-shift diagnostics: estimated tokens freed by the shift. */
  freedTokens?: number;
  /** Context-shift diagnostics: configured remaining-tokens threshold. */
  threshold?: number;
}

export type ChatStreamEvent = StreamEventPayload;

export interface SessionView {
  session: SavedSession;
  status: SessionStatus;
  streaming: boolean;
  streamingTool: { name: string; text: string } | null;
  progress: number;
  pendingInput: UserInputRequest | null;
}
