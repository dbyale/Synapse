import { Brain, MessageSquare, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import './styles/MessageContent.css';

interface MessageSegment {
  id: string;
  text: string;
  type: 'thought' | 'comment' | 'normal';
}

interface MessageContentProps {
  segments: MessageSegment[];
  onImageClick?: (url: string) => void;
}

function ThoughtSegment({ text, onImageClick }: { text: string; onImageClick?: (url: string) => void }) {
  const [isOpen, setIsOpen] = useState(true);

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
        <span>Thinking...</span>
      </button>
      {isOpen && (
        <div className="message-segment__content">
          <MarkdownRenderer content={text} onImageClick={onImageClick} />
        </div>
      )}
    </div>
  );
}

export default function MessageContent({ segments, onImageClick }: MessageContentProps) {
  // Filter out empty thought segments (models that open/close thinking immediately)
  const filteredSegments = segments.filter((seg) => {
    if (seg.type === 'thought') {
      return seg.text.trim().length > 0;
    }
    return true;
  });

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
          return <ThoughtSegment key={segment.id} text={segment.text} onImageClick={onImageClick} />;
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
