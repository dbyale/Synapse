import { FormEvent, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { SendHorizonal, Square, Bot } from 'lucide-react';
import '../styles/ChatPage.css';

interface Message {
  id: number;
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

// ── Persistent state that survives component unmount/remount ──
let persistentMessages: Message[] = [];
let persistentSelectedModelPath: string = '';
let persistentModelLoaded: string = '';
let persistentMessageCounter: number = 0;

export default function ChatPage() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>(persistentMessages);
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState<string>(
    persistentSelectedModelPath,
  );
  const [placeholder, setPlaceholder] = useState('Select a model first...');

  // ── Token counter state ──
  const [usedTokens, setUsedTokens] = useState<number>(0);
  const [maxTokens, setMaxTokens] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCounter = useRef(persistentMessageCounter);
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sync persistent state ──
  useEffect(() => {
    persistentMessages = messages;
  }, [messages]);
  useEffect(() => {
    persistentSelectedModelPath = selectedModelPath;
  }, [selectedModelPath]);
  useEffect(() => {
    persistentMessageCounter = messageCounter.current;
  });

  // ── Load local models on mount ──
  useEffect(() => {
    async function fetchLocalModels() {
      const models = await window.electronAPI.listLocalModels();
      const chatModels = models.filter((m: LocalModel) => !m.isProjector);
      setLocalModels(chatModels);
      if (chatModels.length > 0 && !selectedModelPath) {
        setSelectedModelPath(chatModels[0].filepath);
      }
    }
    fetchLocalModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load model ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!selectedModelPath) return;
      if (persistentModelLoaded === selectedModelPath) {
        // Model already loaded — still fetch context size in case we just
        // navigated back to this page.
        const { contextSize } = await window.electronAPI.chatContextSize();
        if (!cancelled) setMaxTokens(contextSize);
        return;
      }

      setModelLoading(true);
      setMessages([]);
      setUsedTokens(0);
      setMaxTokens(null);

      const res = await window.electronAPI.chatLoad(selectedModelPath);

      if (!cancelled) {
        setModelLoading(false);
        if (res.success) {
          persistentModelLoaded = selectedModelPath;
          const { contextSize } = await window.electronAPI.chatContextSize();
          if (!cancelled) setMaxTokens(contextSize);
        } else {
          console.warn(`Failed to load model: ${res.error}`);
          persistentModelLoaded = '';
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedModelPath]);

  // ── Debounced exact token count ──
  // Runs whenever the conversation or the current input changes.
  useEffect(() => {
    if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);

    tokenDebounceRef.current = setTimeout(async () => {
      // Build the full text the model will see: all messages + current input.
      const fullText = [...messages.map((m) => m.content), inputText].join(' ');

      const { count } = await window.electronAPI.chatTokenize(fullText);
      if (count !== null) setUsedTokens(count);
    }, 300);

    return () => {
      if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
    };
  }, [messages, inputText]);

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
        const id = messageCounter.current;
        messageCounter.current += 1;
        return [...prev, { id, role: 'assistant', content: token }];
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

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Placeholder text ──
  useEffect(() => {
    if (modelLoading) setPlaceholder('Loading model...');
    else if (selectedModelPath)
      setPlaceholder('Send a message... (Shift+Enter for new line)');
    else setPlaceholder('Select a model first...');
  }, [modelLoading, selectedModelPath]);

  const autoResize = (e: FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || loading || modelLoading || !selectedModelPath) return;

    const userMessage: Message = {
      id: (messageCounter.current += 1),
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setLoading(true);

    const textarea = document.querySelector('textarea');
    if (textarea) textarea.style.height = 'auto';

    await window.electronAPI.chatSend(text);
  };

  const handleAbort = () => window.electronAPI.chatAbort();

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleModelChange = async (newPath: string) => {
    if (newPath === selectedModelPath) return;
    if (persistentModelLoaded && newPath !== persistentModelLoaded) {
      await window.electronAPI.chatUnload();
      persistentModelLoaded = '';
    }
    setSelectedModelPath(newPath);
  };

  // ── Token counter presentation ──
  const tokenRatio = maxTokens !== null ? usedTokens / maxTokens : 0;
  const tokenCounterClass = () => {
    if (tokenRatio >= 0.9)
      return 'chat-token-counter chat-token-counter--danger';
    if (tokenRatio >= 0.75)
      return 'chat-token-counter chat-token-counter--warning';
    return 'chat-token-counter';
  };

  return (
    <div className="chat-page">
      {/* Model Selector */}
      <div className="chat-model-selector">
        <Bot size={20} style={{ color: 'var(--text-secondary)' }} />
        <select
          value={selectedModelPath}
          onChange={(e) => handleModelChange(e.target.value)}
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
          <span className="chat-model-loading-label">Loading...</span>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <SendHorizonal className="chat-empty-state-icon" size={48} />
            <h2>
              {modelLoading ? 'Loading model...' : 'Start a conversation'}
            </h2>
            <p>
              {selectedModelPath
                ? 'Type your message below.'
                : 'Select a model from the dropdown above, then type your message below.'}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${
              msg.role === 'user'
                ? 'chat-message--user'
                : 'chat-message--assistant'
            }`}
          >
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-wrapper">
        <div className="chat-input-row">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={placeholder}
            rows={1}
            onInput={autoResize}
            onKeyDown={handleKeyDown}
            disabled={loading || modelLoading || !selectedModelPath}
          />

          {loading ? (
            <button
              type="button"
              className="btn-accent chat-send-button chat-send-button--stop"
              onClick={handleAbort}
              title="Stop generation"
            >
              <Square size={18} strokeWidth={2.2} fill="white" />
            </button>
          ) : (
            <button
              type="button"
              className="btn-accent chat-send-button"
              disabled={!inputText.trim() || !selectedModelPath || modelLoading}
              onClick={handleSend}
              title="Send message"
            >
              <SendHorizonal size={18} strokeWidth={2.2} />
            </button>
          )}
        </div>

        {/* Token counter */}
        <div className={tokenCounterClass()}>
          {maxTokens !== null ? (
            <span>
              {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()}{' '}
              tokens
            </span>
          ) : (
            <span>— / — tokens</span>
          )}
        </div>
      </div>
    </div>
  );
}
