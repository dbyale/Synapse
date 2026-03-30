import { CSSProperties, FormEvent, useState } from 'react';
import { SendHorizonal } from 'lucide-react';

const s: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    gap: 16,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    paddingBottom: 8,
  },
  emptyState: {
    margin: 'auto',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
  },
  emptyIcon: {
    color: 'var(--text-secondary)',
    marginBottom: 8,
    opacity: 0.7,
  },
  inputWrapper: {
    position: 'relative',
    width: '100%',
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    padding: '8px 16px', // Reduced padding
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end', // Keeps button at bottom for multi-line
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },
  textarea: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: 15,
    resize: 'none',
    lineHeight: 1.5,
    padding: '10px 0', // Added padding to perfectly center with 40px button
    maxHeight: 220,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendButton: {
    width: 40,
    height: 40,
    marginBottom: 2, // Slight margin to optical-align with the text bottom
    borderRadius: 10,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s ease',
  },
} satisfies Record<string, CSSProperties>;

export default function ChatPage() {
  const [inputText, setInputText] = useState('');

  const autoResize = (e: FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  };

  return (
    <div style={s.page}>
      <div style={s.messages}>
        {/* Empty State */}
        <div style={s.emptyState}>
          <SendHorizonal style={s.emptyIcon} size={48} />
          <h2 style={{ fontWeight: 500 }}>Start a conversation</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 400 }}>
            Select a model from the bar above, then type your message below.
          </p>
        </div>
      </div>

      {/* Input Area */}
      <div style={s.inputWrapper}>
        <textarea
          style={s.textarea}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Send a message..."
          rows={1}
          onInput={autoResize}
        />

        <button
          type="button"
          className="btn-accent"
          style={s.sendButton}
          disabled={!inputText.trim()}
        >
          <SendHorizonal size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
