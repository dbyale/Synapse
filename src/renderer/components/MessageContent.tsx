import { Brain, MessageSquare, ChevronRight, Hash, Timer, Zap } from 'lucide-react';
import { useState, ReactNode } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import './styles/MessageContent.css';

interface GenerationStatsData {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
}

interface MessageSegment {
  id: string;
  text: string;
  type: 'thought' | 'comment' | 'normal' | 'tool';
  toolName?: string;
  toolStatus?: 'calling' | 'done';
  toolParams?: string;
  toolResult?: string;
  reprocessStats?: GenerationStatsData;
}

interface ToolGroup {
  segments: MessageSegment[];
  stats: GenerationStatsData | null;
}

export interface ThoughtItem {
  kind: 'text' | 'tools';
  text?: string;
  groups?: ToolGroup[];
}

interface MessageContentProps {
  segments: MessageSegment[];
  onImageClick?: (url: string) => void;
  toolGroups?: ToolGroup[];
  thoughtItems?: ThoughtItem[];
  renderTool?: (segment: MessageSegment, showInlineStats: boolean) => ReactNode;
  defaultOpen?: boolean;
}

function renderToolGroup(
  group: ToolGroup,
  key: number | string,
  renderTool: (segment: MessageSegment, showInlineStats: boolean) => ReactNode,
): ReactNode {
  if (group.segments.length === 1) {
    return renderTool(group.segments[0], !!group.stats);
  }

  return (
    <div key={`tool-group-${key}`} className="tool-call-group">
      <div className="tool-call-group__tools">
        {group.segments.map((seg) => renderTool(seg, false))}
      </div>
      {group.stats && (
        <div className="tool-call-group__stats">
          <div className="chat-stat-item" title="Prompt tokens">
            <Hash size={12} />
            <span>{group.stats.tokens} tokens</span>
          </div>
          <div className="chat-stat-item" title="Prompt processing time">
            <Timer size={12} />
            <span>{(group.stats.timeMs / 1000).toFixed(2)}s</span>
          </div>
          <div className="chat-stat-item" title="Prompt processing speed">
            <Zap size={12} />
            <span>{group.stats.tokensPerSecond.toFixed(1)} t/s</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ThoughtSegment({
  thoughtItems,
  onImageClick,
  renderTool,
  defaultOpen = true,
}: {
  thoughtItems: ThoughtItem[];
  onImageClick?: (url: string) => void;
  renderTool?: (segment: MessageSegment, showInlineStats: boolean) => ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toolCount = thoughtItems.reduce(
    (sum, item) => sum + (item.kind === 'tools' ? item.groups!.reduce((s, g) => s + g.segments.length, 0) : 0),
    0,
  );
  const label =
    toolCount > 0
      ? `Thinking (${toolCount} tool use${toolCount !== 1 ? 's' : ''})`
      : 'Thinking...';

  return (
    <div className="message-segment message-segment--thought">
      <button
        type="button"
        className="message-segment__thought-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <ChevronRight
          size={14}
          className={`message-segment__chevron ${isOpen ? 'message-segment__chevron--open' : ''}`}
        />
        <Brain size={14} />
        <span>{label}</span>
      </button>
      {isOpen && (
        <div className="message-segment__content">
          {thoughtItems.map((item, i) => {
            if (item.kind === 'text') {
              return (
                <div key={`text-${i}`} className="message-segment__thought-text">
                  <MarkdownRenderer content={item.text!} onImageClick={onImageClick} />
                </div>
              );
            }
            return (
              <div key={`tools-${i}`} className="message-segment__tools">
                {item.groups!.map((group, gi) =>
                  renderToolGroup(group, `${i}-${gi}`, renderTool!),
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MessageContent({ segments, onImageClick, toolGroups, thoughtItems, renderTool, defaultOpen }: MessageContentProps) {
  const filteredSegments = segments.filter((seg) => {
    if (seg.type === 'thought') {
      return seg.text.trim().length > 0;
    }
    return true;
  });

  // If thought items are provided, render as a thought block with interleaved content
  if (thoughtItems && thoughtItems.length > 0) {
    return (
      <div className="message-content">
        <ThoughtSegment
          thoughtItems={thoughtItems}
          onImageClick={onImageClick}
          renderTool={renderTool}
          defaultOpen={defaultOpen}
        />
      </div>
    );
  }

  // If tool groups are provided (legacy), render as combined thought+tools block
  if (toolGroups && toolGroups.length > 0) {
    const combinedText = filteredSegments.map((seg) => seg.text).join('');
    return (
      <div className="message-content">
        <ThoughtSegment
          thoughtItems={[{ kind: 'text', text: combinedText }, { kind: 'tools', groups: toolGroups }]}
          onImageClick={onImageClick}
          renderTool={renderTool}
          defaultOpen={defaultOpen}
        />
      </div>
    );
  }

  // Check if there are any non-normal segments after filtering
  const hasSpecialSegments = filteredSegments.some(
    (seg) => seg.type === 'thought' || seg.type === 'comment',
  );

  // If no special segments, just render all normal content together
  if (!hasSpecialSegments) {
    const combinedText = filteredSegments.map((seg) => seg.text).join('');
    return <MarkdownRenderer content={combinedText} onImageClick={onImageClick} />;
  }

  // Otherwise, render each segment with its appropriate wrapper
  return (
    <div className="message-content">
      {filteredSegments.map((segment) => {
        if (segment.type === 'thought') {
          return <ThoughtSegment key={segment.id} thoughtItems={[{ kind: 'text', text: segment.text }]} onImageClick={onImageClick} defaultOpen={defaultOpen} />;
        }

        if (segment.type === 'comment') {
          return (
            <div
              key={segment.id}
              className="message-segment message-segment--comment"
            >
              <div className="message-segment__label">
                <MessageSquare size={14} />
                <span>Comment</span>
              </div>
              <div className="message-segment__content">
                <MarkdownRenderer content={segment.text} onImageClick={onImageClick} />
              </div>
            </div>
          );
        }

        // Normal segment (when mixed with special segments)
        return (
          <div
            key={segment.id}
            className="message-segment message-segment--normal"
          >
            <MarkdownRenderer content={segment.text} onImageClick={onImageClick} />
          </div>
        );
      })}
    </div>
  );
}
