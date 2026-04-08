import { CSSProperties, FormEvent, useEffect, useRef, useState } from 'react';
import { SendHorizonal, Square, Bot } from 'lucide-react';

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
  modelSelector: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  select: {
    flex: 1,
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 14,
    padding: '8px 12px',
    outline: 'none',
    cursor: 'pointer',
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
    padding: '8px 16px',
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end',
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
    padding: '10px 0',
    maxHeight: 220,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendButton: {
    width: 40,
    height: 40,
    marginBottom: 2,
    borderRadius: 10,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s ease',
    cursor: 'pointer',
  },
  message: {
    padding: '10px 16px',
    borderRadius: 'var(--radius-lg, 12px)',
    maxWidth: '75%',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  },
  userMessage: {
    alignSelf: 'flex-end',
    background: 'var(--bg-accent, #2563eb)',
    color: '#fff',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
  },
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LocalModel {
  filename: string;
  filepath: string;
  sizeBytes: number;
  generalName: string;
  quantization: string;
  isProjector: boolean;
}

export default function ChatPage() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Load local models on mount ──
  useEffect(() => {
    async function fetchLocalModels() {
      const models = await window.electronAPI.listLocalModels();
      // Filter out projectors (mmproj files)
      const chatModels = models.filter((m: LocalModel) => !m.isProjector);
      setLocalModels(chatModels);

      // Auto-select first model if available
      if (chatModels.length > 0 && !selectedModelPath) {
        setSelectedModelPath(chatModels[0].filepath);
      }
    }
    fetchLocalModels();
  }, []);

  // ── Load / Unload Model when selection changes ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!selectedModelPath) return;

      setModelLoading(true);
      setMessages([]); // Clear chat on new model load

      const res = await window.electronAPI.chatLoad(selectedModelPath);

      if (!cancelled) {
        setModelLoading(false);
        if (!res.success) {
          alert(`Failed to load model: ${res.error}`);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      window.electronAPI.chatUnload();
    };
  }, [selectedModelPath]);

  // ── Listen for streaming tokens ──
  useEffect(() => {
    const removeTokenListener = window.electronAPI.onChatToken((token) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + token },
          ];
        }
        return [...prev, { role: 'assistant', content: token }];
      });
    });

    const removeDoneListener = window.electronAPI.onChatDone(() => {
      setLoading(false);
    });

    return () => {
      removeTokenListener();
      removeDoneListener();
    };
  }, []);

  // ── Auto-scroll to bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const autoResize = (e: FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || loading || modelLoading || !selectedModelPath) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInputText('');
    setLoading(true);

    // Reset textarea height
    const textarea = document.querySelector('textarea');
    if (textarea) textarea.style.height = 'auto';

    await window.electronAPI.chatSend(text);
  };

  const handleAbort = () => {
    window.electronAPI.chatAbort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={s.page}>
      {/* Model Selector */}
      <div style={s.modelSelector}>
        <Bot size={20} style={{ color: 'var(--text-secondary)' }} />
        <select
          style={s.select}
          value={selectedModelPath}
          onChange={(e) => setSelectedModelPath(e.target.value)}
          disabled={modelLoading}
        >
          {localModels.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            <>
              <option value="">Select a model...</option>
              {localModels.map((model) => (
                <option key={model.filepath} value={model.filepath}>
                  {model.generalName} - {model.quantization} (
                  {(model.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB)
                </option>
              ))}
            </>
          )}
        </select>
        {modelLoading && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Loading...
          </span>
        )}
      </div>

      {/* Messages */}
      <div style={s.messages}>
        {messages.length === 0 && (
          <div style={s.emptyState}>
            <SendHorizonal style={s.emptyIcon} size={48} />
            <h2 style={{ fontWeight: 500 }}>
              {modelLoading ? 'Loading model...' : 'Start a conversation'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 400 }}>
              {selectedModelPath
                ? 'Type your message below.'
                : 'Select a model from the dropdown above, then type your message below.'}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...s.message,
              ...(msg.role === 'user' ? s.userMessage : s.assistantMessage),
            }}
          >
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={s.inputWrapper}>
        <textarea
          style={s.textarea}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            modelLoading
              ? 'Loading model...'
              : selectedModelPath
                ? 'Send a message... (Shift+Enter for new line)'
                : 'Select a model first...'
          }
          rows={1}
          onInput={autoResize}
          onKeyDown={handleKeyDown}
          disabled={loading || modelLoading || !selectedModelPath}
        />

        {loading ? (
          <button
            type="button"
            className="btn-accent"
            style={{ ...s.sendButton, background: '#ef4444' }}
            onClick={handleAbort}
            title="Stop generation"
          >
            <Square size={18} strokeWidth={2.2} fill="white" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-accent"
            style={s.sendButton}
            disabled={!inputText.trim() || !selectedModelPath || modelLoading}
            onClick={handleSend}
            title="Send message"
          >
            <SendHorizonal size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  );
}
