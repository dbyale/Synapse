import { FormEvent, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { SendHorizonal, Square, Bot, Settings } from 'lucide-react';
import MarkdownRenderer from '../components/MarkdownRenderer';
import SystemPromptMenu from '../components/SystemPromptMenu';
import ConfirmDialog from '../components/ConfirmDialog';
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

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  createdAt: number;
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
  const [processing, setProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState<string>(
    persistentSelectedModelPath,
  );
  const [placeholder, setPlaceholder] = useState('Select a model first...');
  const [usedTokens, setUsedTokens] = useState<number>(0);
  const [maxTokens, setMaxTokens] = useState<number | null>(null);
  const [showSystemPromptMenu, setShowSystemPromptMenu] = useState(false);
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageCounter = useRef(persistentMessageCounter);
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSystemPromptApplied = useRef(false);

  // ── Load system prompts from localStorage on mount ──
  useEffect(() => {
    const stored = localStorage.getItem('systemPrompts');
    if (stored) {
      try {
        setSystemPrompts(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse system prompts:', e);
      }
    }

    const storedSelectedId = localStorage.getItem('selectedPromptId');
    if (storedSelectedId) {
      setSelectedPromptId(storedSelectedId);
    }
  }, []);

  // ── Save system prompts to localStorage whenever they change ──
  const saveSystemPrompts = (prompts: SystemPrompt[]) => {
    setSystemPrompts(prompts);
    localStorage.setItem('systemPrompts', JSON.stringify(prompts));
  };

  // ── Start new chat with selected system prompt ──
  const startNewChatWithPrompt = async (promptId: string | null) => {
    if (promptId) {
      localStorage.setItem('selectedPromptId', promptId);
    } else {
      localStorage.removeItem('selectedPromptId');
    }

    setSelectedPromptId(promptId);

    // Clear messages
    setMessages([]);
    persistentMessages = [];
    messageCounter.current = 0;
    persistentMessageCounter = 0;

    // Reload the model with the new system prompt
    if (persistentModelLoaded) {
      await window.electronAPI.chatUnload();
      persistentModelLoaded = '';
    }

    // Trigger reload by updating the path
    if (selectedModelPath) {
      const tempPath = selectedModelPath;
      setSelectedModelPath('');
      setTimeout(() => setSelectedModelPath(tempPath), 10);
    }
  };

  // ── Handle selecting a system prompt ──
  const handleSelectPrompt = async (id: string | null) => {
    // If there are existing messages and we're changing the prompt, confirm first
    if (messages.length > 0 && id !== selectedPromptId) {
      setPendingPromptId(id);
      setShowConfirmDialog(true);
      return;
    }

    // No messages, just apply directly
    await startNewChatWithPrompt(id);
  };

  // ── Confirm dialog handlers ──
  const handleConfirmNewChat = async () => {
    setShowConfirmDialog(false);
    await startNewChatWithPrompt(pendingPromptId);
    setPendingPromptId(null);
  };

  const handleCancelNewChat = () => {
    setShowConfirmDialog(false);
    setPendingPromptId(null);
  };

  // ── Get the currently selected system prompt ──
  const selectedSystemPrompt = systemPrompts.find(
    (p) => p.id === selectedPromptId,
  );

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

  // ── On mount, fetch context size immediately in case model is already loaded ──
  useEffect(() => {
    async function syncContextSize() {
      const { contextSize } = await window.electronAPI.chatContextSize();
      if (contextSize !== null) setMaxTokens(contextSize);
    }
    syncContextSize();
  }, []);

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

  // ── Load model with system prompt ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!selectedModelPath) return;

      if (persistentModelLoaded === selectedModelPath) {
        const { contextSize } = await window.electronAPI.chatContextSize();
        if (!cancelled) setMaxTokens(contextSize);
        return;
      }

      setModelLoading(true);
      setUsedTokens(0);
      setMaxTokens(null);
      initialSystemPromptApplied.current = false;

      // Determine which system prompt to use
      const systemPromptToUse =
        selectedSystemPrompt?.content || 'You are a helpful assistant.';

      console.log(
        '[ChatPage] Loading model with system prompt:',
        selectedSystemPrompt ? selectedSystemPrompt.name : 'default',
      );

      // Pass the system prompt directly to chatLoad
      const res = await window.electronAPI.chatLoad(
        selectedModelPath,
        systemPromptToUse,
      );

      if (cancelled) return;

      setModelLoading(false);

      if (res.success) {
        persistentModelLoaded = selectedModelPath;
        initialSystemPromptApplied.current = true;
        const { contextSize } = await window.electronAPI.chatContextSize();
        if (!cancelled) {
          setMaxTokens(contextSize);
          console.log(
            '[ChatPage] Model loaded successfully with system prompt',
          );
        }
      } else {
        console.warn(`Failed to load model: ${res.error}`);
        persistentModelLoaded = '';
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedModelPath, selectedSystemPrompt]);

  // ── Poll for context size until available ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (maxTokens !== null || !selectedModelPath) {
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
          return contextSize;
        })
        .catch(() => {});
    }, 1000);

    return () => clearInterval(interval);
  }, [maxTokens, selectedModelPath]);

  // ── Debounced exact token count ──
  useEffect(() => {
    if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);

    tokenDebounceRef.current = setTimeout(async () => {
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
      setProcessing(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, content: (last.content + token).replace(/^\s+/, '') },
          ];
        }
        const id = messageCounter.current;
        messageCounter.current += 1;
        return [
          ...prev,
          { id, role: 'assistant', content: token.replace(/^\s+/, '') },
        ];
      });
    });

    const removeDoneListener = window.electronAPI.onChatDone(() => {
      setLoading(false);
      setProcessing(false);
    });

    return () => {
      removeTokenListener();
      removeDoneListener();
    };
  }, []);

  // ── Smart auto-scroll: only scroll if already at bottom ──
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isAtBottom =
      Math.abs(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      ) < 10;

    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, processing]);

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
    setProcessing(true);

    const textarea = document.querySelector('textarea');
    if (textarea) textarea.style.height = 'auto';

    // Send the message directly - system prompt is already set in the session
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

  // ── Token counter class ──
  const tokenRatio = maxTokens !== null ? usedTokens / maxTokens : 0;

  let tokenCounterClass = 'chat-token-counter';
  if (tokenRatio >= 0.9) tokenCounterClass += ' chat-token-counter--danger';
  else if (tokenRatio >= 0.75)
    tokenCounterClass += ' chat-token-counter--warning';

  const pendingPrompt = systemPrompts.find((p) => p.id === pendingPromptId);

  return (
    <div className="chat-page">
      {/* Model Selector */}
      <div className="chat-model-selector">
        <Bot
          size={18}
          style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
        />
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
              {localModels.map((m) => (
                <option key={m.filepath} value={m.filepath}>
                  {m.generalName} — {m.quantization} (
                  {(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB)
                </option>
              ))}
            </>
          )}
        </select>
        {modelLoading && (
          <span className="chat-model-loading-label">Loading...</span>
        )}

        {/* System Prompt Button */}
        <button
          type="button"
          className="chat-system-prompt-button"
          onClick={() => setShowSystemPromptMenu(true)}
          title="System Prompts"
        >
          <Settings size={18} />
          {selectedSystemPrompt && (
            <span className="chat-system-prompt-indicator" />
          )}
        </button>
      </div>

      {/* System Prompt Menu Modal */}
      {showSystemPromptMenu && (
        <SystemPromptMenu
          prompts={systemPrompts}
          selectedPromptId={selectedPromptId}
          onClose={() => setShowSystemPromptMenu(false)}
          onSave={saveSystemPrompts}
          onSelect={handleSelectPrompt}
        />
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <ConfirmDialog
          title="Start New Chat?"
          message={`Changing the system prompt${pendingPrompt ? ` to "${pendingPrompt.name}"` : ''} will clear your current conversation and reload the model. Do you want to continue?`}
          confirmText="Start New Chat"
          cancelText="Cancel"
          onConfirm={handleConfirmNewChat}
          onCancel={handleCancelNewChat}
        />
      )}

      {/* Messages */}
      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 && !loading && (
          <div className="chat-empty-state">
            <SendHorizonal className="chat-empty-state-icon" size={44} />
            <h2>
              {modelLoading ? 'Loading model...' : 'Start a conversation'}
            </h2>
            <p>
              {selectedModelPath
                ? 'Type your message below.'
                : 'Select a model from the dropdown above, then type your message below.'}
            </p>
            {selectedSystemPrompt && (
              <div className="chat-active-prompt-badge">
                Active: {selectedSystemPrompt.name}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}`}
          >
            <div className="chat-message__label">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            {loading &&
              msg === messages[messages.length - 1] &&
              msg.role === 'assistant' && (
                <div className="chat-message__indicator-box">
                  <div className="chat-indicator">
                    <div className="chat-indicator__spinner" />
                    <span className="chat-indicator__label">
                      {processing ? 'Processing prompt…' : 'Generating…'}
                    </span>
                  </div>
                </div>
              )}
            <div className="chat-message__bubble">
              {msg.role === 'assistant' ? (
                <MarkdownRenderer content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* Processing / generating indicator - shown when no assistant message exists yet */}
        {loading &&
          (messages.length === 0 ||
            messages[messages.length - 1].role !== 'assistant') && (
            <div className="chat-message chat-message--assistant">
              <div className="chat-message__label">Assistant</div>
              <div className="chat-message__indicator-box">
                <div className="chat-indicator">
                  <div className="chat-indicator__spinner" />
                  <span className="chat-indicator__label">
                    {processing ? 'Processing prompt…' : 'Generating…'}
                  </span>
                </div>
              </div>
            </div>
          )}

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
              <Square size={20} strokeWidth={2.2} fill="white" />
            </button>
          ) : (
            <button
              type="button"
              className="btn-accent chat-send-button"
              disabled={!inputText.trim() || !selectedModelPath || modelLoading}
              onClick={handleSend}
              title="Send message"
            >
              <SendHorizonal size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>

        <div className={tokenCounterClass}>
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
