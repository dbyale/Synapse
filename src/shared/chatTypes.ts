export interface GenerationStatsData {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
  responseTokens?: number;
  thinkingTokens?: number;
  toolTokens?: number;
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

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: MessageSegment[];
  collapsed?: boolean;
  stats?: GenerationStatsData;
  promptStats?: GenerationStatsData;
}

export interface ChatHistoryMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface SavedSession {
  id: string;
  profileId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  history: ChatHistoryMsg[];
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
    | 'session-changed';
  sessionId: string;
  token?: string;
  segmentType?: 'thought' | 'comment' | 'tool';
  progress?: number;
  stats?: GenerationStatsData;
  message?: string;
  name?: string;
  params?: string;
  tags?: string[];
  result?: string;
  _image?: { url: string; altText?: string };
  _sources?: { title: string; url: string }[];
  _top_sources?: { title: string; url: string }[];
  request?: UserInputRequest;
  streaming?: boolean;
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
