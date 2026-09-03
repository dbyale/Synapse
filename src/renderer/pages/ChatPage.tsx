import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
  useCallback,
  useMemo,
  memo,
  ReactNode,
  DragEvent,
  ClipboardEvent,
} from 'react';
import {
  SendHorizonal,
  Square,
  Bot,
  SlidersHorizontal,
  AlertCircle,
  RefreshCw,
  Wrench,
  Check,
  ChevronDown,
  ChevronUp,
  Gauge,
  Hash,
  Timer,
  Zap,
  ImagePlus,
  FilePlusCorner,
  FileText,
  X,
  SquareDashedText,
  Copy,
  MessagesSquare,
  SquarePen,
  Cpu,
  Microchip,
  Database,
  Power,
  ArrowDown,
  Search,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MessageContent from '../components/MessageContent';
import ImageViewer from '../components/ImageViewer';
import ConfirmDialog from '../components/ConfirmDialog';
import UserInputModal from '../components/UserInputModal';
import ProfileSelectModal from '../components/ProfileSelectModal';
import SessionsSidebar from '../components/SessionsSidebar';
import InfoTooltip from '../components/InfoTooltip';
import ThinkingDropdown, {
  readThinkingTokens,
} from '../components/ThinkingDropdown';
import SavingsModal from '../components/SavingsModal';
import ChatSearchBar from '../components/ChatSearchBar';
import { useSourcesContext } from '../context/SourcesContext';
import type { Profile } from '../types/profile';
import type { AppSettings, ContentPart } from '../preload.d';
import { getToolMeta, getAllToolMetas } from '../utils/extensionData';
import { resolveIcon } from '../components/workflows/IconPicker';
import {
  getMonthId,
  getLastNonZeroMonthId,
  totalSavings,
  formatMoney,
  EMPTY_USAGE,
} from '../utils/usage';
import type { UsageStore } from '../utils/usage';
import '../styles/ChatPage.css';

import type {
  GenerationStatsData,
  MediaDisplayItem,
  Message,
  MessageSegment,
} from '../../shared/chatTypes';

export type {
  GenerationStatsData,
  MediaDisplayItem,
  MessageSegment,
  Message,
} from '../../shared/chatTypes';

type PendingMedia =
  | { id: string; type: 'image'; dataUrl: string; name?: string }
  | { id: string; type: 'video'; file: File; objectUrl: string }
  | {
      id: string;
      type: 'document';
      name: string;
      content: string;
      status?: 'waiting' | 'converting';
    };

const MAX_CONCURRENT_CONVERSIONS = 3;
let activeConversions = 0;
const pendingConversions: (() => void)[] = [];

function pumpConversions() {
  while (
    activeConversions < MAX_CONCURRENT_CONVERSIONS &&
    pendingConversions.length > 0
  ) {
    pendingConversions.shift()!();
  }
}

function withConversionSlot<T>(
  task: () => Promise<T>,
  onStart?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeConversions += 1;
      onStart?.();
      task()
        .then(
          (value) => {
            activeConversions -= 1;
            pumpConversions();
            resolve(value);
            return undefined;
          },
          (err) => {
            activeConversions -= 1;
            pumpConversions();
            reject(err);
            return undefined;
          },
        )
        .catch(() => {});
    };
    if (activeConversions < MAX_CONCURRENT_CONVERSIONS) {
      start();
    } else {
      pendingConversions.push(start);
    }
  });
}

const TOKEN_COUNTER_TOOLTIP = [
  "Shows how many tokens this session has used out of the model's context window.",
  'Turns yellow at 75% and red at 90% usage as a warning.',
  'Once full, the model can no longer remember earlier messages — start a new session to reset.',
];

const GENERATION_SPEED_TOOLTIP = [
  'Shows how fast the model is generating tokens while it answers.',
  'Higher speeds mean faster responses — speed depends on model size and hardware.',
  'Measured in tokens per second (t/s).',
];

const PROMPT_TOKENS_STAT_TOOLTIP = [
  'Tokens the model reads in to understand your message.',
];
const PROMPT_TIME_STAT_TOOLTIP = [
  'How long the model took to process the prompt.',
];
const PROMPT_SPEED_STAT_TOOLTIP = [
  'How fast the model processes prompt tokens per second.',
];
const GENERATED_TOKENS_STAT_TOOLTIP = [
  'Tokens the model wrote as part of its response.',
];
const GENERATION_TIME_STAT_TOOLTIP = [
  'How long the model spent writing the response.',
];
const GENERATION_SPEED_STAT_TOOLTIP = [
  'How fast the model writes tokens per second.',
];
const REPROCESS_TOKENS_STAT_TOOLTIP = [
  'Tokens the model re-read when using this tool.',
];
const REPROCESS_TIME_STAT_TOOLTIP = [
  'How long the model took to reprocess when using this tool.',
];
const REPROCESS_SPEED_STAT_TOOLTIP = [
  'How fast the model reprocesses tokens per second.',
];

function formatBackend(backend: string): string {
  const platformMap: Record<string, string> = {
    win: 'Win',
    macos: 'macOS',
    ubuntu: 'Linux',
  };
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'ARM64',
  };
  const parts = backend.split('-');
  if (parts.length < 2) return backend;
  const os = platformMap[parts[0]] ?? parts[0];
  const arch = archMap[parts[parts.length - 1]] ?? parts[parts.length - 1];
  const middle = parts.slice(1, -1);
  if (middle.length === 0) return `${os} ${arch}`;
  if (middle[0] === 'cpu') return `${os} ${arch} CPU`;
  if (middle[0] === 'vulkan') return `${os} ${arch} Vulkan`;
  if (middle[0] === 'adreno') return `${os} ${arch} Adreno`;
  if (middle[0] === 'cuda') {
    return `${os} ${arch} CUDA ${middle.slice(1).join('.')}`;
  }
  return `${os} ${arch} ${middle.join(' ')}`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^```.*$/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^(\d+)[.)]\s+/gm, '$1. ')
    .replace(/[*_~]+/g, '')
    .replace(/<[^>]+>/g, '');
}

function formatToolJson(jsonString: string): string {
  let out: string;
  try {
    out = JSON.stringify(JSON.parse(jsonString), null, 2);
  } catch {
    out = jsonString;
  }
  return out.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
}

let persistentLoadedProfileId: string = '';
let persistentModelLoading = false;
let persistentLastLoadId = 0;

const ToolCallSegment = memo(function ToolCallSegmentInner({
  segment,
  showInlineStats,
  onImageClick,
}: {
  segment: MessageSegment;
  showInlineStats?: boolean;
  onImageClick?: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(segment.toolParams || segment.toolResult);

  const prettyPrintJson = (jsonString: string): string =>
    formatToolJson(jsonString);

  if (segment.displayedImage) {
    const meta = segment.toolName ? getToolMeta(segment.toolName) : undefined;
    if (meta?.displayType === 'image' || meta?.displayType === 'projector') {
      const img = segment.displayedImage;
      let fallbackAlt = '';
      if (!img.altText && segment.toolParams) {
        try {
          const parsed = JSON.parse(segment.toolParams);
          fallbackAlt = parsed.path ?? parsed.url ?? '';
        } catch {
          fallbackAlt = '';
        }
      }
      const altText = img.altText || fallbackAlt;
      return (
        <div className="tool-call-segment tool-call-segment--image">
          <img
            src={img.url}
            alt={altText}
            className="tool-call-segment__image"
            onClick={() => onImageClick?.(img.url)}
          />
        </div>
      );
    }
  }

  return (
    <div
      className={
        expanded && hasContent
          ? 'tool-call-segment tool-call-segment--expanded'
          : 'tool-call-segment'
      }
    >
      <div
        className="tool-call-segment__header"
        onClick={() => setExpanded(!expanded)}
      >
        {(() => {
          const meta = segment.toolName
            ? getToolMeta(segment.toolName)
            : undefined;
          const IconComp = meta?.icon ? resolveIcon(meta.icon) : Wrench;
          return <IconComp className="tool-call-segment__icon" size={16} />;
        })()}
        <span className="tool-call-segment__name">
          {(segment.toolName && getToolMeta(segment.toolName)?.label) ??
            segment.toolName}
        </span>
        {segment.toolStatus === 'calling' ? (
          <div className="tool-call-segment__spinner" />
        ) : segment.toolStatus === 'done' ? (
          <Check className="tool-call-segment__check" size={16} />
        ) : null}
        {showInlineStats && segment.reprocessStats && (
          <span className="tool-call-segment__header-stats">
            <InfoTooltip
              title="Reprocessing tokens"
              content={REPROCESS_TOKENS_STAT_TOOLTIP}
              hideIcon
              portal
            >
              <span className="tool-call-segment__header-stat">
                <Hash size={10} />
                <span>{segment.reprocessStats.tokens}</span>
              </span>
            </InfoTooltip>
            <InfoTooltip
              title="Reprocessing time"
              content={REPROCESS_TIME_STAT_TOOLTIP}
              hideIcon
              portal
            >
              <span className="tool-call-segment__header-stat">
                <Timer size={10} />
                <span>
                  {(segment.reprocessStats.timeMs / 1000).toFixed(1)}s
                </span>
              </span>
            </InfoTooltip>
            <InfoTooltip
              title="Reprocessing speed"
              content={REPROCESS_SPEED_STAT_TOOLTIP}
              hideIcon
              portal
            >
              <span className="tool-call-segment__header-stat">
                <Zap size={10} />
                <span>{segment.reprocessStats.tokensPerSecond.toFixed(1)}</span>
              </span>
            </InfoTooltip>
          </span>
        )}
        {segment.toolParams || segment.toolResult ? (
          <span className="tool-call-segment__chevron">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        ) : null}
      </div>
      {expanded && (segment.toolParams || segment.toolResult) && (
        <div className="tool-call-segment__details">
          {segment.toolParams && (
            <>
              <div className="tool-call-segment__label">Params</div>
              <SyntaxHighlighter
                language="json"
                style={oneDark}
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  fontSize: 11,
                  lineHeight: 1.4,
                  background: 'transparent',
                }}
                codeTagProps={{ style: { fontFamily: 'inherit' } }}
              >
                {prettyPrintJson(segment.toolParams)}
              </SyntaxHighlighter>
            </>
          )}
          {segment.toolResult && (
            <>
              <div className="tool-call-segment__label">Result</div>
              <SyntaxHighlighter
                language="json"
                style={oneDark}
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  fontSize: 11,
                  lineHeight: 1.4,
                  background: 'transparent',
                }}
                codeTagProps={{ style: { fontFamily: 'inherit' } }}
              >
                {prettyPrintJson(segment.toolResult)}
              </SyntaxHighlighter>
            </>
          )}
        </div>
      )}
    </div>
  );
});

interface MessageViewProps {
  msg: Message;
  isLast: boolean;
  profileName: string;
  loading: boolean;
  processing: boolean;
  progressPercent: number;
  streamingTool: { name: string; text: string } | null;
  executing: { names: string[]; completed: number; total: number } | null;
  settings: AppSettings | null;
  copiedMsgId: number | null;
  isCollapsed: boolean;
  onToggleCollapsed: (id: number) => void;
  onCopy: (msg: Message) => void;
  onImageClick: (url: string) => void;
}

function MessageViewInner({
  msg,
  isLast,
  profileName,
  loading,
  processing,
  progressPercent,
  streamingTool,
  executing,
  settings,
  copiedMsgId,
  isCollapsed,
  onToggleCollapsed,
  onCopy,
  onImageClick,
}: MessageViewProps) {
  const streamingDisplayText = useMemo(() => {
    if (!streamingTool) return '';
    return formatToolJson(streamingTool.text);
  }, [streamingTool]);

  const toolStreamRef = useRef<HTMLDivElement>(null);
  const isToolAtBottomRef = useRef(true);

  const handleToolScroll = useCallback(() => {
    const el = toolStreamRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    isToolAtBottomRef.current = distance < 40;
  }, []);

  useEffect(() => {
    if (!streamingTool) {
      isToolAtBottomRef.current = true;
      return;
    }
    if (streamingTool.text.length === 0) {
      isToolAtBottomRef.current = true;
      const el = toolStreamRef.current;
      if (el) el.scrollTop = 0;
    }
  }, [streamingTool]);

  useEffect(() => {
    if (!streamingTool) return;
    if (!isToolAtBottomRef.current) return;
    const el = toolStreamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingDisplayText, streamingTool]);

  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      {(() => {
        const text = msg.content[0]?.text || '';
        const outputText =
          msg.content.find((s) => s.type === 'normal')?.text || text;
        let collapsible = true;
        if (msg.role === 'user') collapsible = text.length >= 20;
        else if (msg.role === 'assistant') {
          collapsible = stripMarkdown(outputText).trim().length >= 40;
        }
        return (
          <div
            className="chat-message__label"
            role="button"
            tabIndex={collapsible ? 0 : undefined}
            onClick={() => {
              if (collapsible) onToggleCollapsed(msg.id);
            }}
            onKeyDown={(e) => {
              if (!collapsible) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleCollapsed(msg.id);
              }
            }}
          >
            {msg.role === 'user'
              ? 'You'
              : msg.role === 'system'
                ? 'System'
                : profileName || 'Assistant'}
            {collapsible && (
              <ChevronDown
                size={12}
                className={`chat-message__label-chevron${isCollapsed ? ' chat-message__label-chevron--collapsed' : ''}`}
              />
            )}
          </div>
        );
      })()}
      {isCollapsed && (msg.role === 'user' || msg.role === 'assistant') ? (
        <div
          className="chat-message__bubble chat-message__bubble--collapsed"
          role="button"
          tabIndex={0}
          onClick={() => onToggleCollapsed(msg.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapsed(msg.id);
            }
          }}
        >
          {(() => {
            const outputText =
              msg.content.find((s) => s.type === 'normal')?.text ||
              msg.content[0]?.text ||
              '';
            if (msg.role === 'assistant') {
              return `${stripMarkdown(outputText).trim().slice(0, 40)}…`;
            }
            return `${outputText.slice(0, 20)}…`;
          })()}
        </div>
      ) : (
        !isCollapsed && (
          <>
            {loading && isLast && msg.role === 'assistant' && !processing && (
              <div className="chat-message__indicator-box">
                <div className="chat-indicator">
                  <div className="chat-indicator__spinner" />
                  <span className="chat-indicator__label">Generating…</span>
                </div>
              </div>
            )}
            <div className="chat-message__bubble">
              {msg.role === 'assistant' ? (
                <div className="chat-message__assistant-content">
                  {(() => {
                    const elements: ReactNode[] = [];
                    let batchSegments: MessageSegment[] = [];
                    let standaloneToolBuffer: MessageSegment[] = [];

                    const buildToolGroups = (
                      tools: MessageSegment[],
                    ): {
                      segments: MessageSegment[];
                      stats: GenerationStatsData | null;
                    }[] => {
                      const groups: {
                        segments: MessageSegment[];
                        stats: GenerationStatsData | null;
                      }[] = [];
                      let currentGroup: MessageSegment[] = [];
                      let currentStats: GenerationStatsData | null = null;

                      for (const tool of tools) {
                        const stats = tool.reprocessStats ?? null;
                        if (currentGroup.length > 0 && currentStats !== stats) {
                          groups.push({
                            segments: currentGroup,
                            stats: currentStats,
                          });
                          currentGroup = [];
                        }
                        currentGroup.push(tool);
                        currentStats = stats;
                      }

                      if (currentGroup.length > 0) {
                        groups.push({
                          segments: currentGroup,
                          stats: currentStats,
                        });
                      }

                      return groups;
                    };

                    const renderToolGroup = (
                      group: {
                        segments: MessageSegment[];
                        stats: GenerationStatsData | null;
                      },
                      key: string | number,
                    ): ReactNode => {
                      if (group.segments.length === 1) {
                        return (
                          <ToolCallSegment
                            key={key}
                            segment={group.segments[0]}
                            showInlineStats={!!group.stats}
                            onImageClick={onImageClick}
                          />
                        );
                      }

                      return (
                        <div
                          key={`tool-group-${key}`}
                          className="tool-call-group"
                        >
                          <div className="tool-call-group__tools">
                            {group.segments.map((seg) => (
                              <ToolCallSegment
                                key={seg.id}
                                segment={seg}
                                showInlineStats={false}
                                onImageClick={onImageClick}
                              />
                            ))}
                          </div>
                          {group.stats && (
                            <div className="tool-call-group__stats">
                              <InfoTooltip
                                title="Prompt tokens"
                                content={PROMPT_TOKENS_STAT_TOOLTIP}
                                hideIcon
                                portal
                              >
                                <div className="chat-stat-item">
                                  <Hash size={12} />
                                  <span>{group.stats.tokens} tokens</span>
                                </div>
                              </InfoTooltip>
                              <InfoTooltip
                                title="Prompt processing time"
                                content={PROMPT_TIME_STAT_TOOLTIP}
                                hideIcon
                                portal
                              >
                                <div className="chat-stat-item">
                                  <Timer size={12} />
                                  <span>
                                    {(group.stats.timeMs / 1000).toFixed(2)}s
                                  </span>
                                </div>
                              </InfoTooltip>
                              <InfoTooltip
                                title="Prompt processing speed"
                                content={PROMPT_SPEED_STAT_TOOLTIP}
                                hideIcon
                                portal
                              >
                                <div className="chat-stat-item">
                                  <Zap size={12} />
                                  <span>
                                    {group.stats.tokensPerSecond.toFixed(1)} t/s
                                  </span>
                                </div>
                              </InfoTooltip>
                            </div>
                          )}
                        </div>
                      );
                    };

                    const flushStandaloneTools = () => {
                      if (standaloneToolBuffer.length === 0) return;
                      const groups = buildToolGroups(standaloneToolBuffer);
                      for (let i = 0; i < groups.length; i++) {
                        elements.push(
                          renderToolGroup(
                            groups[i],
                            `solo-${elements.length}-${i}`,
                          ),
                        );
                      }
                      standaloneToolBuffer = [];
                    };

                    const buildThoughtItems = (
                      segments: MessageSegment[],
                    ): {
                      kind: 'text' | 'tools';
                      text?: string;
                      groups?: {
                        segments: MessageSegment[];
                        stats: GenerationStatsData | null;
                      }[];
                    }[] => {
                      const items: {
                        kind: 'text' | 'tools';
                        text?: string;
                        groups?: {
                          segments: MessageSegment[];
                          stats: GenerationStatsData | null;
                        }[];
                      }[] = [];
                      let textBuffer: string[] = [];
                      let toolBuffer: MessageSegment[] = [];

                      const flushText = () => {
                        if (textBuffer.length > 0) {
                          items.push({
                            kind: 'text',
                            text: textBuffer.join(''),
                          });
                          textBuffer = [];
                        }
                      };

                      const flushTools = () => {
                        if (toolBuffer.length > 0) {
                          const groups = buildToolGroups(toolBuffer);
                          items.push({ kind: 'tools', groups });
                          toolBuffer = [];
                        }
                      };

                      for (const seg of segments) {
                        if (seg.type === 'tool') {
                          flushText();
                          toolBuffer.push(seg);
                        } else {
                          flushTools();
                          if (
                            seg.type === 'thought' &&
                            seg.text.trim().length > 0
                          ) {
                            textBuffer.push(seg.text);
                          }
                        }
                      }
                      flushText();
                      flushTools();

                      return items;
                    };

                    const flushBatch = (thinkingDone?: boolean) => {
                      if (batchSegments.length === 0) return;

                      const hasThought = batchSegments.some(
                        (s) => s.type === 'thought',
                      );

                      const autoOpen = settings?.autoOpenThinking ?? true;
                      const autoCloseDone =
                        settings?.autoCloseThinkingDone ?? false;
                      const thoughtDefaultOpen = autoOpen
                        ? !autoCloseDone || !thinkingDone
                        : false;

                      if (hasThought) {
                        const items = buildThoughtItems(batchSegments);
                        elements.push(
                          <MessageContent
                            key={`batch-${elements.length}-thought-${!!thinkingDone}`}
                            segments={[]}
                            thoughtItems={items}
                            onImageClick={onImageClick}
                            defaultOpen={thoughtDefaultOpen}
                            renderTool={(seg, showInline) => (
                              <ToolCallSegment
                                key={seg.id}
                                segment={seg}
                                showInlineStats={showInline}
                                onImageClick={onImageClick}
                              />
                            )}
                          />,
                        );
                      } else {
                        elements.push(
                          <MessageContent
                            key={`batch-${elements.length}`}
                            segments={batchSegments}
                            onImageClick={onImageClick}
                          />,
                        );
                      }

                      batchSegments = [];
                    };

                    msg.content.forEach((segment) => {
                      if (segment.type === 'tool') {
                        const isInThoughtBatch =
                          batchSegments.length > 0 &&
                          batchSegments.every(
                            (s) => s.type === 'thought' || s.type === 'tool',
                          );

                        if (isInThoughtBatch && !segment.displayedImage) {
                          batchSegments.push(segment);
                        } else if (segment.displayedImage && isInThoughtBatch) {
                          standaloneToolBuffer.push(segment);
                        } else {
                          flushBatch();
                          standaloneToolBuffer.push(segment);
                        }
                      } else {
                        const closingBatch =
                          batchSegments.length > 0 &&
                          segment.type !== 'thought';
                        if (closingBatch) {
                          flushBatch(true);
                          flushStandaloneTools();
                        } else if (batchSegments.length === 0) {
                          flushStandaloneTools();
                        }
                        batchSegments.push(segment);
                      }
                    });

                    flushBatch();
                    flushStandaloneTools();

                    return elements;
                  })()}
                  {streamingTool && isLast && msg.role === 'assistant' && (
                    <div className="tool-call-stream">
                      <div className="tool-call-stream__header">
                        {(() => {
                          const meta = streamingTool.name
                            ? getToolMeta(streamingTool.name)
                            : undefined;
                          const IconComp = meta?.icon
                            ? resolveIcon(meta.icon)
                            : Wrench;
                          return (
                            <IconComp
                              className="tool-call-stream__icon"
                              size={16}
                            />
                          );
                        })()}
                        <span className="tool-call-stream__name">
                          {(streamingTool.name &&
                            getToolMeta(streamingTool.name)?.label) ??
                            streamingTool.name}
                        </span>
                        <div className="tool-call-stream__spinner" />
                      </div>
                      <div
                        ref={toolStreamRef}
                        className="tool-call-stream__body"
                        onScroll={handleToolScroll}
                      >
                        <SyntaxHighlighter
                          language="json"
                          style={oneDark}
                          customStyle={{
                            margin: 0,
                            borderTop: 'none',
                            borderRadius: 0,
                            fontSize: 11,
                            lineHeight: 1.4,
                            background: 'transparent',
                          }}
                          codeTagProps={{ style: { fontFamily: 'inherit' } }}
                        >
                          {streamingDisplayText}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  )}
                  {loading &&
                    isLast &&
                    msg.role === 'assistant' &&
                    executing && (
                      <div className="chat-message__indicator-box">
                        <div className="chat-indicator">
                          <div className="chat-indicator__spinner" />
                          <span className="chat-indicator__label">
                            Executing {executing.names.join(', ')} (
                            {executing.completed}/{executing.total})
                          </span>
                        </div>
                      </div>
                    )}
                  {loading &&
                    isLast &&
                    msg.role === 'assistant' &&
                    processing &&
                    !executing &&
                    !streamingTool && (
                      <div className="chat-message__indicator-box">
                        <div className="chat-indicator">
                          <div className="chat-indicator__spinner" />
                          <span className="chat-indicator__label">
                            Processing prompt… ({progressPercent}%)
                          </span>
                        </div>
                        <div className="chat-progress-bar">
                          <div
                            className="chat-progress-bar__fill"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}
                </div>
              ) : msg.role === 'system' ? (
                <>{msg.content[0]?.text || ''}</>
              ) : (
                <>
                  {msg.content[0]?.mediaItems?.map((item, idx) => {
                    if (item.type === 'image') {
                      return (
                        <img
                          key={`img-${idx}`}
                          src={item.url}
                          alt="Attached media"
                          className="chat-message__user-image"
                          onClick={() => onImageClick(item.url!)}
                        />
                      );
                    }
                    if (item.type === 'video') {
                      return (
                        <video
                          key={`vid-${idx}`}
                          src={item.url}
                          controls
                          className="chat-message__user-video"
                        />
                      );
                    }
                    if (item.type === 'document') {
                      return (
                        <div
                          key={`doc-${idx}`}
                          className="chat-message__user-document"
                        >
                          <FileText size={20} />
                          <span className="chat-message__user-document-name">
                            {item.name}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })}
                  {msg.content[0]?.text || ''}
                </>
              )}
            </div>
          </>
        )
      )}

      {/* Display prompt processing statistics below user and system messages */}
      {(msg.role === 'user' || msg.role === 'system') && msg.promptStats && (
        <div className="chat-message__stats">
          <InfoTooltip
            title="Prompt tokens"
            content={PROMPT_TOKENS_STAT_TOOLTIP}
            hideIcon
            portal
          >
            <div className="chat-stat-item">
              <Hash size={12} />
              <span>{msg.promptStats.tokens} tokens</span>
            </div>
          </InfoTooltip>
          <InfoTooltip
            title="Prompt processing time"
            content={PROMPT_TIME_STAT_TOOLTIP}
            hideIcon
            portal
          >
            <div className="chat-stat-item">
              <Timer size={12} />
              <span>{(msg.promptStats.timeMs / 1000).toFixed(2)}s</span>
            </div>
          </InfoTooltip>
          <InfoTooltip
            title="Prompt processing speed"
            content={PROMPT_SPEED_STAT_TOOLTIP}
            hideIcon
            portal
          >
            <div className="chat-stat-item">
              <Zap size={12} />
              <span>{msg.promptStats.tokensPerSecond.toFixed(1)} t/s</span>
            </div>
          </InfoTooltip>
          {msg.role === 'user' && msg.content[0]?.text && (
            <button
              type="button"
              className={`chat-message__copy ${copiedMsgId === msg.id ? 'chat-message__copy--copied' : ''}`}
              onClick={() => onCopy(msg)}
              title="Copy message"
              aria-label="Copy message"
            >
              {copiedMsgId === msg.id ? (
                <Check size={12} />
              ) : (
                <Copy size={12} />
              )}
              <span>{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
      )}

      {/* Display generation statistics below assistant responses */}
      {msg.role === 'assistant' && msg.stats && (
        <div className="chat-message__stats">
          <InfoTooltip
            title="Tokens generated"
            content={[
              GENERATED_TOKENS_STAT_TOOLTIP[0],
              ...(msg.stats.responseTokens !== undefined
                ? [
                    `Response tokens: ${msg.stats.responseTokens.toLocaleString()}`,
                    `Thinking tokens: ${(msg.stats.thinkingTokens ?? 0).toLocaleString()}`,
                    `Tool call tokens: ${(msg.stats.toolTokens ?? 0).toLocaleString()}`,
                  ]
                : []),
            ]}
            hideIcon
            portal
          >
            <div className="chat-stat-item">
              <Hash size={12} />
              <span>{msg.stats.tokens} tokens</span>
            </div>
          </InfoTooltip>
          <InfoTooltip
            title="Generation time"
            content={GENERATION_TIME_STAT_TOOLTIP}
            hideIcon
            portal
          >
            <div className="chat-stat-item">
              <Timer size={12} />
              <span>{(msg.stats.timeMs / 1000).toFixed(2)}s</span>
            </div>
          </InfoTooltip>
          <InfoTooltip
            title="Generation speed"
            content={GENERATION_SPEED_STAT_TOOLTIP}
            hideIcon
            portal
          >
            <div className="chat-stat-item">
              <Zap size={12} />
              <span>{msg.stats.tokensPerSecond.toFixed(1)} t/s</span>
            </div>
          </InfoTooltip>
          <button
            type="button"
            className={`chat-message__copy ${copiedMsgId === msg.id ? 'chat-message__copy--copied' : ''}`}
            onClick={() => onCopy(msg)}
            title="Copy response"
            aria-label="Copy response"
          >
            {copiedMsgId === msg.id ? <Check size={12} /> : <Copy size={12} />}
            <span>{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function messageViewPropsEqual(prev: MessageViewProps, next: MessageViewProps) {
  if (
    prev.msg !== next.msg ||
    prev.isLast !== next.isLast ||
    prev.profileName !== next.profileName ||
    prev.settings !== next.settings ||
    prev.copiedMsgId !== next.copiedMsgId ||
    prev.isCollapsed !== next.isCollapsed
  ) {
    return false;
  }
  if (!prev.isLast) return true;
  return (
    prev.loading === next.loading &&
    prev.processing === next.processing &&
    prev.progressPercent === next.progressPercent &&
    prev.streamingTool === next.streamingTool &&
    prev.executing === next.executing
  );
}

const MessageView = memo(MessageViewInner, messageViewPropsEqual);

const DOC_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'csv',
  'html',
  'htm',
  'json',
  'xml',
  'rtf',
  'txt',
  'md',
  'epub',
];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'webm'];
const DOC_EXTENSIONS_SET = new Set(DOC_EXTENSIONS);

const IMAGE_EXTENSIONS_SET = new Set(IMAGE_EXTENSIONS);

const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

let pastedNameCounter = 0;

const MIME_TO_VIDEO_EXT: Record<string, string> = {
  quicktime: 'mov',
  'x-matroska': 'mkv',
};
function getExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

function MediaAttachModal({
  onAttach,
  onAttachVideo,
  onAttachText,
  onAttachTextStart,
  onAttachTextStatus,
  onAttachTextFail,
  onToastError,
  onClose,
  hasProjector,
  dragging,
}: {
  onAttach: (dataUrl: string, name: string) => void;
  onAttachVideo: (file: File) => void;
  onAttachText: (id: string, name: string, content: string) => void;
  onAttachTextStart: (name: string) => string;
  onAttachTextStatus: (id: string, status: 'waiting' | 'converting') => void;
  onAttachTextFail: (id: string) => void;
  onToastError: (message: string) => void;
  onClose: () => void;
  hasProjector: boolean;
  dragging: boolean;
}) {
  const supportedExtensions = hasProjector
    ? [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...DOC_EXTENSIONS]
    : [...DOC_EXTENSIONS];

  const filterName = hasProjector
    ? 'All supported files'
    : 'All supported documents';

  async function processDocument(filePath: string, filename: string) {
    const id = onAttachTextStart(filename);
    try {
      const result = await withConversionSlot(
        () => window.electronAPI.convertFileWithMarkitdown(filePath),
        () => onAttachTextStatus(id, 'converting'),
      );
      if (result.success && result.markdown) {
        onAttachText(id, filename, result.markdown);
      } else {
        onAttachTextFail(id);
        onToastError(
          `Failed to convert ${filename}: ${result.error || 'Unknown error'}`,
        );
      }
    } catch (err: any) {
      onAttachTextFail(id);
      onToastError(`Error converting ${filename}: ${err.message}`);
    }
  }

  const handleSelectFromDisk = async () => {
    const paths = await window.electronAPI.browseForFiles({
      title: 'Select files',
      multiSelections: true,
      filters: [{ name: filterName, extensions: supportedExtensions }],
    });
    if (paths.length === 0) return;
    onClose();
    for (const filePath of paths) {
      const ext = getExtension(filePath);
      const filename = filePath.split(/[/\\]/).pop() || 'file';
      const isImage = IMAGE_EXTENSIONS_SET.has(ext);
      const isVideo = VIDEO_EXTENSIONS_SET.has(ext);
      if ((isImage || isVideo) && !hasProjector) {
        onToastError(
          `${filename} needs a loaded vision projector to be attached`,
        );
      } else if (isVideo) {
        const uint8 = await window.electronAPI.readFileAsBuffer(filePath);
        const mime = ext === 'webm' ? 'video/webm' : 'video/mp4';
        const blob = new Blob([uint8.buffer as ArrayBuffer], { type: mime });
        const file = new File([blob], filename, { type: mime });
        onAttachVideo(file);
        break;
      } else if (isImage) {
        const dataUrl = await window.electronAPI.readFileAsDataUrl(filePath);
        onAttach(dataUrl, filename);
      } else if (DOC_EXTENSIONS_SET.has(ext)) {
        processDocument(filePath, filename);
      } else {
        onToastError(`${filename} is unsupported`);
      }
    }
  };

  return (
    <div className="image-modal-overlay" onClick={onClose}>
      <div
        className={`image-modal${dragging ? ' image-modal--dragging' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="image-modal__close" onClick={onClose} type="button">
          <X size={18} />
        </button>
        <div className="image-modal__drop-zone">
          {hasProjector ? (
            <ImagePlus className="image-modal__icon" size={40} />
          ) : (
            <FileText className="image-modal__icon" size={40} />
          )}
          <p className="image-modal__label">
            {hasProjector
              ? 'Drop images, videos, or documents here'
              : 'Drop documents here'}
          </p>
          <p className="image-modal__sublabel">or</p>
          <button
            type="button"
            className="image-modal__browse"
            onClick={handleSelectFromDisk}
          >
            Select from disk
          </button>
        </div>
      </div>
    </div>
  );
}

async function extractVideoFrames(
  file: File,
  fps = 1,
  maxFrames?: number,
  quality = 0.8,
  maxWidth = 640,
): Promise<{ frames: string[]; fps: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
    video.load();
    setTimeout(() => reject(new Error('Video load timed out')), 10000);
  });

  const { duration } = video;
  if (!duration || !isFinite(duration)) {
    URL.revokeObjectURL(url);
    video.remove();
    return { frames: [], fps };
  }

  let totalFrames = Math.max(1, Math.floor(duration * fps));
  if (maxFrames !== undefined) {
    totalFrames = Math.min(totalFrames, maxFrames);
  }
  const interval = duration / totalFrames;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale) || maxWidth;
  canvas.height = Math.round(video.videoHeight * scale) || 480;

  const frames: string[] = [];
  let lastActualTime = -1;
  let actualCount = 0;

  for (let i = 0; i < totalFrames; i++) {
    const time = Math.min(i * interval, duration - 0.01);
    video.currentTime = time;
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.onseeked = null;
        resolve();
      };
      video.onseeked = onSeeked;
      setTimeout(() => {
        if (video.onseeked === onSeeked) {
          video.onseeked = null;
          resolve();
        }
      }, 2000);
    });
    if (video.currentTime === lastActualTime) continue;
    lastActualTime = video.currentTime;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL('image/jpeg', quality));
    actualCount++;
  }

  URL.revokeObjectURL(url);
  video.remove();

  const achievedFps =
    actualCount > 0 && lastActualTime > 0 ? actualCount / lastActualTime : fps;
  return { frames, fps: achievedFps };
}

export default function ChatPage() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatErrors, setChatErrors] = useState<
    { message: string; id: string }[]
  >([]);
  const chatErrorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [placeholder, setPlaceholder] = useState('Select a profile first...');
  const [usedTokens, setUsedTokens] = useState<number>(0);
  const [maxTokens, setMaxTokens] = useState<number | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sessionsSidebarCollapsed') === '1',
  );
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tps, setTps] = useState<number>(0);
  const [usageSummary, setUsageSummary] = useState<UsageStore>(EMPTY_USAGE);
  const [showSavingsModal, setShowSavingsModal] = useState(false);
  const [savingsModalBasis, setSavingsModalBasis] = useState<
    'monthly' | 'total'
  >('monthly');
  const [savingsModalTitle, setSavingsModalTitle] =
    useState('Estimated savings');
  const [savingsModalMonthId, setSavingsModalMonthId] = useState(getMonthId());
  const [savingsModalMonthLabel, setSavingsModalMonthLabel] = useState<
    'This month' | 'Last month'
  >('This month');
  const [showImageModal, setShowImageModal] = useState(false);
  const [pageDragging, setPageDragging] = useState(false);
  const dragOpenedModal = useRef(false);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const [systemPhase, setSystemPhase] = useState<
    'solving' | 'starting' | 'preloading' | 'ready'
  >('ready');
  const [systemStatusMessage, setSystemStatusMessage] = useState('');
  const [systemProgress, setSystemProgress] = useState(0);
  const [systemPromptDone, setSystemPromptDone] = useState<{
    stats: GenerationStatsData;
    toolCount: number;
  } | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [backendOptions, setBackendOptions] = useState<
    { id: string; label: string; folder: string }[]
  >([]);
  const [backendMenuOpen, setBackendMenuOpen] = useState(false);
  const backendMenuRef = useRef<HTMLDivElement>(null);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement>(null);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const stateMenuRef = useRef<HTMLDivElement>(null);
  const [streamingTool, setStreamingTool] = useState<{
    name: string;
    text: string;
  } | null>(null);
  const [userInputRequest, setUserInputRequest] = useState<{
    sessionId: string;
    requestId: string;
    type: 'confirm' | 'select' | 'freeform';
    title: string;
    prompt: string;
    options?: string[];
    toolName: string;
    toolParams: any;
  } | null>(null);
  const [streamingSessions, setStreamingSessions] = useState<Set<string>>(
    () => new Set(),
  );
  const [loadingSessions, setLoadingSessions] = useState<
    Record<string, boolean>
  >({});
  const [processingSessions, setProcessingSessions] = useState<
    Record<string, boolean>
  >({});
  const [executingSessions, setExecutingSessions] = useState<
    Record<string, { names: string[]; completed: number; total: number } | null>
  >({});
  const [showSlotInfo, setShowSlotInfo] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionMessagesRef = useRef<Record<string, Message[]>>({});
  const streamingToolsRef = useRef<
    Record<string, { name: string; text: string } | null>
  >({});
  const progressRef = useRef<Record<string, number>>({});
  const toolSegmentQueuesRef = useRef<Record<string, string[]>>({});
  const pendingSegmentIdsRef = useRef<Record<string, string[]>>({});
  const isReprocessingRef = useRef<Record<string, boolean>>({});
  const executingRef = useRef<
    Record<string, { names: string[]; completed: number; total: number } | null>
  >({});
  const messageCountersRef = useRef<Record<string, number>>({});
  const segmentCountersRef = useRef<Record<string, number>>({});
  const syncThrottleRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const pendingTokenBuffersRef = useRef<
    Record<string, { token: string; segmentType?: string }[]>
  >({});
  const streamingToolDirtyRef = useRef(false);
  const processingDirtyRef = useRef(false);
  const tokenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Typewriter (TPS-driven) ──────────────────────────────────────
  const typewriterQueuesRef = useRef<
    Record<string, { char: string; segmentType?: string }[]>
  >({});
  const typewriterTimersRef = useRef<
    Record<string, ReturnType<typeof setInterval>>
  >({});
  const typewriterCarryRef = useRef<Record<string, number>>({});
  const tokenTimestampsRef = useRef<Record<string, number[]>>({});
  const tokenCharsRef = useRef<
    Record<string, { chars: number; tokens: number }>
  >({});
  const tokenTpsRef = useRef<Record<string, number>>({});
  const tpsRef = useRef<number>(0);
  const TYPEWRITER_INTERVAL_MS = 16;
  // ── Tool typewriter (both raw & pretty at 16ms) ───────────────────────
  const toolTypewriterQueuesRef = useRef<Record<string, string[]>>({});
  const toolTypewriterTimersRef = useRef<
    Record<string, ReturnType<typeof setInterval>>
  >({});
  const toolTypewriterCarryRef = useRef<Record<string, number>>({});
  // Kept for cleanup of legacy timers (no longer used for batching)
  const toolPrettyFlushTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const messagesRef = useRef<Message[]>([]);
  const slotBannerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const loadAbortController = useRef<{ cancelled: boolean }>({
    cancelled: false,
  });
  const sendingRef = useRef(false);
  const [sendingState, setSendingState] = useState(false);
  const unloadInProgress = useRef(false);
  const profilesRef = useRef<Profile[]>([]);
  const generationBaselineTokens = useRef<number | null>(null);
  const lastTokenSnapshot = useRef<{ tokens: number; time: number } | null>(
    null,
  );
  const appliedProgressTruthRef = useRef<Record<string, boolean>>({});
  const systemMessageInsertedRef = useRef(false);
  const autoSavingsShownRef = useRef(false);

  const navigate = useNavigate();
  const location = useLocation();

  const {
    addSources,
    setActiveSession,
    setSources,
    removeSessionSources,
    clearAllSources,
    closeSources,
    toggleSources,
    isOpen: isSourcesOpen,
  } = useSourcesContext();

  const [showSourcesButton, setShowSourcesButton] = useState(false);
  const [projectorLoaded, setProjectorLoaded] = useState(false);
  const [projectorChecked, setProjectorChecked] = useState(false);
  const [projectorWarning, setProjectorWarning] = useState<{
    tools: string[];
    id: number;
  } | null>(null);
  const [projectorWarningClosing, setProjectorWarningClosing] = useState(false);
  const projectorWarningExitTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const copiedMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Server online/offline ──────────────────────────────────────────────
  const [isServerOnline, setIsServerOnline] = useState<boolean>(true);
  const [serverToggling, setServerToggling] = useState(false);
  const hasCheckedStartupRef = useRef(false);
  const manualStartRequestedRef = useRef(false);
  const preserveSessionOnNextLoadRef = useRef(false);
  // One pending send queued via Enter while offline — stays until drained
  const pendingQueuedRef = useRef(false);
  const [isQueued, setIsQueued] = useState(false);

  // ── Search (find in chat) ─────────────────────────────────────────────
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // ── Scroll to bottom button ────────────────────────────────────────────
  const [showScrollButton, setShowScrollButton] = useState(false);
  const SCROLL_THRESHOLD_PX = 200;

  // ── Collapsed UI state (clean separation: not stored in Message) ────────
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(
    () => new Set(),
  );
  const collapsedBySessionRef = useRef<Record<string, Set<number>>>({});
  const seenIdsRef = useRef<Record<string, Set<number>>>({});

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ── Typewriter helpers (TPS-driven, very fast, catch-up) ─────────────
  const getEffectiveCPS = useCallback(
    (sessionId: string, queueLen: number): number => {
      const rawTps = tokenTpsRef.current[sessionId] ?? tpsRef.current ?? 0;
      // chars per token estimator
      const cc = tokenCharsRef.current[sessionId];
      const avgCharsPerToken = cc && cc.tokens > 0 ? cc.chars / cc.tokens : 4;
      let baseCPS: number;
      if (rawTps <= 0.1) {
        baseCPS = 90; // warmup before TPS measured
      } else {
        baseCPS = rawTps * avgCharsPerToken * 1.25; // 25% faster than generation
        baseCPS = Math.max(30, Math.min(1200, baseCPS));
      }
      const catchUp = 1 + Math.min(1.5, queueLen / 250);
      return Math.min(1400, baseCPS * catchUp);
    },
    [],
  );

  const clearTypewriterSession = useCallback((sessionId: string) => {
    const t = typewriterTimersRef.current[sessionId];
    if (t) {
      clearInterval(t);
      delete typewriterTimersRef.current[sessionId];
    }
    delete typewriterQueuesRef.current[sessionId];
    delete typewriterCarryRef.current[sessionId];
    delete tokenTimestampsRef.current[sessionId];
    delete tokenCharsRef.current[sessionId];
    delete tokenTpsRef.current[sessionId];
    delete appliedProgressTruthRef.current[sessionId];
    const tt = toolTypewriterTimersRef.current[sessionId];
    if (tt) {
      clearInterval(tt);
      delete toolTypewriterTimersRef.current[sessionId];
    }
    const pt = toolPrettyFlushTimersRef.current[sessionId];
    if (pt) {
      clearTimeout(pt);
      delete toolPrettyFlushTimersRef.current[sessionId];
    }
    delete toolTypewriterQueuesRef.current[sessionId];
    delete toolTypewriterCarryRef.current[sessionId];
    delete executingRef.current[sessionId];
    setExecutingSessions((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const clearAllTypewriterSessions = useCallback(() => {
    Object.keys(typewriterTimersRef.current).forEach((sid) => {
      clearInterval(typewriterTimersRef.current[sid]);
    });
    typewriterTimersRef.current = {};
    typewriterQueuesRef.current = {};
    typewriterCarryRef.current = {};
    tokenTimestampsRef.current = {};
    tokenCharsRef.current = {};
    tokenTpsRef.current = {};
    appliedProgressTruthRef.current = {};
    Object.keys(toolTypewriterTimersRef.current).forEach((sid) => {
      clearInterval(toolTypewriterTimersRef.current[sid]);
    });
    toolTypewriterTimersRef.current = {};
    Object.keys(toolPrettyFlushTimersRef.current).forEach((sid) => {
      clearTimeout(toolPrettyFlushTimersRef.current[sid]);
    });
    toolPrettyFlushTimersRef.current = {};
    toolTypewriterQueuesRef.current = {};
    toolTypewriterCarryRef.current = {};
    executingRef.current = {};
    setExecutingSessions({});
  }, []);

  const drainTypewriterQueue = useCallback(
    (sessionId: string, flushAll = false) => {
      const q = typewriterQueuesRef.current[sessionId];
      if (!q || q.length === 0) {
        const timer = typewriterTimersRef.current[sessionId];
        if (timer) {
          clearInterval(timer);
          delete typewriterTimersRef.current[sessionId];
        }
        delete typewriterCarryRef.current[sessionId];
        return;
      }
      let n: number;
      if (flushAll) {
        n = q.length;
      } else {
        const cps = getEffectiveCPS(sessionId, q.length);
        const carry = typewriterCarryRef.current[sessionId] ?? 0;
        const inc = (cps * TYPEWRITER_INTERVAL_MS) / 1000;
        const total = carry + inc;
        n = Math.floor(total);
        typewriterCarryRef.current[sessionId] = total - n;
        if (n <= 0) return;
        n = Math.min(n, q.length);
      }
      const chunk = q.splice(0, n);
      if (chunk.length === 0) return;
      const isActive = sessionId === activeSessionIdRef.current;
      // Apply chars batched into messages – replicate token flush logic but per-char grouped by segmentType
      const current = sessionMessagesRef.current[sessionId] ?? [];
      let updated = current;
      // Process chunk sequentially, grouping consecutive chars of same type into one update
      // For performance we apply all chars in a single updated copy
      chunk.forEach(({ char, segmentType }) => {
        const last = updated[updated.length - 1];
        let currentType: 'thought' | 'comment' | 'normal' = 'normal';
        if (segmentType === 'thought') currentType = 'thought';
        else if (segmentType === 'comment') currentType = 'comment';
        if (last && last.role === 'assistant') {
          const updatedContent = [...last.content];
          const lastSegment = updatedContent[updatedContent.length - 1];
          if (lastSegment && lastSegment.type === currentType) {
            updatedContent[updatedContent.length - 1] = {
              ...lastSegment,
              text: lastSegment.text + char,
            };
          } else {
            const counters = segmentCountersRef.current;
            counters[sessionId] = (counters[sessionId] ?? 0) + 1;
            updatedContent.push({
              id: `seg-${Date.now()}-${counters[sessionId]}`,
              text: char,
              type: currentType,
            });
          }
          updated = [
            ...updated.slice(0, -1),
            { ...last, content: updatedContent },
          ];
        } else {
          const counters = messageCountersRef.current;
          const id = counters[sessionId] ?? 0;
          counters[sessionId] = id + 1;
          const segCounters = segmentCountersRef.current;
          segCounters[sessionId] = (segCounters[sessionId] ?? 0) + 1;
          let initialType: 'thought' | 'comment' | 'normal' = 'normal';
          if (segmentType === 'thought') initialType = 'thought';
          else if (segmentType === 'comment') initialType = 'comment';
          updated = [
            ...updated,
            {
              id,
              role: 'assistant',
              content: [
                {
                  id: `seg-${Date.now()}-${segCounters[sessionId]}`,
                  text: char.replace(/^\s+/, ''),
                  type: initialType,
                },
              ],
            },
          ];
        }
      });
      sessionMessagesRef.current[sessionId] = updated;
      if (isActive) setMessages(updated);
      if (q.length === 0) {
        const timer = typewriterTimersRef.current[sessionId];
        if (timer) {
          clearInterval(timer);
          delete typewriterTimersRef.current[sessionId];
        }
        delete typewriterCarryRef.current[sessionId];
      }
    },
    [getEffectiveCPS],
  );

  const drainToolTypewriterQueue = useCallback(
    (sessionId: string, flushAll = false) => {
      const q = toolTypewriterQueuesRef.current[sessionId];
      if (!q || q.length === 0) {
        const timer = toolTypewriterTimersRef.current[sessionId];
        if (timer) {
          clearInterval(timer);
          delete toolTypewriterTimersRef.current[sessionId];
        }
        delete toolTypewriterCarryRef.current[sessionId];
        return;
      }
      let n: number;
      if (flushAll) {
        n = q.length;
      } else {
        const cps = getEffectiveCPS(sessionId, q.length);
        const carry = toolTypewriterCarryRef.current[sessionId] ?? 0;
        const inc = (cps * TYPEWRITER_INTERVAL_MS) / 1000;
        const total = carry + inc;
        n = Math.floor(total);
        toolTypewriterCarryRef.current[sessionId] = total - n;
        if (n <= 0) return;
        n = Math.min(n, q.length);
      }
      const chunk = q.splice(0, n);
      if (chunk.length === 0) return;
      const prev = streamingToolsRef.current[sessionId];
      if (!prev) return;
      const newText = (prev.text ?? '') + chunk.join('');
      streamingToolsRef.current[sessionId] = { ...prev, text: newText };
      const isActive = sessionId === activeSessionIdRef.current;
      if (!isActive) {
        if (q.length === 0) {
          const timer = toolTypewriterTimersRef.current[sessionId];
          if (timer) {
            clearInterval(timer);
            delete toolTypewriterTimersRef.current[sessionId];
          }
          delete toolTypewriterCarryRef.current[sessionId];
        }
        return;
      }
      // Both raw and pretty at 16ms – immediate UI update for typewriter effect
      setStreamingTool({ ...streamingToolsRef.current[sessionId]! });
      if (q.length === 0) {
        const timer = toolTypewriterTimersRef.current[sessionId];
        if (timer) {
          clearInterval(timer);
          delete toolTypewriterTimersRef.current[sessionId];
        }
        delete toolTypewriterCarryRef.current[sessionId];
      }
    },
    [getEffectiveCPS],
  );

  // Mirror tps into refs so typewriter speed reacts instantly to polled tps as well
  useEffect(() => {
    tpsRef.current = tps;
    const sid = activeSessionIdRef.current;
    if (sid) tokenTpsRef.current[sid] = tps;
  }, [tps]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollButton(distanceFromBottom > SCROLL_THRESHOLD_PX);
  }, [SCROLL_THRESHOLD_PX]);

  const toggleMessageCollapsed = useCallback((id: number) => {
    const sid = activeSessionIdRef.current;
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (sid) {
        collapsedBySessionRef.current[sid] = new Set(next);
        if (!seenIdsRef.current[sid]) seenIdsRef.current[sid] = new Set();
        seenIdsRef.current[sid].add(id);
      }
      return next;
    });
  }, []);

  // ── Keep collapsed state in sync with messages (initial collapse for long user msgs)
  useEffect(() => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    if (!seenIdsRef.current[sid]) seenIdsRef.current[sid] = new Set();
    if (!collapsedBySessionRef.current[sid])
      collapsedBySessionRef.current[sid] = new Set();
    const seen = seenIdsRef.current[sid];
    const collapsedSet = collapsedBySessionRef.current[sid];
    let changed = false;
    for (const msg of messages) {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      const text = msg.content[0]?.text || '';
      const isLongUser =
        msg.role === 'user' && text.length >= 20 && text.split('\n').length > 5;
      const shouldCollapse = (msg as any).collapsed === true || isLongUser;
      if (shouldCollapse && !collapsedSet.has(msg.id)) {
        collapsedSet.add(msg.id);
        changed = true;
      }
    }
    if (changed) {
      collapsedBySessionRef.current[sid] = new Set(collapsedSet);
      setCollapsedIds(new Set(collapsedSet));
    }
  }, [messages]);

  // ── Sync collapsed set when active session switches
  useEffect(() => {
    if (!activeSessionId) {
      setCollapsedIds(new Set());
      return;
    }
    const saved = collapsedBySessionRef.current[activeSessionId];
    if (saved) {
      setCollapsedIds(new Set(saved));
    } else {
      if (!seenIdsRef.current[activeSessionId])
        seenIdsRef.current[activeSessionId] = new Set();
      if (!collapsedBySessionRef.current[activeSessionId])
        collapsedBySessionRef.current[activeSessionId] = new Set();
      setCollapsedIds(new Set(collapsedBySessionRef.current[activeSessionId]));
    }
  }, [activeSessionId]);

  const copyMessageText = useCallback((msg: Message) => {
    const text =
      msg.content.find((s) => s.type === 'normal')?.text ||
      msg.content[0]?.text ||
      '';
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedMsgId(msg.id);
        if (copiedMsgTimer.current) clearTimeout(copiedMsgTimer.current);
        return setTimeout(() => setCopiedMsgId(null), 2000);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setShowSourcesButton(false);
  }, [selectedProfileId]);

  useEffect(() => {
    if (systemPhase !== 'ready') {
      return;
    }
    const profile = profilesRef.current.find((p) => p.id === selectedProfileId);
    if (!profile?.tools) {
      setShowSourcesButton(false);
      return;
    }
    const metas = getAllToolMetas();
    setShowSourcesButton(
      profile.tools.some((name) => metas[name]?.tags?.includes('sources')),
    );
  }, [systemPhase, selectedProfileId]);

  const PROJECTOR_WARNING_EXIT_MS = 200;

  const hideProjectorWarning = useCallback(() => {
    setProjectorWarningClosing(true);
    if (projectorWarningExitTimer.current)
      clearTimeout(projectorWarningExitTimer.current);
    projectorWarningExitTimer.current = setTimeout(() => {
      setProjectorWarning(null);
      setProjectorWarningClosing(false);
      projectorWarningExitTimer.current = null;
    }, PROJECTOR_WARNING_EXIT_MS);
  }, []);

  useEffect(() => {
    // Defer all projector checks until after a full server load — not just banner
    if (
      systemPhase !== 'ready' ||
      modelLoading ||
      persistentModelLoading ||
      !isServerOnline ||
      loadError ||
      !persistentLoadedProfileId ||
      persistentLoadedProfileId !== selectedProfileId ||
      isQueued
    ) {
      hideProjectorWarning();
      return;
    }
    const profile = profilesRef.current.find((p) => p.id === selectedProfileId);
    if (!profile?.tools) {
      hideProjectorWarning();
      return;
    }
    const metas = getAllToolMetas();
    const projectorTools = profile.tools.filter(
      (name) => metas[name]?.displayType === 'projector',
    );
    if (projectorTools.length > 0 && projectorChecked && !projectorLoaded) {
      if (projectorWarningExitTimer.current) {
        clearTimeout(projectorWarningExitTimer.current);
        projectorWarningExitTimer.current = null;
      }
      setProjectorWarningClosing(false);
      const id = Date.now();
      setProjectorWarning({ tools: projectorTools, id });
    } else {
      hideProjectorWarning();
    }
  }, [
    systemPhase,
    selectedProfileId,
    projectorChecked,
    projectorLoaded,
    modelLoading,
    isServerOnline,
    loadError,
    isQueued,
    hideProjectorWarning,
  ]);

  const handleThinkingTokensChange = useCallback(
    (tokens: number) => {
      if (!selectedProfileId) return;
      try {
        const stored = localStorage.getItem('profiles');
        if (stored) {
          const parsed: Profile[] = JSON.parse(stored);
          const idx = parsed.findIndex((p) => p.id === selectedProfileId);
          if (idx >= 0) {
            parsed[idx] = { ...parsed[idx], thinkingTokens: tokens };
            localStorage.setItem('profiles', JSON.stringify(parsed));
          }
        }
      } catch {
        // Ignore storage errors
      }
    },
    [selectedProfileId],
  );

  const refreshCumulativeTokens = useCallback(async () => {
    try {
      const nextUsage = await window.electronAPI.chatCumulativeTokenUsage();
      setUsageSummary(nextUsage);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    refreshCumulativeTokens();
  }, [refreshCumulativeTokens]);

  const dismissChatError = useCallback((id: string) => {
    if (chatErrorTimers.current[id]) {
      clearTimeout(chatErrorTimers.current[id]);
      delete chatErrorTimers.current[id];
    }
    setChatErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const showErrorToast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setChatErrors((prev) => [...prev, { message, id }]);
    chatErrorTimers.current[id] = setTimeout(() => {
      delete chatErrorTimers.current[id];
      setChatErrors((prev) => prev.filter((e) => e.id !== id));
    }, 6000);
  }, []);

  // Shown only when llama-server directly denies a generation request
  // (HTTP 503 / "no slot is free"), surfaced via the 'slot-unavailable'
  // stream event.
  const showSlotBanner = useCallback(() => {
    setShowSlotInfo(true);
    if (slotBannerHideTimer.current) clearTimeout(slotBannerHideTimer.current);
    slotBannerHideTimer.current = setTimeout(() => {
      slotBannerHideTimer.current = null;
      setShowSlotInfo(false);
    }, 8000);
  }, []);

  const hideSlotInfo = useCallback(() => {
    setShowSlotInfo(false);
    if (slotBannerHideTimer.current) clearTimeout(slotBannerHideTimer.current);
    slotBannerHideTimer.current = null;
  }, []);

  // Sync a session's messages/state from the main process after status
  // transitions, so the renderer stays a pure consumer of authoritative state.
  const syncSessionFromMain = useCallback(
    async (sessionId: string) => {
      const view = await window.electronAPI.chatGetSession(sessionId);
      if (!view) return;
      sessionMessagesRef.current[sessionId] = view.session.messages;
      messageCountersRef.current[sessionId] = view.session.messages.reduce(
        (max, m) => Math.max(max, m.id + 1),
        0,
      );
      setLoadingSessions((prev) => ({
        ...prev,
        [sessionId]: view.status !== 'idle',
      }));
      setSources(sessionId, view.session.sources ?? []);
      if (sessionId === activeSessionIdRef.current) {
        setMessages(view.session.messages);
        setStreamingTool(view.streamingTool);
        setProgressPercent(view.progress);
      }
    },
    [setSources],
  );

  const queueSessionSync = useCallback(
    (sessionId: string) => {
      if (syncThrottleRef.current[sessionId]) {
        clearTimeout(syncThrottleRef.current[sessionId]);
      }
      syncThrottleRef.current[sessionId] = setTimeout(() => {
        delete syncThrottleRef.current[sessionId];
        syncSessionFromMain(sessionId).catch(() => {});
      }, 250);
    },
    [syncSessionFromMain],
  );

  useEffect(() => {
    window.electronAPI
      .loadSettings()
      .then((s) => setSettings(s))
      .catch(() => {});
    window.electronAPI
      .getBinaryDownloads()
      .then((d) => {
        const list = [
          ...d.backends.map((b) => ({
            id: b.id,
            label: b.label,
            folder: b.folder,
          })),
          ...d.customBackendPaths.map((p) => ({
            id: p,
            label: p,
            folder: '',
          })),
        ];
        setBackendOptions(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!backendMenuOpen && !deviceMenuOpen && !stateMenuOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (
        backendMenuRef.current &&
        !backendMenuRef.current.contains(e.target as Node)
      ) {
        setBackendMenuOpen(false);
      }
      if (
        deviceMenuRef.current &&
        !deviceMenuRef.current.contains(e.target as Node)
      ) {
        setDeviceMenuOpen(false);
      }
      if (
        stateMenuRef.current &&
        !stateMenuRef.current.contains(e.target as Node)
      ) {
        setStateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [backendMenuOpen, deviceMenuOpen, stateMenuOpen]);

  const handleSelectBackend = async (id: string) => {
    setBackendMenuOpen(false);
    if (!settings) return;
    const next = { ...settings, selectedBackend: id };
    setSettings(next);
    try {
      await window.electronAPI.saveSettingsSilent(next);
    } catch {
      // Silently fail
    }
    try {
      const res = await window.electronAPI.chatReloadProfile();
      if (res && (res as any).success && (res as any).backend) {
        setBackend((res as any).backend);
      }
    } catch {
      // Silently fail
    }
  };

  const applyOpenvinoSettings = async (
    device: 'CPU' | 'GPU' | 'NPU',
    stateful: boolean,
  ) => {
    if (!settings) return;
    // NPU does not support stateful execution — force Stateless
    const nextStateful = device === 'NPU' ? false : stateful;
    const next = {
      ...settings,
      openvinoDevice: device,
      openvinoStateful: nextStateful,
    };
    setSettings(next);
    try {
      await window.electronAPI.saveSettingsSilent(next);
    } catch {
      // Silently fail
    }
    try {
      await window.electronAPI.chatReloadProfile();
    } catch {
      // Silently fail
    }
  };

  const handleSelectOvDevice = async (device: 'CPU' | 'GPU' | 'NPU') => {
    setDeviceMenuOpen(false);
    setStateMenuOpen(false);
    if (!settings) return;
    await applyOpenvinoSettings(device, settings.openvinoStateful ?? false);
  };

  const handleSelectOvStateful = async (stateful: boolean) => {
    setStateMenuOpen(false);
    if (!settings) return;
    await applyOpenvinoSettings(settings.openvinoDevice || 'CPU', stateful);
  };

  // ── Server online/offline startup gating & polling ─────────────────────
  useEffect(() => {
    if (!settings || hasCheckedStartupRef.current) return;
    // Only gate on startup: if server already running, stay online (don't kill).
    // Otherwise obey launchServerAutomatically.
    let cancelled = false;
    hasCheckedStartupRef.current = true;
    window.electronAPI
      .chatIsRunning()
      .then((running) => {
        if (cancelled) return;
        if (running) {
          setIsServerOnline(true);
        } else if ((settings.launchServerAutomatically ?? true) === false) {
          setIsServerOnline(false);
        } else {
          setIsServerOnline(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Keep pill in sync with actual backend (handles external unload/crash)
  useEffect(() => {
    const id = window.setInterval(() => {
      window.electronAPI
        .chatIsRunning()
        .then((running) => {
          // Don't overwrite a manual offline intent before first load finishes.
          // Once model is loaded at least once, running is source of truth.
          if (persistentLoadedProfileId || running) {
            setIsServerOnline(running);
          } else if (!running && modelLoading) {
            // Stay online while loading
          } else if (!running && !modelLoading) {
            // If we are offline by user choice, keep it; otherwise reflect.
            // When launchServerAutomatically is false we keep offline until manual start.
            if (
              (settings?.launchServerAutomatically ?? true) === false &&
              !manualStartRequestedRef.current
            ) {
              setIsServerOnline(false);
            } else {
              setIsServerOnline(running);
            }
          }
        })
        .catch(() => {});
    }, 2500);
    return () => window.clearInterval(id);
  }, [settings, modelLoading]);

  // Reflect unload/loadError into pill
  useEffect(() => {
    if (loadError) setIsServerOnline(false);
  }, [loadError]);
  useEffect(() => {
    if (modelLoading) setIsServerOnline(true);
  }, [modelLoading]);

  // Clear queued flag if server fails to start — keep text so user can retry
  useEffect(() => {
    if (loadError && pendingQueuedRef.current) {
      pendingQueuedRef.current = false;
      setIsQueued(false);
    }
  }, [loadError]);

  const triggerServerStart = useCallback(async () => {
    if (!selectedProfileId) return;
    manualStartRequestedRef.current = true;
    preserveSessionOnNextLoadRef.current = true;
    setIsServerOnline(true);
    setLoadError(null);
    // Re-trigger the profile load effect by toggling the selected id
    const id = selectedProfileId;
    setSelectedProfileId('');
    setTimeout(() => setSelectedProfileId(id), 30);
  }, [selectedProfileId]);

  const handleToggleServer = useCallback(async () => {
    if (serverToggling) return;
    setServerToggling(true);
    try {
      if (isServerOnline) {
        // Stop server — immediate UI reset for all loading phases
        if (loadAbortController.current)
          loadAbortController.current.cancelled = true;
        persistentModelLoading = false;
        persistentLastLoadId += 1;
        preserveSessionOnNextLoadRef.current = false;
        pendingQueuedRef.current = false;
        setIsQueued(false);
        setModelLoading(false);
        setSystemPhase('ready');
        setSystemProgress(0);
        setSystemStatusMessage('');
        setSystemPromptDone(null);
        setProgressPercent(0);
        setLoadError(null);
        persistentLoadedProfileId = '';
        setIsServerOnline(false);
        manualStartRequestedRef.current = false;
        await window.electronAPI.chatUnload();
      } else {
        await triggerServerStart();
      }
    } finally {
      setServerToggling(false);
    }
  }, [isServerOnline, serverToggling, triggerServerStart]);

  const estimatedCost = totalSavings(usageSummary);

  const openSavingsModal = useCallback(
    (basis: 'monthly' | 'total', title: string) => {
      const currentMonthId = getMonthId();
      const effectiveMonthId =
        usageSummary.lastAutoOpenedMonthId !== currentMonthId
          ? (getLastNonZeroMonthId(usageSummary) ?? currentMonthId)
          : currentMonthId;
      setSavingsModalBasis(basis);
      setSavingsModalTitle(title);
      setSavingsModalMonthId(effectiveMonthId);
      setSavingsModalMonthLabel(
        effectiveMonthId === currentMonthId ? 'This month' : 'Last month',
      );
      setShowSavingsModal(true);
    },
    [usageSummary],
  );

  useEffect(() => {
    if (!modelLoading || loadError || autoSavingsShownRef.current) return;
    const currentMonthId = getMonthId();
    if (usageSummary.lastAutoOpenedMonthId !== currentMonthId) {
      autoSavingsShownRef.current = true;
      openSavingsModal('monthly', 'While your model loads...');
      window.electronAPI
        .usageSetLastOpenedMonth(currentMonthId)
        .catch(() => {});
    }
  }, [
    modelLoading,
    loadError,
    usageSummary.lastAutoOpenedMonthId,
    openSavingsModal,
  ]);

  const selectedProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? null;

  const loading = !!activeSessionId && !!loadingSessions[activeSessionId];
  const sending = sendingState && !loading;
  const processing = !!activeSessionId && !!processingSessions[activeSessionId];
  const executing =
    activeSessionId != null
      ? (executingSessions[activeSessionId] ?? null)
      : null;
  messagesRef.current = messages;

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    setActiveSession(activeSessionId);
  }, [activeSessionId, setActiveSession]);

  // Reset double-click guard on session switch – prevents bleed to idle sessions
  useEffect(() => {
    sendingRef.current = false;
    setSendingState(false);
  }, [activeSessionId]);

  const profileHasProjector = !!selectedProfile?.projector;
  const canAttachImages = !!(
    projectorLoaded ||
    (profileHasProjector && !loadError)
  );

  const loadProfilesFromStorage = useCallback(() => {
    const stored = localStorage.getItem('profiles');
    let parsed: Profile[] = [];

    if (stored) {
      try {
        parsed = JSON.parse(stored);
        const sorted = [...parsed].sort((a, b) => a.order - b.order);
        parsed = sorted;
      } catch {
        return [];
      }
    }

    const profilesChanged =
      JSON.stringify(parsed) !== JSON.stringify(profilesRef.current);
    if (profilesChanged) {
      setProfiles(parsed);
      profilesRef.current = parsed;
    }

    return parsed;
  }, []);

  useEffect(() => {
    // Don't probe projector until server is fully ready — avoids spurious warning when offline
    if (
      !selectedProfileId ||
      modelLoading ||
      persistentModelLoading ||
      loadError ||
      !isServerOnline ||
      systemPhase !== 'ready' ||
      !persistentLoadedProfileId ||
      persistentLoadedProfileId !== selectedProfileId ||
      isQueued
    ) {
      setProjectorLoaded(false);
      setProjectorChecked(false);
      return;
    }
    setProjectorChecked(false);
    window.electronAPI
      .chatHasProjector()
      .then((v) => {
        setProjectorLoaded(v);
        setProjectorChecked(true);
      })
      .catch(() => {
        setProjectorLoaded(false);
        setProjectorChecked(true);
      });
  }, [
    selectedProfileId,
    modelLoading,
    loadError,
    isServerOnline,
    systemPhase,
    isQueued,
  ]);

  const unloadModel = async (): Promise<void> => {
    if (unloadInProgress.current) {
      const startTime = Date.now();
      const maxWaitTime = 5000;
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (
            !unloadInProgress.current ||
            Date.now() - startTime > maxWaitTime
          ) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
      return;
    }

    unloadInProgress.current = true;

    try {
      await window.electronAPI.chatUnload();
      persistentLoadedProfileId = '';
    } finally {
      unloadInProgress.current = false;
    }
  };

  useEffect(() => {
    loadProfilesFromStorage();

    const storedSelectedId = localStorage.getItem('selectedProfileId');
    if (storedSelectedId) {
      setSelectedProfileId(storedSelectedId);
    }

    const handleProfilesChanged = () => {
      const updated = loadProfilesFromStorage();

      if (persistentLoadedProfileId && updated.length > 0) {
        const currentProfile = updated.find(
          (p) => p.id === persistentLoadedProfileId,
        );
        if (currentProfile) {
          setSelectedProfileId('');
          setTimeout(() => setSelectedProfileId(persistentLoadedProfileId), 10);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadProfilesFromStorage();

        const deferredSwitch = localStorage.getItem('deferredProfileSwitch');
        if (deferredSwitch) {
          localStorage.removeItem('deferredProfileSwitch');
          return;
        }

        const visibilityStoredId = localStorage.getItem('selectedProfileId');
        if (
          visibilityStoredId &&
          visibilityStoredId !== persistentLoadedProfileId
        ) {
          setSelectedProfileId(visibilityStoredId);
        }
      }
    };

    window.addEventListener('profiles-changed', handleProfilesChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('profiles-changed', handleProfilesChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadProfilesFromStorage]);

  useEffect(() => {
    if (location.pathname === '/chat') {
      loadProfilesFromStorage();

      const deferredSwitch = localStorage.getItem('deferredProfileSwitch');
      if (deferredSwitch) {
        localStorage.removeItem('deferredProfileSwitch');
        return;
      }

      const navStoredId = localStorage.getItem('selectedProfileId');

      if (navStoredId && navStoredId !== persistentLoadedProfileId) {
        setSelectedProfileId(navStoredId);
      } else if (!navStoredId && persistentLoadedProfileId) {
        setSelectedProfileId('');
      }
    }
  }, [location.pathname, loadProfilesFromStorage]);

  const startNewChatWithProfile = async (profileId: string | null) => {
    if (activeSessionIdRef.current) {
      sessionMessagesRef.current[activeSessionIdRef.current] = messages;
    }
    clearAllTypewriterSessions();
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    sessionMessagesRef.current = {};
    messageCountersRef.current = {};
    segmentCountersRef.current = {};
    collapsedBySessionRef.current = {};
    seenIdsRef.current = {};
    setMessages([]);
    setCollapsedIds(new Set());
    clearAllSources();
    setStreamingTool(null);
    setProgressPercent(0);
    setUsedTokens(0);
    systemMessageInsertedRef.current = false;
    setSystemPromptDone(null);
    setSystemPhase('ready');
    pendingMedia.forEach((m) => {
      if (m.type === 'video') URL.revokeObjectURL(m.objectUrl);
    });
    setPendingMedia([]);

    if (persistentLoadedProfileId) {
      await unloadModel();
    }

    if (profileId) {
      setSelectedProfileId('');
      setTimeout(() => setSelectedProfileId(profileId), 10);
    }
  };

  const handleConfirmNewChat = async () => {
    setShowConfirmDialog(false);
    await startNewChatWithProfile(pendingProfileId);
    setPendingProfileId(null);
  };

  const handleCancelNewChat = () => {
    setShowConfirmDialog(false);
    setPendingProfileId(null);
  };

  useEffect(() => {
    if (selectedProfileId) {
      localStorage.setItem('selectedProfileId', selectedProfileId);
    } else {
      localStorage.removeItem('selectedProfileId');
    }
  }, [selectedProfileId]);

  useEffect(() => {
    localStorage.setItem(
      'sessionsSidebarCollapsed',
      sidebarCollapsed ? '1' : '0',
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    const syncContextSize = async () => {
      const { contextSize } = await window.electronAPI.chatContextSize();
      if (contextSize !== null) setMaxTokens(contextSize);
    };
    syncContextSize();
  }, []);

  useEffect(() => {
    const abortController = { cancelled: false };
    loadAbortController.current = abortController;

    const load = async () => {
      persistentLastLoadId += 1;
      const myLoadId = persistentLastLoadId;

      if (!selectedProfileId) {
        setLoadError(null);
        return;
      }

      // Wait for settings to be known before deciding to auto-boot.
      // Prevents an early load (settings === null) from bypassing the toggle.
      if (settings === null) {
        return;
      }

      // ── Launch Server Automatically gating (only when server not already running)
      // If setting is off and user hasn't manually requested a start, don't auto-boot.
      if (
        (settings.launchServerAutomatically ?? true) === false &&
        !manualStartRequestedRef.current
      ) {
        const running = await window.electronAPI
          .chatIsRunning()
          .catch(() => false);
        if (!running && !persistentLoadedProfileId) {
          // Stay offline until user presses Power / Server Online
          if (!abortController.cancelled && myLoadId === persistentLastLoadId) {
            setModelLoading(false);
            persistentModelLoading = false;
            setLoadError(null);
            setIsServerOnline(false);
          }
          return;
        }
        // Existing server is running — respect it (don't kill), fall through to normal load handling
      }

      const profile =
        profilesRef.current.find((p) => p.id === selectedProfileId) ?? null;

      if (!profile) {
        setLoadError(null);
        return;
      }

      if (persistentLoadedProfileId === selectedProfileId) {
        const forceReload = localStorage.getItem('forceProfileReload');
        if (forceReload === selectedProfileId) {
          localStorage.removeItem('forceProfileReload');
          // Profile was edited and server restarted — fall through to full reload
        } else {
          const isRunning = await window.electronAPI.chatIsRunning();
          if (isRunning) {
            const { contextSize } = await window.electronAPI.chatContextSize();
            if (contextSize !== null && contextSize > 0) {
              if (
                !abortController.cancelled &&
                myLoadId === persistentLastLoadId
              ) {
                setMaxTokens(contextSize);
                setLoadError(null);
              }
              return;
            }
          }
          // Server was restarted or not ready — fall through to full reload
        }
      }

      const shouldPreserveSession = preserveSessionOnNextLoadRef.current;
      preserveSessionOnNextLoadRef.current = false;

      persistentModelLoading = true;
      setModelLoading(true);
      setLoadError(null);
      if (shouldPreserveSession) {
        // Preserve current session — only reset transient loading state.
        setStreamingTool(null);
        setProgressPercent(0);
      } else {
        setUsedTokens(0);
        setMaxTokens(null);
        setMessages([]);
        setCollapsedIds(new Set());
        clearAllSources();
        setStreamingTool(null);
        setProgressPercent(0);
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
        systemMessageInsertedRef.current = false;
        setSystemPromptDone(null);
        pendingMedia.forEach((m) => {
          if (m.type === 'video') URL.revokeObjectURL(m.objectUrl);
        });
        setPendingMedia([]);
      }

      if (persistentLoadedProfileId) {
        await unloadModel();
      }

      try {
        if (abortController.cancelled || myLoadId !== persistentLastLoadId)
          return;

        const res = await window.electronAPI.chatLoadProfile(profile);

        if (abortController.cancelled || myLoadId !== persistentLastLoadId)
          return;

        if (res.success) {
          if ((res as any).backend) {
            setBackend((res as any).backend);
          }
          if ((res as any).profile) {
            const stored = JSON.parse(localStorage.getItem('profiles') || '[]');
            const idx = stored.findIndex(
              (p: any) => p.id === (res as any).profile.id,
            );
            if (idx >= 0) {
              stored[idx] = (res as any).profile;
              localStorage.setItem('profiles', JSON.stringify(stored));
              window.dispatchEvent(new Event('profiles-changed'));
            }
          }

          persistentLoadedProfileId = selectedProfileId;
          if (!abortController.cancelled && myLoadId === persistentLastLoadId) {
            setIsServerOnline(true);
          }

          const { contextSize } = await window.electronAPI.chatContextSize();

          if (!abortController.cancelled && myLoadId === persistentLastLoadId) {
            if (contextSize !== null && contextSize > 0) {
              setMaxTokens(contextSize);
              setLoadError(null);
            } else {
              persistentLoadedProfileId = '';
              setLoadError(
                'Profile loaded but context is invalid. Try reloading.',
              );
              await unloadModel();
              if (
                !abortController.cancelled &&
                myLoadId === persistentLastLoadId
              )
                setIsServerOnline(false);
            }
          }
        } else {
          persistentLoadedProfileId = '';
          // Don't show error toast if load was intentionally aborted (shutdown during any loading phase)
          if (
            !abortController.cancelled &&
            myLoadId === persistentLastLoadId &&
            res.error !== 'Server shutdown requested'
          ) {
            setLoadError(res.error || 'Failed to load profile');
          }
          await unloadModel();
          if (!abortController.cancelled && myLoadId === persistentLastLoadId)
            setIsServerOnline(false);
        }
      } catch (error) {
        persistentLoadedProfileId = '';
        const msg =
          error instanceof Error ? error.message : 'Unknown error occurred';
        // Ignore intentional shutdown abort — UI already reset immediately
        if (
          !abortController.cancelled &&
          myLoadId === persistentLastLoadId &&
          msg !== 'Server shutdown requested'
        ) {
          setLoadError(msg);
        }
        await unloadModel();
        if (!abortController.cancelled && myLoadId === persistentLastLoadId)
          setIsServerOnline(false);
      } finally {
        if (myLoadId === persistentLastLoadId) {
          persistentModelLoading = false;
          setModelLoading(false);
        }
      }
    };

    load();

    return () => {
      abortController.cancelled = true;
    };
  }, [selectedProfileId, clearAllSources, settings]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (maxTokens !== null || !selectedProfileId) {
        clearInterval(interval);
        return;
      }

      window.electronAPI
        .chatContextSize()
        .then(({ contextSize }) => {
          if (contextSize !== null) {
            setMaxTokens(contextSize);
            clearInterval(interval);
          }
          return undefined;
        })
        .catch(() => {
          // Silently fail on error
        });
    }, 1000);

    return () => clearInterval(interval);
  }, [maxTokens, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId || modelLoading || loadError) return undefined;

    const updateContextUsage = async () => {
      const usage = await window.electronAPI.chatContextUsage();
      setUsedTokens(usage.used);
      if (usage.total > 0 && maxTokens === null) {
        setMaxTokens(usage.total);
      }

      if (loading && usage.used > 0) {
        const isPromptOrToolPhase = processing || !!executing;
        if (isPromptOrToolPhase) {
          // During prompt processing or tool execution/reprocessing, absorb any jump
          // (user input tokens, tokenized tool results) without counting toward TPS.
          lastTokenSnapshot.current = { tokens: usage.used, time: Date.now() };
          if (generationBaselineTokens.current === null) {
            generationBaselineTokens.current = usage.used;
          }
          const activeId = activeSessionIdRef.current;
          if (activeId) {
            tokenTimestampsRef.current[activeId] = [];
            tokenTpsRef.current[activeId] = 0;
            tokenCharsRef.current[activeId] = { chars: 0, tokens: 0 };
          }
          setTps(0);
        } else if (!lastTokenSnapshot.current) {
          lastTokenSnapshot.current = { tokens: usage.used, time: Date.now() };
          if (generationBaselineTokens.current === null) {
            generationBaselineTokens.current = usage.used;
          }
        } else if (usage.used > lastTokenSnapshot.current.tokens) {
          const deltaTokens = usage.used - lastTokenSnapshot.current.tokens;
          // Guard: huge jumps that slipped through (missed prompt phase) are rebased, not counted as TPS
          if (deltaTokens > 2000) {
            lastTokenSnapshot.current = {
              tokens: usage.used,
              time: Date.now(),
            };
            generationBaselineTokens.current = usage.used;
            setTps(0);
          } else {
            const deltaTime =
              (Date.now() - lastTokenSnapshot.current.time) / 1000;
            const instantTps = deltaTime > 0 ? deltaTokens / deltaTime : 0;
            setTps((prev) => 0.3 * instantTps + 0.7 * prev);
            lastTokenSnapshot.current = {
              tokens: usage.used,
              time: Date.now(),
            };
          }
        }
      } else if (!loading) {
        generationBaselineTokens.current = null;
        lastTokenSnapshot.current = null;
        setTps(0);
      }
    };

    updateContextUsage();

    const pollInterval = loading ? 500 : 2000;
    const interval = setInterval(updateContextUsage, pollInterval);

    return () => clearInterval(interval);
  }, [
    selectedProfileId,
    modelLoading,
    loading,
    maxTokens,
    loadError,
    processing,
    executing,
  ]);

  const addSourcesFromToolResult = useCallback(
    (
      sessionId: string,
      sources?: { title: string; url: string }[],
      topSources?: { title: string; url: string }[],
    ) => {
      const newSources: {
        title: string;
        url: string;
        kind: 'top' | 'other';
      }[] = [];
      if (Array.isArray(sources)) {
        newSources.push(
          ...sources.map((s) => ({
            title: s.title,
            url: s.url,
            kind: 'other' as const,
          })),
        );
      }
      if (Array.isArray(topSources)) {
        newSources.push(
          ...topSources.map((s) => ({
            title: s.title,
            url: s.url,
            kind: 'top' as const,
          })),
        );
      }
      if (newSources.length > 0) {
        addSources(sessionId, newSources);
      }
    },
    [addSources],
  );

  useEffect(() => {
    const unsubscribe = window.electronAPI.onChatStreamEvent((payload) => {
      const { sessionId } = payload;
      if (!sessionId) return;

      const isActive = sessionId === activeSessionIdRef.current;

      const applyToSession = (
        sessionIdToApply: string,
        isActiveToApply: boolean,
        fn: (prev: Message[]) => Message[],
      ) => {
        const current = sessionMessagesRef.current[sessionIdToApply] ?? [];
        const next = fn(current);
        sessionMessagesRef.current[sessionIdToApply] = next;
        if (isActiveToApply) setMessages(next);
      };

      const flushTokenBuffer = () => {
        if (tokenFlushTimerRef.current) {
          clearTimeout(tokenFlushTimerRef.current);
          tokenFlushTimerRef.current = null;
        }
        const buffers = pendingTokenBuffersRef.current;
        pendingTokenBuffersRef.current = {};
        const toolDirty = streamingToolDirtyRef.current;
        streamingToolDirtyRef.current = false;
        const procDirty = processingDirtyRef.current;
        processingDirtyRef.current = false;
        // Failsafe: if token arrived but buffers were empty (typewriter path handled separately),
        // still clear processing – this branch covers non-typewriter path.
        // Moved outside loop so a single procDirty isn't lost when buffers empty.
        if (procDirty && Object.keys(buffers).length === 0) {
          // No buffered sessions to iterate – the typewriter path already cleared
          // processing directly, so nothing to do here. Keep for safety.
        }
        // Tool streaming now uses typewriter queue with batched pretty flush,
        // but keep legacy dirty flush outside loop for safety (previously trapped inside loop).
        if (toolDirty) {
          const activeId = activeSessionIdRef.current;
          if (activeId && streamingToolsRef.current[activeId] !== undefined) {
            setStreamingTool(streamingToolsRef.current[activeId] ?? null);
          }
        }

        Object.keys(buffers).forEach((bufferedSessionId) => {
          const events = buffers[bufferedSessionId];
          if (!events || events.length === 0) return;
          const bufferedActive =
            bufferedSessionId === activeSessionIdRef.current;

          if (procDirty) {
            setProcessingSessions((prev) => ({
              ...prev,
              [bufferedSessionId]: false,
            }));
            // Failsafe: progress is prompt-only – hide it the moment tokens flow
            progressRef.current[bufferedSessionId] = 0;
            if (bufferedActive) setProgressPercent(0);
          }

          applyToSession(bufferedSessionId, bufferedActive, (prev) => {
            let updated = prev;
            events.forEach((ev) => {
              const { token, segmentType } = ev;
              const last = updated[updated.length - 1];

              if (last && last.role === 'assistant') {
                const updatedContent = [...last.content];
                const lastSegment = updatedContent[updatedContent.length - 1];

                let currentType: 'thought' | 'comment' | 'normal' = 'normal';
                if (segmentType === 'thought') currentType = 'thought';
                else if (segmentType === 'comment') currentType = 'comment';

                if (lastSegment && lastSegment.type === currentType) {
                  lastSegment.text += token;
                } else {
                  const counters = segmentCountersRef.current;
                  counters[bufferedSessionId] =
                    (counters[bufferedSessionId] ?? 0) + 1;
                  updatedContent.push({
                    id: `seg-${Date.now()}-${counters[bufferedSessionId]}`,
                    text: token ?? '',
                    type: currentType,
                  });
                }

                updated = [
                  ...updated.slice(0, -1),
                  { ...last, content: updatedContent },
                ];
                return;
              }

              const counters = messageCountersRef.current;
              const id = counters[bufferedSessionId] ?? 0;
              counters[bufferedSessionId] = id + 1;
              const segCounters = segmentCountersRef.current;
              segCounters[bufferedSessionId] =
                (segCounters[bufferedSessionId] ?? 0) + 1;

              let initialType: 'thought' | 'comment' | 'normal' = 'normal';
              if (segmentType === 'thought') initialType = 'thought';
              else if (segmentType === 'comment') initialType = 'comment';

              updated = [
                ...updated,
                {
                  id,
                  role: 'assistant',
                  content: [
                    {
                      id: `seg-${Date.now()}-${segCounters[bufferedSessionId]}`,
                      text: (token ?? '').replace(/^\s+/, ''),
                      type: initialType,
                    },
                  ],
                },
              ];
            });
            return updated;
          });
        });
      };

      // Legacy flush still used for 'prompt-done' etc – keep for pending buffers (currently unused but safe)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const scheduleTokenFlush = () => {
        if (tokenFlushTimerRef.current) return;
        tokenFlushTimerRef.current = setTimeout(() => {
          tokenFlushTimerRef.current = null;
          flushTokenBuffer();
        }, 50);
      };

      const setSessionLoading = (value: boolean) => {
        setLoadingSessions((prev) => ({ ...prev, [sessionId]: value }));
      };
      const setSessionProcessing = (value: boolean) => {
        setProcessingSessions((prev) => ({ ...prev, [sessionId]: value }));
      };

      const flushTypewriterFor = (sid: string, flushAll = false) => {
        const q = typewriterQueuesRef.current[sid];
        if (!q || q.length === 0) return;
        if (flushAll) {
          // drain all instantly in one update
          drainTypewriterQueue(sid, true);
          // if still remaining (very large), loop
          while (
            typewriterQueuesRef.current[sid] &&
            typewriterQueuesRef.current[sid].length > 0
          ) {
            drainTypewriterQueue(sid, true);
          }
        } else {
          drainTypewriterQueue(sid, false);
        }
      };

      const flushToolTypewriterFor = (sid: string, flushAll = false) => {
        const q = toolTypewriterQueuesRef.current[sid];
        if (!q || q.length === 0) return;
        if (flushAll) {
          drainToolTypewriterQueue(sid, true);
          while (
            toolTypewriterQueuesRef.current[sid] &&
            toolTypewriterQueuesRef.current[sid].length > 0
          ) {
            drainToolTypewriterQueue(sid, true);
          }
        } else {
          drainToolTypewriterQueue(sid, false);
        }
      };

      switch (payload.type) {
        case 'token': {
          const { token, segmentType } = payload;
          if (segmentType === 'tool') {
            // Typewriter for tool JSON – both raw and pretty at 16ms
            const now = Date.now();
            const arr = tokenTimestampsRef.current[sessionId] ?? [];
            arr.push(now);
            while (arr.length > 0 && now - arr[0] > 500) arr.shift();
            tokenTimestampsRef.current[sessionId] = arr;
            const instantTps = arr.length * 2;
            const prevTps = tokenTpsRef.current[sessionId] ?? 0;
            tokenTpsRef.current[sessionId] =
              prevTps === 0 ? instantTps : 0.3 * instantTps + 0.7 * prevTps;
            const cc = tokenCharsRef.current[sessionId] ?? {
              chars: 0,
              tokens: 0,
            };
            cc.chars += Array.from(token ?? '').length;
            cc.tokens += 1;
            tokenCharsRef.current[sessionId] = cc;

            if (!streamingToolsRef.current[sessionId]) {
              streamingToolsRef.current[sessionId] = {
                name: 'tool',
                text: '',
              };
            }
            if (!toolTypewriterQueuesRef.current[sessionId]) {
              toolTypewriterQueuesRef.current[sessionId] = [];
            }
            for (const ch of Array.from(token ?? '')) {
              toolTypewriterQueuesRef.current[sessionId].push(ch);
            }
            if (!toolTypewriterTimersRef.current[sessionId]) {
              toolTypewriterCarryRef.current[sessionId] = 0;
              toolTypewriterTimersRef.current[sessionId] = setInterval(
                () => drainToolTypewriterQueue(sessionId),
                TYPEWRITER_INTERVAL_MS,
              );
            }
            return;
          }

          // Always enabled typewriter – TPS observation and char queuing
          const now = Date.now();
          const arr = tokenTimestampsRef.current[sessionId] ?? [];
          arr.push(now);
          // keep 500ms window
          while (arr.length > 0 && now - arr[0] > 500) arr.shift();
          tokenTimestampsRef.current[sessionId] = arr;
          const instantTps = arr.length * 2; // per 500ms -> per sec
          const prevTps = tokenTpsRef.current[sessionId] ?? 0;
          tokenTpsRef.current[sessionId] =
            prevTps === 0 ? instantTps : 0.3 * instantTps + 0.7 * prevTps;
          // chars/token estimator
          const cc = tokenCharsRef.current[sessionId] ?? {
            chars: 0,
            tokens: 0,
          };
          cc.chars += Array.from(token ?? '').length;
          cc.tokens += 1;
          tokenCharsRef.current[sessionId] = cc;

          // Failsafe: hide "Processing prompt… 100%" the instant generation starts
          setProcessingSessions((prev) => {
            if (!prev[sessionId]) return prev;
            return { ...prev, [sessionId]: false };
          });
          progressRef.current[sessionId] = 0;
          if (isActive) setProgressPercent(0);
          processingDirtyRef.current = false;

          if (!typewriterQueuesRef.current[sessionId]) {
            typewriterQueuesRef.current[sessionId] = [];
          }
          for (const ch of Array.from(token ?? '')) {
            typewriterQueuesRef.current[sessionId].push({
              char: ch,
              segmentType,
            });
          }
          if (!typewriterTimersRef.current[sessionId]) {
            typewriterCarryRef.current[sessionId] = 0;
            typewriterTimersRef.current[sessionId] = setInterval(
              () => drainTypewriterQueue(sessionId),
              TYPEWRITER_INTERVAL_MS,
            );
          }
          return;
        }

        case 'progress': {
          progressRef.current[sessionId] = payload.progress ?? 0;
          if (isActive) setProgressPercent(progressRef.current[sessionId]);
          // ── Early single-jump absolute truth (first progress tick) ──
          // Prefer prompt processing total from progress event over waiting for prompt-done.
          // Single jump to final total, gated by isColdStart || isFirstPrompt, deduped per prompt.
          if (
            !isReprocessingRef.current[sessionId] &&
            payload.totalTokens !== undefined &&
            !appliedProgressTruthRef.current[sessionId]
          ) {
            const isCold = !!payload.isColdStart;
            const priorMsgs = sessionMessagesRef.current[sessionId] ?? [];
            const userCount = priorMsgs.filter((m) => m.role === 'user').length;
            const isFirstPromptInSession = userCount <= 1;
            // Early jump only for cold reloads or first prompt; otherwise just re-anchor TPS window
            if (isCold || isFirstPromptInSession) {
              const abs = payload.totalTokens;
              if (isActive) {
                setUsedTokens(abs);
                lastTokenSnapshot.current = { tokens: abs, time: Date.now() };
                generationBaselineTokens.current = abs;
                tokenTimestampsRef.current[sessionId] = [];
                tokenCharsRef.current[sessionId] = { chars: 0, tokens: 0 };
                tokenTpsRef.current[sessionId] = 0;
                setTps(0);
              } else {
                tokenTimestampsRef.current[sessionId] = [];
                tokenCharsRef.current[sessionId] = { chars: 0, tokens: 0 };
                tokenTpsRef.current[sessionId] = 0;
              }
              appliedProgressTruthRef.current[sessionId] = true;
            } else {
              // Non-cold, non-first: still reset window to avoid counting prompt delta, but don't change displayed counter
              tokenTimestampsRef.current[sessionId] = [];
              tokenCharsRef.current[sessionId] = { chars: 0, tokens: 0 };
              tokenTpsRef.current[sessionId] = 0;
              if (isActive) {
                lastTokenSnapshot.current = {
                  tokens: payload.totalTokens,
                  time: Date.now(),
                };
                generationBaselineTokens.current = payload.totalTokens;
              }
              // Mark handled so we don't re-anchor on every progress tick
              appliedProgressTruthRef.current[sessionId] = true;
            }
          }
          return;
        }

        case 'prompt-done': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          const promptStats = payload.stats;
          if (!promptStats) return;
          const isReprocessing = !!isReprocessingRef.current[sessionId];
          // ── Absolute-truth token counter sync (first message / cold start) ──
          // Use promptStats.totalTokens as ground truth when this prompt had to (re)process the whole history.
          // isColdStart covers switched-session reloads; isFirstPrompt covers brand-new sessions.
          if (!isReprocessing && promptStats.totalTokens !== undefined) {
            const isCold = !!promptStats.isColdStart;
            const priorMsgs = sessionMessagesRef.current[sessionId] ?? [];
            const userCount = priorMsgs.filter((m) => m.role === 'user').length;
            const isFirstPromptInSession = userCount <= 1;
            if (isCold || isFirstPromptInSession) {
              const abs = promptStats.totalTokens;
              if (isActive) {
                setUsedTokens(abs);
                // Reset TPS baselines to the absolute point so prompt delta doesn't spike the gauge
                lastTokenSnapshot.current = { tokens: abs, time: Date.now() };
                generationBaselineTokens.current = abs;
                tokenTimestampsRef.current[sessionId] = [];
                tokenCharsRef.current[sessionId] = { chars: 0, tokens: 0 };
                tokenTpsRef.current[sessionId] = 0;
                setTps(0);
              } else {
                // Inactive session: clean its per-session TPS window so it doesn't carry stale state when it becomes active
                tokenTimestampsRef.current[sessionId] = [];
                tokenCharsRef.current[sessionId] = { chars: 0, tokens: 0 };
                tokenTpsRef.current[sessionId] = 0;
              }
            } else {
              // Non-cold, non-first prompt: still reset TPS window so prompt delta doesn't count toward TPS
              // Keep lastTokenSnapshot aligned to abs without updating displayed usedTokens via absolute
              // (displayed usedTokens will be updated via normal chatContextUsage polling)
              tokenTimestampsRef.current[sessionId] = [];
              tokenCharsRef.current[sessionId] = { chars: 0, tokens: 0 };
              tokenTpsRef.current[sessionId] = 0;
              if (isActive && promptStats.totalTokens !== undefined) {
                // Re-anchor snapshot to abs to debias the next delta, but don't overwrite usedTokens
                lastTokenSnapshot.current = {
                  tokens: promptStats.totalTokens,
                  time: Date.now(),
                };
                generationBaselineTokens.current = promptStats.totalTokens;
              }
            }
          }
          if (isReprocessing) {
            isReprocessingRef.current[sessionId] = false;
            const ids =
              pendingSegmentIdsRef.current[sessionId]?.splice(0) ?? [];
            applyToSession(sessionId, isActive, (prev) => {
              const updated = [...prev];
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
              }
              return updated;
            });
          } else {
            applyToSession(sessionId, isActive, (prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === 'user' && !updated[i].promptStats) {
                  updated[i] = { ...updated[i], promptStats };
                  break;
                }
              }
              return updated;
            });
          }
          delete appliedProgressTruthRef.current[sessionId];
          return;
        }

        case 'function-calling': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          // Clear any stale tool typewriter state before starting new tool
          {
            const t = toolTypewriterTimersRef.current[sessionId];
            if (t) {
              clearInterval(t);
              delete toolTypewriterTimersRef.current[sessionId];
            }
            const pt = toolPrettyFlushTimersRef.current[sessionId];
            if (pt) {
              clearTimeout(pt);
              delete toolPrettyFlushTimersRef.current[sessionId];
            }
            delete toolTypewriterQueuesRef.current[sessionId];
            delete toolTypewriterCarryRef.current[sessionId];
          }
          applyToSession(sessionId, isActive, (prev) => {
            const updatedMessages = [...prev];
            const lastMessage = updatedMessages[updatedMessages.length - 1];

            const segId = (payload as any).id ?? crypto.randomUUID();
            pendingSegmentIdsRef.current[sessionId] = [
              ...(pendingSegmentIdsRef.current[sessionId] ?? []),
              segId,
            ];

            const toolSegment: MessageSegment = {
              id: segId,
              text: '',
              type: 'tool',
              toolName: payload.name,
              toolStatus: 'calling',
            };

            if (lastMessage?.role === 'assistant') {
              updatedMessages[updatedMessages.length - 1] = {
                ...lastMessage,
                content: [...lastMessage.content, toolSegment],
              };
            } else {
              const counters = messageCountersRef.current;
              const id = counters[sessionId] ?? 0;
              counters[sessionId] = id + 1;
              const assistantMessage: Message = {
                id,
                role: 'assistant',
                content: [toolSegment],
              };
              updatedMessages.push(assistantMessage);
            }

            toolSegmentQueuesRef.current[sessionId] = [
              ...(toolSegmentQueuesRef.current[sessionId] ?? []),
              toolSegment.id,
            ];
            // Do not show Processing prompt during live streaming – bar stays hidden until function-call
            streamingToolsRef.current[sessionId] = {
              name: payload.name ?? 'tool',
              text: '',
            };
            if (isActive)
              setStreamingTool(streamingToolsRef.current[sessionId]);
            return updatedMessages;
          });
          return;
        }

        case 'function-call': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          // Ensure tool typewriter fully drained and timers cleared before hiding stream
          {
            const t = toolTypewriterTimersRef.current[sessionId];
            if (t) {
              clearInterval(t);
              delete toolTypewriterTimersRef.current[sessionId];
            }
            const pt = toolPrettyFlushTimersRef.current[sessionId];
            if (pt) {
              clearTimeout(pt);
              delete toolPrettyFlushTimersRef.current[sessionId];
            }
            delete toolTypewriterQueuesRef.current[sessionId];
            delete toolTypewriterCarryRef.current[sessionId];
          }
          streamingToolsRef.current[sessionId] = null;
          if (isActive) setStreamingTool(null);
          // Start Executing bar – hidden until function-call, now show with batch names (unique)
          if (!executingRef.current[sessionId]) {
            const queueIds = toolSegmentQueuesRef.current[sessionId] ?? [];
            const msgs = sessionMessagesRef.current[sessionId] ?? [];
            const allSegments = msgs.flatMap((m) => m.content);
            const rawNames = queueIds
              .map((id) => allSegments.find((s) => s.id === id)?.toolName ?? '')
              .filter(Boolean) as string[];
            const fallback = payload.name ?? rawNames[0] ?? 'tool';
            const resolvedAll =
              rawNames.length > 0
                ? rawNames.map((n) => getToolMeta(n)?.label ?? n)
                : [getToolMeta(fallback)?.label ?? fallback];
            const uniqueNames = [...new Set(resolvedAll)];
            const entry = {
              names: uniqueNames,
              completed: 0,
              total: queueIds.length > 0 ? queueIds.length : resolvedAll.length,
            };
            executingRef.current[sessionId] = entry;
            setExecutingSessions((prev) => ({ ...prev, [sessionId]: entry }));
          }
          applyToSession(sessionId, isActive, (prev) => {
            const updatedMessages = [...prev];
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            const queue = toolSegmentQueuesRef.current[sessionId] ?? [];
            const targetId = (payload as any).id ?? queue[0];

            if (lastMessage?.role === 'assistant' && targetId) {
              updatedMessages[updatedMessages.length - 1] = {
                ...lastMessage,
                content: lastMessage.content.map((seg) =>
                  seg.id === targetId && seg.type === 'tool'
                    ? { ...seg, toolParams: payload.params }
                    : seg,
                ),
              };
            }

            return updatedMessages;
          });
          return;
        }

        case 'function-result': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          isReprocessingRef.current[sessionId] = true;
          const tags = payload.tags ?? [];
          /* eslint-disable no-underscore-dangle */
          if (tags.includes('sources')) {
            addSourcesFromToolResult(
              sessionId,
              payload._sources,
              tags.includes('top_source') ? payload._top_sources : undefined,
            );
          }
          /* eslint-enable no-underscore-dangle */
          /* eslint-disable no-underscore-dangle */
          const image = payload._image;
          /* eslint-enable no-underscore-dangle */
          applyToSession(sessionId, isActive, (prev) => {
            const updatedMessages = [...prev];
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            const queue = toolSegmentQueuesRef.current[sessionId] ?? [];
            const targetId = (payload as any).id ?? queue[0];

            if (lastMessage?.role === 'assistant' && targetId) {
              const { result } = payload;
              updatedMessages[updatedMessages.length - 1] = {
                ...lastMessage,
                content: lastMessage.content.map((seg) => {
                  if (seg.id === targetId && seg.type === 'tool') {
                    const updatedSeg: MessageSegment = {
                      ...seg,
                      toolStatus: 'done',
                      toolResult: result,
                    };
                    /* eslint-disable no-underscore-dangle */
                    if (image) {
                      updatedSeg.displayedImage = {
                        url: image.url,
                        altText: image.altText,
                      };
                    }
                    /* eslint-enable no-underscore-dangle */
                    return updatedSeg;
                  }
                  return seg;
                }),
              };
            }

            if (targetId) {
              toolSegmentQueuesRef.current[sessionId] = queue.filter(
                (id) => id !== targetId,
              );
            } else {
              toolSegmentQueuesRef.current[sessionId] = queue.slice(1);
            }
            return updatedMessages;
          });
          // Update Executing (completed/total) – hide bar after last tool, then show reprocessing
          {
            const prevExec = executingRef.current[sessionId];
            if (prevExec) {
              const newCompleted = prevExec.completed + 1;
              if (newCompleted >= prevExec.total) {
                executingRef.current[sessionId] = null;
                setExecutingSessions((prev) => {
                  const next = { ...prev };
                  delete next[sessionId];
                  return next;
                });
                // All tools finished – start reprocessing bar (LLM re-runs)
                progressRef.current[sessionId] = 0;
                if (isActive) setProgressPercent(0);
                setSessionProcessing(true);
              } else {
                const updated = { ...prevExec, completed: newCompleted };
                executingRef.current[sessionId] = updated;
                setExecutingSessions((prev) => ({
                  ...prev,
                  [sessionId]: updated,
                }));
              }
            } else {
              // Fallback: if Executing was not set (e.g., missed function-call), try to infer single tool
              const fallbackQueue =
                toolSegmentQueuesRef.current[sessionId] ?? [];
              // No further action – will be cleared at done
            }
          }
          return;
        }

        case 'user-input': {
          if (payload.request) {
            setUserInputRequest({ sessionId, ...payload.request });
          }
          return;
        }

        case 'user-input-resolved': {
          setUserInputRequest((prev) =>
            prev?.sessionId === sessionId ? null : prev,
          );
          return;
        }

        case 'done': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          pendingSegmentIdsRef.current[sessionId] = [];
          toolSegmentQueuesRef.current[sessionId] = [];
          setSessionLoading(false);
          setSessionProcessing(false);
          delete executingRef.current[sessionId];
          setExecutingSessions((prev) => {
            if (!(sessionId in prev)) return prev;
            const next = { ...prev };
            delete next[sessionId];
            return next;
          });
          // clear TPS tracking for session
          delete tokenTimestampsRef.current[sessionId];
          delete tokenTpsRef.current[sessionId];
          // keep chars/tokens for potential next round? reset
          delete tokenCharsRef.current[sessionId];
          const timer = typewriterTimersRef.current[sessionId];
          if (timer) {
            clearInterval(timer);
            delete typewriterTimersRef.current[sessionId];
          }
          delete typewriterCarryRef.current[sessionId];
          delete typewriterQueuesRef.current[sessionId];
          {
            const tt = toolTypewriterTimersRef.current[sessionId];
            if (tt) {
              clearInterval(tt);
              delete toolTypewriterTimersRef.current[sessionId];
            }
            const pt = toolPrettyFlushTimersRef.current[sessionId];
            if (pt) {
              clearTimeout(pt);
              delete toolPrettyFlushTimersRef.current[sessionId];
            }
            delete toolTypewriterQueuesRef.current[sessionId];
            delete toolTypewriterCarryRef.current[sessionId];
          }
          queueSessionSync(sessionId);
          if (isActive) {
            setTps(0);
            setProgressPercent(0);
            generationBaselineTokens.current = null;
            lastTokenSnapshot.current = null;
          }
          delete appliedProgressTruthRef.current[sessionId];
          refreshCumulativeTokens();
          return;
        }

        case 'error': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          clearTypewriterSession(sessionId);
          setSessionLoading(false);
          setSessionProcessing(false);
          showErrorToast(payload.message ?? 'Unknown error');
          return;
        }

        case 'slot-unavailable': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          clearTypewriterSession(sessionId);
          setSessionLoading(false);
          setSessionProcessing(false);
          showSlotBanner();
          return;
        }

        case 'session-changed': {
          flushTokenBuffer();
          flushTypewriterFor(sessionId, true);
          flushToolTypewriterFor(sessionId, true);
          setStreamingSessions((prev) => {
            const next = new Set(prev);
            if (payload.streaming) next.add(sessionId);
            else next.delete(sessionId);
            return next;
          });
          queueSessionSync(sessionId);
          break;
        }

        default:
          break;
      }
    });

    return () => {
      if (tokenFlushTimerRef.current) {
        clearTimeout(tokenFlushTimerRef.current);
        tokenFlushTimerRef.current = null;
      }
      Object.values(typewriterTimersRef.current).forEach((t) =>
        clearInterval(t),
      );
      typewriterTimersRef.current = {};
      Object.values(toolTypewriterTimersRef.current).forEach((t) =>
        clearInterval(t),
      );
      toolTypewriterTimersRef.current = {};
      Object.values(toolPrettyFlushTimersRef.current).forEach((t) =>
        clearTimeout(t),
      );
      toolPrettyFlushTimersRef.current = {};
      unsubscribe();
    };
  }, [
    refreshCumulativeTokens,
    addSourcesFromToolResult,
    queueSessionSync,
    showSlotBanner,
    showErrorToast,
    drainTypewriterQueue,
    drainToolTypewriterQueue,
    clearTypewriterSession,
    getEffectiveCPS,
  ]);

  useEffect(() => {
    const removeSystemProgressListener =
      window.electronAPI.onChatSystemProgress((data) => {
        setSystemPhase('preloading');
        setSystemStatusMessage('Preloading system prompt…');
        setSystemProgress(data.progress);
      });

    const removeSystemStatusListener = window.electronAPI.onChatSystemStatus(
      (data) => {
        setSystemPhase(
          data.phase as 'solving' | 'starting' | 'preloading' | 'ready',
        );
        setSystemStatusMessage(data.message);
      },
    );

    const removeSystemDoneListener = window.electronAPI.onChatSystemDone(
      (data) => {
        setSystemPhase('ready');
        setSystemProgress(0);
        setSystemPromptDone({
          stats: data.stats,
          toolCount: data.toolCount,
        });
      },
    );

    return () => {
      removeSystemProgressListener();
      removeSystemStatusListener();
      removeSystemDoneListener();
    };
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isAtBottom =
      Math.abs(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      ) < 40;

    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({
        behavior: loading || processing ? 'auto' : 'smooth',
      });
    }
  }, [messages, loading, processing]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    handleScroll();
  }, [handleScroll, messages]);

  // ── Search keyboard shortcuts (Ctrl/Cmd+F to open, Esc to close) ─────────
  useEffect(() => {
    // eslint-disable-next-line no-undef
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      const code = (e as any).code as string | undefined;
      const isFind =
        (e.ctrlKey || e.metaKey) &&
        (key === 'f' || code === 'KeyF' || (e as any).keyCode === 70);
      if (isFind) {
        // Chat is mounted at '/' (index) and historically '/chat'
        if (location.pathname !== '/' && location.pathname !== '/chat') return;
        e.preventDefault();
        (e as any).stopPropagation?.();
        setIsSearchOpen(true);
        // If already open, re-focus input
        setTimeout(() => {
          const inp = document.querySelector<HTMLInputElement>(
            '.chat-search-bar__input',
          );
          if (inp) {
            inp.focus();
            inp.select();
          }
        }, 30);
        return;
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };
    // Capture phase to precede any inner handlers; listen on both window & document
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isSearchOpen, location.pathname]);

  useEffect(() => {
    if (isQueued) {
      setPlaceholder('Queued — starting server…');
    } else if (
      !isServerOnline &&
      !modelLoading &&
      !loadError &&
      selectedProfileId
    ) {
      setPlaceholder('Server offline — press Power to start');
    } else if (modelLoading) setPlaceholder('Loading profile...');
    else if (loadError) setPlaceholder('Profile failed to load');
    else if (selectedProfileId)
      setPlaceholder('Send a message... (Shift+Enter for new line)');
    else setPlaceholder('Select a profile first...');
  }, [modelLoading, selectedProfileId, loadError, isServerOnline, isQueued]);

  const autoResize = (e: FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types?.includes('Files')) {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        if (!showImageModal) {
          dragOpenedModal.current = true;
          setShowImageModal(true);
        }
        setPageDragging(true);
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types?.includes('Files')) {
      e.preventDefault();
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (dragOpenedModal.current) {
        dragOpenedModal.current = false;
        setShowImageModal(false);
      }
      setPageDragging(false);
    }
  };

  const convertDocumentToPending = useCallback(
    (id: string, filePath: string, filename: string) => {
      const setStatus = (status: 'waiting' | 'converting') =>
        setPendingMedia((prev) =>
          prev.some((m) => m.id === id)
            ? prev.map((m) =>
                m.id === id && m.type === 'document' ? { ...m, status } : m,
              )
            : prev,
        );
      const convert = async () => {
        try {
          const result = await withConversionSlot(
            () => window.electronAPI.convertFileWithMarkitdown(filePath),
            () => setStatus('converting'),
          );
          if (result.success && result.markdown) {
            setPendingMedia((prev) =>
              prev.some((m) => m.id === id)
                ? prev.map((m) =>
                    m.id === id && m.type === 'document'
                      ? {
                          ...m,
                          content: result.markdown ?? '',
                          status: undefined,
                        }
                      : m,
                  )
                : prev,
            );
          } else {
            setPendingMedia((prev) => prev.filter((m) => m.id !== id));
            showErrorToast(
              `Failed to convert ${filename}: ${result.error || 'Unknown error'}`,
            );
          }
        } catch (err: any) {
          setPendingMedia((prev) => prev.filter((m) => m.id !== id));
          showErrorToast(`Error converting ${filename}: ${err.message}`);
        }
      };
      convert();
    },
    [showErrorToast],
  );

  const processDroppedDocument = (filePath: string, filename: string) => {
    const id = crypto.randomUUID();
    setPendingMedia((prev) => [
      ...prev,
      {
        id,
        type: 'document',
        name: filename,
        content: '',
        status: 'waiting',
      },
    ]);
    convertDocumentToPending(id, filePath, filename);
  };

  const ingestFile = (file: File) => {
    const ext = getExtension(file.name);
    const isImage =
      IMAGE_EXTENSIONS_SET.has(ext) || file.type.startsWith('image/');
    const isVideo =
      VIDEO_EXTENSIONS_SET.has(ext) || file.type.startsWith('video/');
    const isDoc = DOC_EXTENSIONS_SET.has(ext);
    if ((isImage || isVideo) && !canAttachImages) {
      showErrorToast(
        `${file.name} needs a loaded vision projector to be attached`,
      );
    } else if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result;
        if (typeof result === 'string') {
          const id = crypto.randomUUID();
          setPendingMedia((prev) => [
            ...prev,
            { id, type: 'image', dataUrl: result, name: file.name },
          ]);
        }
      };
      reader.readAsDataURL(file);
    } else if (isVideo) {
      const id = crypto.randomUUID();
      setPendingMedia((prev) => [
        ...prev,
        {
          id,
          type: 'video',
          file,
          objectUrl: URL.createObjectURL(file),
        },
      ]);
    } else if (isDoc) {
      const filePath = (file as any).path;
      if (filePath) {
        processDroppedDocument(filePath, file.name);
      } else {
        const id = crypto.randomUUID();
        setPendingMedia((prev) => [
          ...prev,
          {
            id,
            type: 'document',
            name: file.name,
            content: '',
            status: 'waiting',
          },
        ]);
        (async () => {
          try {
            const reader = new FileReader();
            const result = await new Promise<ArrayBuffer>((resolve, reject) => {
              reader.onload = (ev) => resolve(ev.target!.result as ArrayBuffer);
              reader.onerror = () => reject(new Error('Failed to read file'));
              reader.readAsArrayBuffer(file);
            });
            const tempPath = await window.electronAPI.saveBufferToTemp(
              new Uint8Array(result),
              file.name,
            );
            convertDocumentToPending(id, tempPath, file.name);
          } catch (err: any) {
            setPendingMedia((prev) => prev.filter((m) => m.id !== id));
            showErrorToast(`Error reading ${file.name}: ${err.message}`);
          }
        })();
      }
    } else {
      showErrorToast(`${file.name} is unsupported`);
    }
  };

  const collectClipboardFiles = (dt: DataTransfer | null): File[] => {
    if (!dt) return [];
    const files = Array.from(dt.files).filter(Boolean);
    if (files.length > 0) return files;
    const fromItems: File[] = [];
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) fromItems.push(f);
      }
    }
    return fromItems;
  };

  const withPastedName = (file: File): File => {
    const ext = getExtension(file.name);
    if (
      file.name &&
      (IMAGE_EXTENSIONS_SET.has(ext) ||
        VIDEO_EXTENSIONS_SET.has(ext) ||
        DOC_EXTENSIONS_SET.has(ext))
    ) {
      return file;
    }
    if (file.type.startsWith('image/')) {
      pastedNameCounter += 1;
      const imageExt = file.type.split('/')[1] || 'png';
      return new File([file], `pasted-image-${pastedNameCounter}.${imageExt}`, {
        type: file.type,
      });
    }
    if (file.type.startsWith('video/')) {
      pastedNameCounter += 1;
      const subtype = file.type.split('/')[1] || 'mp4';
      const videoExt = MIME_TO_VIDEO_EXT[subtype] ?? subtype;
      return new File([file], `pasted-video-${pastedNameCounter}.${videoExt}`, {
        type: file.type,
      });
    }
    return file;
  };

  const handleInputPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = collectClipboardFiles(e.clipboardData).map(withPastedName);
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) {
      ingestFile(file);
    }
  };

  const handlePageDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragOpenedModal.current = false;
    setPageDragging(false);
    setShowImageModal(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      ingestFile(file);
    }
  };

  const handleSend = async () => {
    const text = inputText.trim();
    const hasContent = !!text || pendingMedia.length > 0;
    // Offline → queue via Enter (Power stays start-only). Text stays until drained.
    if (!isServerOnline) {
      if (!selectedProfileId) return;
      if (
        pendingMedia.some(
          (m) =>
            m.type === 'document' &&
            (m.status === 'waiting' || m.status === 'converting'),
        )
      )
        return;
      if (pendingQueuedRef.current) return;
      if (!hasContent) {
        // Empty chatbox: same as Power button — start server without queuing
        handleToggleServer();
        return;
      }
      if (loadError) return;
      pendingQueuedRef.current = true;
      setIsQueued(true);
      // Start server without switching session
      manualStartRequestedRef.current = true;
      preserveSessionOnNextLoadRef.current = true;
      setIsServerOnline(true);
      setLoadError(null);
      const qid = selectedProfileId;
      setSelectedProfileId('');
      setTimeout(() => setSelectedProfileId(qid), 30);
      return;
    }
    if (
      !text ||
      loading ||
      sendingRef.current ||
      modelLoading ||
      persistentModelLoading ||
      !selectedProfileId ||
      loadError ||
      systemPhase !== 'ready' ||
      pendingMedia.some(
        (m) =>
          m.type === 'document' &&
          (m.status === 'waiting' || m.status === 'converting'),
      )
    )
      return;
    sendingRef.current = true;
    setSendingState(true);
    try {
      const contentParts: ContentPart[] = [];
      const mediaItems: MediaDisplayItem[] = [];
      let videoExtractError: string | null = null;

      for (const item of pendingMedia) {
        if (item.type === 'image') {
          if (item.name)
            contentParts.push({ kind: 'text', text: `[${item.name}]` });
          contentParts.push({ kind: 'image_url', url: item.dataUrl });
          mediaItems.push({ type: 'image', url: item.dataUrl });
        } else if (item.type === 'video') {
          contentParts.push({ kind: 'text', text: `[${item.file.name}]` });
          const vs = selectedProfile?.videoSettings;
          try {
            const result = await extractVideoFrames(
              item.file,
              vs?.fps,
              vs?.unlimitedMaxFrames ? undefined : (vs?.maxFrames ?? 15),
              vs?.quality,
              vs?.maxWidth,
            );
            if (!result.frames || result.frames.length === 0) {
              throw new Error('Could not extract any frames from this video');
            }
            result.frames.forEach((frame, i) => {
              contentParts.push({ kind: 'image_url', url: frame });
              const secs = i / result.fps;
              const mins = Math.floor(secs / 60);
              const secsOnly = Math.floor(secs % 60);
              contentParts.push({
                kind: 'text',
                text: `[${String(mins).padStart(2, '0')}:${String(secsOnly).padStart(2, '0')}]`,
              });
            });
            mediaItems.push({ type: 'video', url: item.objectUrl });
          } catch (err: any) {
            videoExtractError = err.message;
            URL.revokeObjectURL(item.objectUrl);
            break;
          }
        } else if (item.type === 'document') {
          contentParts.push({
            kind: 'text',
            text: `[${item.name}]\n${item.content}`,
          });
          mediaItems.push({ type: 'document', name: item.name });
        }
      }

      if (videoExtractError) {
        setPendingMedia([]);
        showErrorToast(`Failed to process video: ${videoExtractError}`);
        return;
      }

      // Ensure a session exists (lazily created on first message).
      let sessionId = activeSessionIdRef.current;
      if (!sessionId) {
        sessionId = await window.electronAPI.chatStartSession(
          selectedProfileId,
          text.slice(0, 40) || 'Untitled session',
        );
        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
      }

      setPendingMedia([]);

      setLoadingSessions((prev) => ({ ...prev, [sessionId]: true }));
      setProcessingSessions((prev) => ({ ...prev, [sessionId]: true }));
      progressRef.current[sessionId] = 0;
      if (sessionId === activeSessionIdRef.current) setProgressPercent(0);
      setStreamingTool(null);
      delete executingRef.current[sessionId];
      setExecutingSessions((prev) => {
        if (!(sessionId in prev)) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      const counters = messageCountersRef.current;
      const uid = counters[sessionId] ?? 0;
      counters[sessionId] = uid + 1;
      const segCounters = segmentCountersRef.current;
      segCounters[sessionId] = (segCounters[sessionId] ?? 0) + 1;

      const userMessage: Message = {
        id: uid,
        role: 'user',
        content: [
          {
            id: `seg-${Date.now()}-${segCounters[sessionId]}`,
            text,
            type: 'normal',
            mediaItems,
          },
        ],
      };
      const shouldCollapseUser =
        text.length >= 20 && text.split('\n').length > 5;

      setMessages((prev) => {
        const updated = [...prev];
        if (systemPromptDone && !updated.some((m) => m.role === 'system')) {
          const sysId = counters[sessionId] ?? 0;
          counters[sessionId] = (counters[sessionId] ?? 0) + 1;
          updated.push({
            id: sysId,
            role: 'system',
            content: [
              {
                id: `seg-sys-${Date.now()}`,
                text:
                  systemPromptDone.toolCount > 0
                    ? `System Prompt with ${systemPromptDone.toolCount} tools`
                    : 'System Prompt',
                type: 'normal',
              },
            ],
            promptStats: systemPromptDone.stats,
          });
        }
        updated.push(userMessage);
        sessionMessagesRef.current[sessionId] = updated;
        return updated;
      });
      if (shouldCollapseUser) {
        const sid = sessionId;
        if (!collapsedBySessionRef.current[sid])
          collapsedBySessionRef.current[sid] = new Set();
        if (!seenIdsRef.current[sid]) seenIdsRef.current[sid] = new Set();
        collapsedBySessionRef.current[sid].add(uid);
        seenIdsRef.current[sid].add(uid);
        if (sid === activeSessionIdRef.current) {
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            next.add(uid);
            return next;
          });
        }
      } else {
        // mark as seen so effect doesn't re-evaluate as initially collapsed
        const sid = sessionId;
        if (!seenIdsRef.current[sid]) seenIdsRef.current[sid] = new Set();
        seenIdsRef.current[sid].add(uid);
      }
      setInputText('');

      const textarea = document.querySelector('textarea');
      if (textarea) textarea.style.height = 'auto';

      generationBaselineTokens.current = null;
      lastTokenSnapshot.current = null;
      setTps(0);

      await window.electronAPI.chatSend(
        sessionId,
        text,
        contentParts,
        mediaItems,
        readThinkingTokens(selectedProfileId),
      );
    } finally {
      sendingRef.current = false;
      setSendingState(false);
    }
  };

  const handleAbort = () =>
    window.electronAPI.chatAbort(activeSessionIdRef.current);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Drain queued Enter send once server becomes ready
  useEffect(() => {
    if (!pendingQueuedRef.current) return;
    if (loadError) return; // cleared by loadError effect above
    if (
      isServerOnline &&
      !modelLoading &&
      !persistentModelLoading &&
      systemPhase === 'ready' &&
      !loadError
    ) {
      pendingQueuedRef.current = false;
      setIsQueued(false);
      // Defer to next tick so state settles and handleSend sees ready state
      setTimeout(() => {
        handleSend();
      }, 30);
    }
  }, [
    isServerOnline,
    modelLoading,
    persistentModelLoading,
    systemPhase,
    loadError,
    isQueued,
    handleSend,
  ]);

  const handleProfileChange = async (newProfileId: string) => {
    if (newProfileId === selectedProfileId) return;

    if (loadAbortController.current) {
      loadAbortController.current.cancelled = true;
    }

    clearAllTypewriterSessions();
    setLoadError(null);
    pendingQueuedRef.current = false;
    setIsQueued(false);

    if (messages.length > 0) {
      setPendingProfileId(newProfileId);
      setShowConfirmDialog(true);
      return;
    }

    if (persistentLoadedProfileId || modelLoading) {
      persistentModelLoading = false;
      setModelLoading(false);
      await unloadModel();
    }

    setSelectedProfileId(newProfileId);
  };

  const handleRetry = async () => {
    setLoadError(null);
    manualStartRequestedRef.current = true;
    preserveSessionOnNextLoadRef.current = true;
    setIsServerOnline(true);

    if (persistentLoadedProfileId) {
      await unloadModel();
    }

    const tempId = selectedProfileId;
    setSelectedProfileId('');
    setTimeout(() => {
      setSelectedProfileId(tempId);
    }, 100);
  };

  const handleRestoreSession = useCallback(
    async (sessionId: string) => {
      if (modelLoading || loadError) return;
      const view = await window.electronAPI.chatGetSession(sessionId);
      if (!view) return;

      // Flush any pending typewriter chars for current session before switching
      if (activeSessionIdRef.current) {
        const prevId = activeSessionIdRef.current;
        if (typewriterQueuesRef.current[prevId]?.length) {
          drainTypewriterQueue(prevId, true);
        }
        if (toolTypewriterQueuesRef.current[prevId]?.length) {
          drainToolTypewriterQueue(prevId, true);
          const pt = toolPrettyFlushTimersRef.current[prevId];
          if (pt) {
            clearTimeout(pt);
            delete toolPrettyFlushTimersRef.current[prevId];
          }
          const cur = streamingToolsRef.current[prevId];
          if (cur) {
            // Ensure pretty state is flushed before leaving
            // (streamingTool for prev session won't be visible after switch,
            // but ref stays for when we return)
          }
        }
        sessionMessagesRef.current[prevId] = messagesRef.current;
      }

      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      const restored = view.session.messages;
      sessionMessagesRef.current[sessionId] = restored;
      messageCountersRef.current[sessionId] = restored.reduce(
        (max, m) => Math.max(max, m.id + 1),
        0,
      );
      setMessages(restored);
      // Sync streaming tool – prefer typewriter ref if we have pending queue (faster than main's batched view)
      if (toolTypewriterQueuesRef.current[sessionId]?.length) {
        // Keep existing ref and ensure timer continues; also ensure pretty flush scheduled
        const cur = streamingToolsRef.current[sessionId];
        if (cur) setStreamingTool({ ...cur });
        else setStreamingTool(view.streamingTool);
      } else {
        streamingToolsRef.current[sessionId] = view.streamingTool;
        setStreamingTool(view.streamingTool);
        // Clear any stale tool queue for this session when switching to idle
        if (!view.streamingTool) {
          const t = toolTypewriterTimersRef.current[sessionId];
          if (t) {
            clearInterval(t);
            delete toolTypewriterTimersRef.current[sessionId];
          }
          const pt = toolPrettyFlushTimersRef.current[sessionId];
          if (pt) {
            clearTimeout(pt);
            delete toolPrettyFlushTimersRef.current[sessionId];
          }
          delete toolTypewriterQueuesRef.current[sessionId];
          delete toolTypewriterCarryRef.current[sessionId];
        }
      }
      setProgressPercent(view.progress);
      setLoadingSessions((prev) => ({
        ...prev,
        [sessionId]: view.status !== 'idle',
      }));
      setProcessingSessions((prev) => ({ ...prev, [sessionId]: false }));
      setSources(sessionId, view.session.sources ?? []);
      // collapsed state is handled by effects (per-session)
    },
    [
      modelLoading,
      loadError,
      setSources,
      drainTypewriterQueue,
      drainToolTypewriterQueue,
    ],
  );

  const handleNewChat = useCallback(async () => {
    if (activeSessionIdRef.current) {
      sessionMessagesRef.current[activeSessionIdRef.current] =
        messagesRef.current;
    }
    clearAllTypewriterSessions();
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setCollapsedIds(new Set());
    clearAllSources();
    setStreamingTool(null);
    setProgressPercent(0);
    setUsedTokens(0);
    systemMessageInsertedRef.current = false;
    setSystemPromptDone(null);
    setSystemPhase('ready');
    pendingMedia.forEach((m) => {
      if (m.type === 'video') URL.revokeObjectURL(m.objectUrl);
    });
    setPendingMedia([]);
  }, [pendingMedia, clearAllSources, clearAllTypewriterSessions]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      window.electronAPI.chatDeleteSession(id).catch(() => {});
      clearTypewriterSession(id);
      removeSessionSources(id);
      delete collapsedBySessionRef.current[id];
      delete seenIdsRef.current[id];
      delete sessionMessagesRef.current[id];
      if (activeSessionIdRef.current === id) {
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
        setMessages([]);
        setCollapsedIds(new Set());
      }
    },
    [removeSessionSources, clearTypewriterSession],
  );

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  const tokenRatio = maxTokens !== null ? usedTokens / maxTokens : 0;
  let tokenCounterClass = 'chat-token-counter';
  if (tokenRatio >= 0.9) tokenCounterClass += ' chat-token-counter--danger';
  else if (tokenRatio >= 0.75)
    tokenCounterClass += ' chat-token-counter--warning';

  const activeBackendId = settings?.selectedBackend ?? '';
  const selectedBackendOption = backendOptions.find(
    (opt) => opt.id === activeBackendId,
  );
  let backendDisplay = 'Default';
  if (selectedBackendOption) {
    backendDisplay =
      selectedBackendOption.label.includes('\\') ||
      selectedBackendOption.label.includes('/')
        ? selectedBackendOption.label.split(/[\\/]/).pop() ||
          selectedBackendOption.label
        : selectedBackendOption.label;
  } else if (backend) {
    backendDisplay =
      backend.includes('\\') || backend.includes('/')
        ? backend.split(/[\\/]/).pop() || backend
        : formatBackend(backend);
  }

  const isOpenvinoBackend = [
    selectedBackendOption?.id,
    selectedBackendOption?.folder,
    selectedBackendOption?.label,
    backend,
  ].some((s) => s && /openvino/i.test(s));

  const ovDevice = settings?.openvinoDevice || 'CPU';
  const ovStateful = settings?.openvinoStateful ?? false;
  const ovStateForcedOff = ovDevice === 'NPU';

  const pendingProfile = profiles.find((p) => p.id === pendingProfileId);

  return (
    <div
      className="chat-page-shell"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handlePageDrop}
      onClick={isSourcesOpen ? closeSources : undefined}
    >
      <SessionsSidebar
        profileId={selectedProfileId}
        profileName={selectedProfile?.name ?? ''}
        activeSessionId={activeSessionId}
        collapsed={sidebarCollapsed}
        streamingSessionIds={streamingSessions}
        onToggle={toggleSidebarCollapsed}
        onOpen={handleRestoreSession}
        onNewChat={handleNewChat}
        onDelete={handleDeleteSession}
      />

      <div className="chat-page">
        <div className="chat-model-selector">
          <Bot
            size={18}
            style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
          />
          <InfoTooltip
            content="Select Profile"
            hideIcon
            className="info-tooltip-wrapper--chat-profile-select"
          >
            <button
              type="button"
              className="chat-model-selector__button"
              onClick={() => setShowProfileModal(true)}
              disabled={profiles.length === 0}
            >
              <span className="chat-model-selector__button-text">
                {selectedProfileId
                  ? profiles.find((p) => p.id === selectedProfileId)?.name
                  : profiles.length === 0
                    ? 'No profiles available'
                    : 'Select a profile...'}
              </span>
              <ChevronDown size={16} className="chat-model-selector__chevron" />
            </button>
          </InfoTooltip>

          {modelLoading && !loadError && (
            <span className="chat-model-loading-label">Loading...</span>
          )}
          {loadError && <span className="chat-model-error-label">Error</span>}

          <InfoTooltip content="Manage Profiles" hideIcon>
            <button
              type="button"
              className="chat-system-prompt-button"
              onClick={() => navigate('/profiles')}
            >
              <SlidersHorizontal size={18} />
            </button>
          </InfoTooltip>
        </div>

        {showSourcesButton && (
          <InfoTooltip
            content="Sources"
            hideIcon
            className="info-tooltip-wrapper--chat-sources"
          >
            <button
              type="button"
              className={`chat-sources-button${isSourcesOpen ? ' chat-sources-button--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleSources();
              }}
            >
              <SquareDashedText size={18} />
            </button>
          </InfoTooltip>
        )}

        <InfoTooltip
          content={isSearchOpen ? 'Close search (Esc)' : 'Search chat (Ctrl+F)'}
          hideIcon
          className={`info-tooltip-wrapper--chat-search${showSourcesButton ? ' info-tooltip-wrapper--chat-search--with-sources' : ''}`}
        >
          <button
            type="button"
            className={`chat-search-button${isSearchOpen ? ' chat-search-button--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsSearchOpen((v) => !v);
            }}
            aria-label={isSearchOpen ? 'Close search' : 'Search chat'}
            title={isSearchOpen ? 'Close search' : 'Search (Ctrl+F)'}
          >
            <Search size={18} />
          </button>
        </InfoTooltip>

        <InfoTooltip
          content="Sessions"
          hideIcon
          className="info-tooltip-wrapper--chat-sessions"
        >
          <button
            type="button"
            className="chat-sessions-button"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarCollapsed((v) => !v);
            }}
          >
            <MessagesSquare size={18} />
          </button>
        </InfoTooltip>
        <InfoTooltip
          content="New Session"
          hideIcon
          className="info-tooltip-wrapper--chat-sessions-new"
        >
          <button
            type="button"
            className="chat-sessions-button chat-sessions-button--new"
            onClick={(e) => {
              e.stopPropagation();
              handleNewChat();
            }}
          >
            <SquarePen size={18} />
          </button>
        </InfoTooltip>

        {userInputRequest && userInputRequest.sessionId === activeSessionId && (
          <UserInputModal
            type={userInputRequest.type}
            title={userInputRequest.title}
            prompt={userInputRequest.prompt}
            options={userInputRequest.options}
            toolName={userInputRequest.toolName}
            toolParams={userInputRequest.toolParams}
            onResponse={async (response) => {
              const { sessionId } = userInputRequest;
              setUserInputRequest(null);
              await window.electronAPI.chatRespondInput(sessionId, response);
            }}
          />
        )}

        {showConfirmDialog && (
          <ConfirmDialog
            title="Switch Profile?"
            message={`Switching to "${pendingProfile?.name ?? 'this profile'}" will clear your current conversation and reload the model. Do you want to continue?`}
            confirmText="Switch Profile"
            cancelText="Cancel"
            onConfirm={handleConfirmNewChat}
            onCancel={handleCancelNewChat}
          />
        )}

        {showProfileModal && (
          <ProfileSelectModal
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            onSelect={handleProfileChange}
            onClose={() => setShowProfileModal(false)}
          />
        )}

        {isSearchOpen && (
          <ChatSearchBar
            containerRef={messagesContainerRef}
            onClose={() => setIsSearchOpen(false)}
            messageCount={messages.length}
          />
        )}

        <div className="chat-messages-wrapper">
          <div className="chat-messages" ref={messagesContainerRef}>
            {loadError && (
              <div className="chat-error">
                <AlertCircle size={32} style={{ marginBottom: 4 }} />
                <span className="chat-error__title">
                  Failed to Load Profile
                </span>
                <span className="chat-error__message">
                  {(() => {
                    const lines = loadError.split('\n').filter(Boolean);
                    if (lines.length <= 1) return loadError;
                    return (
                      <>
                        {lines[0]}
                        <ul className="chat-error__log">
                          {lines.slice(1).map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      </>
                    );
                  })()}
                </span>
                <button
                  type="button"
                  className="chat-error__retry"
                  onClick={handleRetry}
                >
                  <RefreshCw size={16} />
                  Retry
                </button>
              </div>
            )}

            {messages.length === 0 && !loading && !loadError && (
              <div className="chat-empty-state">
                <SendHorizonal className="chat-empty-state-icon" size={44} />
                <h2>
                  {modelLoading ? 'Loading profile...' : 'Start a conversation'}
                </h2>
                <p>
                  {selectedProfileId
                    ? 'Type your message below.'
                    : 'Select a profile from the dropdown above, then type your message below.'}
                </p>
                {selectedProfile && (
                  <div className="chat-active-prompt-badge">
                    Active: {selectedProfile.name}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg) => (
              <MessageView
                key={msg.id}
                msg={msg}
                isLast={msg === messages[messages.length - 1]}
                profileName={selectedProfile?.name ?? ''}
                loading={loading}
                processing={processing}
                progressPercent={progressPercent}
                streamingTool={streamingTool}
                executing={executing}
                settings={settings}
                copiedMsgId={copiedMsgId}
                isCollapsed={collapsedIds.has(msg.id)}
                onToggleCollapsed={toggleMessageCollapsed}
                onCopy={copyMessageText}
                onImageClick={setImageViewerUrl}
              />
            ))}

            {loading &&
              (messages.length === 0 ||
                messages[messages.length - 1].role !== 'assistant') && (
                <div className="chat-message chat-message--assistant">
                  <div className="chat-message__label">Assistant</div>
                  <div className="chat-message__indicator-box">
                    <div className="chat-indicator">
                      <div className="chat-indicator__spinner" />
                      <span className="chat-indicator__label">
                        {executing
                          ? `Executing ${executing.names.join(', ')} (${executing.completed}/${executing.total})`
                          : processing
                            ? `Processing prompt… (${progressPercent}%)`
                            : 'Generating…'}
                      </span>
                    </div>
                    {processing && !executing && (
                      <div className="chat-progress-bar">
                        <div
                          className="chat-progress-bar__fill"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>
          {showScrollButton && messages.length > 0 && (
            <button
              type="button"
              className="chat-scroll-to-bottom"
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
            >
              <ArrowDown size={18} strokeWidth={2.2} />
            </button>
          )}
        </div>

        {systemPhase !== 'ready' && (
          <div className="chat-system-preload-bar">
            <div className="chat-indicator">
              <div className="chat-indicator__spinner" />
              <span className="chat-indicator__label">
                {systemPhase === 'preloading'
                  ? `Loading Profile… (${systemProgress}%)`
                  : systemStatusMessage}
              </span>
            </div>
            {systemPhase === 'preloading' && (
              <div className="chat-progress-bar">
                <div
                  className="chat-progress-bar__fill"
                  style={{ width: `${systemProgress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {projectorWarning && (
          <div
            className={`chat-projector-warning${projectorWarningClosing ? ' chat-projector-warning--closing' : ''}`}
            role="alert"
          >
            <AlertCircle size={15} className="chat-projector-warning__icon" />
            <span className="chat-projector-warning__text">
              The following tools could not be loaded:{' '}
              {projectorWarning.tools
                .map((name) => `"${getAllToolMetas()[name]?.label ?? name}"`)
                .join(', ')}
              <br />
              These tools require a vision model projector. Please add a
              projector to the profile to use them.
            </span>
            <button
              type="button"
              className="chat-projector-warning__close"
              onClick={hideProjectorWarning}
              aria-label="Dismiss warning"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {showSlotInfo && (
          <div className="chat-slot-info" role="status">
            <AlertCircle size={15} className="chat-slot-info__icon" />
            <span className="chat-slot-info__text">
              All generation slots are currently busy. Please wait for an
              ongoing generation to finish before starting a new chat.
            </span>
            <button
              type="button"
              className="chat-slot-info__close"
              onClick={hideSlotInfo}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="chat-input-wrapper">
          <div className="chat-input-row">
            <InfoTooltip
              content={
                canAttachImages
                  ? 'Attach images, videos, or documents'
                  : 'Attach documents'
              }
              hideIcon
              side="top"
            >
              <button
                type="button"
                className="chat-attach-button"
                onClick={() => setShowImageModal(true)}
              >
                {canAttachImages ? (
                  <ImagePlus size={18} />
                ) : (
                  <FilePlusCorner size={18} />
                )}
              </button>
            </InfoTooltip>

            <div className="chat-input-inner">
              {pendingMedia.length > 0 && (
                <div className="chat-media-preview">
                  {pendingMedia.map((item) => (
                    <div key={item.id} className="chat-media-preview__item">
                      {item.type === 'image' && (
                        <img
                          src={item.dataUrl}
                          alt="Attached"
                          className="chat-media-preview__image"
                        />
                      )}
                      {item.type === 'video' && (
                        <video
                          src={item.objectUrl}
                          controls
                          className="chat-media-preview__video"
                        />
                      )}
                      {item.type === 'document' && (
                        <div
                          className={`chat-media-preview__document${item.status ? ' chat-media-preview__document--pending' : ''}`}
                        >
                          {item.status ? (
                            <div className="chat-media-preview__spinner" />
                          ) : (
                            <FileText size={20} />
                          )}
                          <span className="chat-media-preview__doc-name">
                            {item.name}
                          </span>
                          {item.status && (
                            <span className="chat-media-preview__converting">
                              {item.status === 'waiting'
                                ? 'Waiting…'
                                : 'Converting…'}
                            </span>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className="chat-media-preview__remove"
                        onClick={() => {
                          if (item.type === 'video') {
                            URL.revokeObjectURL(item.objectUrl);
                          }
                          setPendingMedia((prev) =>
                            prev.filter((m) => m.id !== item.id),
                          );
                        }}
                        title={`Remove ${item.type}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={placeholder}
                rows={1}
                onInput={autoResize}
                onKeyDown={handleKeyDown}
                onPaste={handleInputPaste}
              />
            </div>

            {isQueued ? (
              <button
                type="button"
                className="chat-send-button chat-send-button--sending"
                disabled
                title="Queued — waiting for server…"
              >
                <div className="chat-send-button__spinner" />
              </button>
            ) : !isServerOnline && !loading ? (
              <button
                type="button"
                className="chat-send-button chat-send-button--power"
                onClick={handleToggleServer}
                disabled={serverToggling || !selectedProfileId}
                title={
                  selectedProfileId ? 'Start server' : 'Select a profile first'
                }
              >
                <Power size={16} strokeWidth={2.2} />
              </button>
            ) : loading ? (
              <button
                type="button"
                className="chat-send-button chat-send-button--stop"
                onClick={handleAbort}
                title="Stop generation"
              >
                <Square size={16} strokeWidth={2.2} />
              </button>
            ) : sending ? (
              <button
                type="button"
                className="chat-send-button chat-send-button--sending"
                disabled
                title="Sending…"
              >
                <div className="chat-send-button__spinner" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-button"
                disabled={
                  !inputText.trim() ||
                  !selectedProfileId ||
                  modelLoading ||
                  persistentModelLoading ||
                  !!loadError ||
                  !isServerOnline ||
                  pendingMedia.some(
                    (m) =>
                      m.type === 'document' &&
                      (m.status === 'waiting' || m.status === 'converting'),
                  )
                }
                onClick={handleSend}
                title="Send message"
              >
                <SendHorizonal size={16} strokeWidth={2.2} />
              </button>
            )}
          </div>

          <div className={tokenCounterClass}>
            <ThinkingDropdown
              profileId={selectedProfileId || null}
              onTokensChange={handleThinkingTokensChange}
            />
            <div className="chat-backend-group">
              <div className="chat-backend-select" ref={backendMenuRef}>
                <button
                  type="button"
                  className="chat-backend-indicator"
                  title="Select backend"
                  onClick={() => setBackendMenuOpen((v) => !v)}
                >
                  <Cpu size={12} strokeWidth={2.2} />
                  {backendDisplay || 'Default'}
                  <ChevronDown size={12} strokeWidth={2.2} />
                </button>
                {backendMenuOpen && (
                  <div className="chat-backend-menu" role="menu">
                    <div className="chat-backend-menu__header">Backend</div>
                    {backendOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitem"
                        className={`chat-backend-menu__item${
                          opt.id === activeBackendId
                            ? ' chat-backend-menu__item--active'
                            : ''
                        }`}
                        onClick={() => handleSelectBackend(opt.id)}
                      >
                        <span className="chat-backend-menu__label">
                          {opt.label.includes('\\') || opt.label.includes('/')
                            ? opt.label.split(/[\\/]/).pop()
                            : opt.label}
                        </span>
                        {opt.id === activeBackendId && (
                          <Check size={14} strokeWidth={2.2} />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isOpenvinoBackend && (
                <>
                  <div className="chat-backend-select" ref={deviceMenuRef}>
                    <button
                      type="button"
                      className="chat-backend-indicator"
                      title="Select OpenVINO device"
                      onClick={() => setDeviceMenuOpen((v) => !v)}
                    >
                      <Microchip size={12} strokeWidth={2.2} />
                      {ovDevice}
                      <ChevronDown size={12} strokeWidth={2.2} />
                    </button>
                    {deviceMenuOpen && (
                      <div className="chat-backend-menu" role="menu">
                        <div className="chat-backend-menu__header">Device</div>
                        {(['CPU', 'GPU', 'NPU'] as const).map((dev) => (
                          <button
                            key={dev}
                            type="button"
                            role="menuitem"
                            className={`chat-backend-menu__item${
                              dev === ovDevice
                                ? ' chat-backend-menu__item--active'
                                : ''
                            }`}
                            onClick={() => handleSelectOvDevice(dev)}
                          >
                            <span className="chat-backend-menu__label">
                              {dev}
                            </span>
                            {dev === ovDevice && (
                              <Check size={14} strokeWidth={2.2} />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    className={`chat-backend-select${
                      ovStateForcedOff ? ' chat-ov-select--disabled' : ''
                    }`}
                    ref={stateMenuRef}
                  >
                    <button
                      type="button"
                      className="chat-backend-indicator"
                      title={
                        ovStateForcedOff
                          ? 'NPU only supports stateless execution'
                          : 'Select OpenVINO execution mode'
                      }
                      disabled={ovStateForcedOff}
                      onClick={() => setStateMenuOpen((v) => !v)}
                    >
                      <Database size={12} strokeWidth={2.2} />
                      {ovStateForcedOff || !ovStateful
                        ? 'Stateless'
                        : 'Stateful'}
                      <ChevronDown size={12} strokeWidth={2.2} />
                    </button>
                    {stateMenuOpen && (
                      <div className="chat-backend-menu" role="menu">
                        <div className="chat-backend-menu__header">
                          Execution
                        </div>
                        {([true, false] as const).map((st) => (
                          <button
                            key={String(st)}
                            type="button"
                            role="menuitem"
                            className={`chat-backend-menu__item${
                              st === ovStateful && !ovStateForcedOff
                                ? ' chat-backend-menu__item--active'
                                : ''
                            }`}
                            onClick={() => handleSelectOvStateful(st)}
                          >
                            <span className="chat-backend-menu__label">
                              {st ? 'Stateful' : 'Stateless'}
                            </span>
                            {st === ovStateful && (
                              <Check size={14} strokeWidth={2.2} />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <span className="chat-token-counter__stats">
              {loading && tps > 0 && (
                <InfoTooltip
                  title="Generation Speed"
                  content={GENERATION_SPEED_TOOLTIP}
                  hideIcon
                  side="top"
                >
                  <span
                    className="chat-token-counter__tps"
                    style={{ marginRight: '10px', opacity: 0.75 }}
                  >
                    <Gauge size={13} />
                    {tps.toFixed(1)} t/s
                  </span>
                </InfoTooltip>
              )}
              <InfoTooltip
                title="Token Counter"
                content={TOKEN_COUNTER_TOOLTIP}
                hideIcon
                side="top"
              >
                <span className="chat-token-counter__tokens">
                  {maxTokens !== null
                    ? `${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`
                    : '— / — tokens'}
                </span>
              </InfoTooltip>
            </span>
          </div>
        </div>

        <div className="chat-bottom-bar">
          {estimatedCost > 0 && (
            <button
              type="button"
              className="chat-cost-display"
              onClick={() => openSavingsModal('total', 'Estimated savings')}
              title="Estimated savings"
            >
              {`Estimated savings: ${formatMoney(estimatedCost)}`}
            </button>
          )}
          <button
            type="button"
            className={`chat-server-status ${isServerOnline ? 'chat-server-status--online' : 'chat-server-status--offline'}${serverToggling ? ' chat-server-status--toggling' : ''}`}
            onClick={handleToggleServer}
            disabled={serverToggling}
            title={
              isServerOnline
                ? 'Server is online — click to stop'
                : 'Server is offline — click to start'
            }
            aria-label={isServerOnline ? 'Server Online' : 'Server Offline'}
          >
            <span className="chat-server-status__dot" aria-hidden="true" />
            <span>{isServerOnline ? 'Server Online' : 'Server Offline'}</span>
          </button>
        </div>

        {showImageModal && (
          <MediaAttachModal
            onAttach={(dataUrl, name) => {
              const id = crypto.randomUUID();
              setPendingMedia((prev) => [
                ...prev,
                { id, type: 'image', dataUrl, name },
              ]);
            }}
            onAttachVideo={(file) => {
              const id = crypto.randomUUID();
              setPendingMedia((prev) => [
                ...prev,
                {
                  id,
                  type: 'video',
                  file,
                  objectUrl: URL.createObjectURL(file),
                },
              ]);
            }}
            onAttachTextStart={(name) => {
              const id = crypto.randomUUID();
              setPendingMedia((prev) => [
                ...prev,
                { id, type: 'document', name, content: '', status: 'waiting' },
              ]);
              return id;
            }}
            onAttachTextStatus={(id, status) => {
              setPendingMedia((prev) =>
                prev.some((m) => m.id === id)
                  ? prev.map((m) =>
                      m.id === id && m.type === 'document'
                        ? { ...m, status }
                        : m,
                    )
                  : prev,
              );
            }}
            onAttachText={(id, name, content) => {
              setPendingMedia((prev) =>
                prev.some((m) => m.id === id)
                  ? prev.map((m) =>
                      m.id === id && m.type === 'document'
                        ? { ...m, content, status: undefined }
                        : m,
                    )
                  : prev,
              );
            }}
            onAttachTextFail={(id) => {
              setPendingMedia((prev) => prev.filter((m) => m.id !== id));
            }}
            onToastError={showErrorToast}
            onClose={() => setShowImageModal(false)}
            hasProjector={canAttachImages}
            dragging={pageDragging}
          />
        )}

        {imageViewerUrl && (
          <ImageViewer
            imageUrl={imageViewerUrl}
            onClose={() => setImageViewerUrl(null)}
          />
        )}

        {showSavingsModal && (
          <SavingsModal
            usage={usageSummary}
            currentMonthId={savingsModalMonthId}
            monthLabel={savingsModalMonthLabel}
            title={savingsModalTitle}
            tipBasis={savingsModalBasis}
            onClose={() => setShowSavingsModal(false)}
          />
        )}

        {chatErrors.length > 0 && (
          <div className="chat-toast-stack">
            {chatErrors.map((error) => (
              <div key={error.id} className="chat-toast">
                <X
                  size={14}
                  className="chat-toast__close"
                  onClick={() => dismissChatError(error.id)}
                />
                <span className="chat-toast__title">Error</span>
                {(() => {
                  const lines = error.message.split('\n').filter(Boolean);
                  if (lines.length <= 1)
                    return (
                      <span className="chat-toast__message">
                        {error.message}
                      </span>
                    );
                  return (
                    <>
                      <span className="chat-toast__message">{lines[0]}</span>
                      <ul className="chat-error__log">
                        {lines.slice(1).map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
