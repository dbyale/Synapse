import { FormEvent, useEffect, useRef, useState, KeyboardEvent } from 'react';
import {
  SendHorizonal,
  Square,
  Bot,
  SlidersHorizontal,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MessageContent from '../components/MessageContent';
import ConfirmDialog from '../components/ConfirmDialog';
import { Profile } from '../types/profile';
import '../styles/ChatPage.css';

interface MessageSegment {
  id: string;
  text: string;
  type: 'thought' | 'comment' | 'normal';
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: MessageSegment[];
}

// ── Persistent state that survives component unmount/remount ──
let persistentMessages: Message[] = [];
let persistentSelectedProfileId: string = '';
let persistentLoadedProfileId: string = '';
let persistentMessageCounter: number = 0;

export default function ChatPage() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>(persistentMessages);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    persistentSelectedProfileId,
  );
  const [placeholder, setPlaceholder] = useState('Select a profile first...');
  const [usedTokens, setUsedTokens] = useState<number>(0);
  const [maxTokens, setMaxTokens] = useState<number | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageCounter = useRef(persistentMessageCounter);
  const segmentCounter = useRef(0);
  const loadAbortController = useRef<{ cancelled: boolean }>({
    cancelled: false,
  });
  const unloadInProgress = useRef(false);

  const navigate = useNavigate();

  // ── Derived: currently selected profile object ──
  const selectedProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? null;

  // ── Helper: load profiles from localStorage ──
  const loadProfilesFromStorage = () => {
    const stored = localStorage.getItem('profiles');
    if (stored) {
      try {
        const parsed: Profile[] = JSON.parse(stored);
        // Sort by order field
        const sorted = [...parsed].sort((a, b) => a.order - b.order);
        setProfiles(sorted);

        // Auto-select first profile if nothing is selected yet
        if (!persistentSelectedProfileId && sorted.length > 0) {
          setSelectedProfileId(sorted[0].id);
        }

        return sorted;
      } catch (e) {
        console.error('[ChatPage] Failed to parse profiles:', e);
      }
    }
    return [];
  };

  // ── Unload model helper ──
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
    console.log('[ChatPage] Unloading current model...');

    try {
      await window.electronAPI.chatUnload();
      persistentLoadedProfileId = '';
      console.log('[ChatPage] Model unloaded successfully');
    } catch (error) {
      console.error('[ChatPage] Error unloading model:', error);
    } finally {
      unloadInProgress.current = false;
    }
  };

  // ── Load profiles on mount and listen for storage changes ──
  useEffect(() => {
    // Initial load
    loadProfilesFromStorage();

    // Listen for storage changes (e.g., from ProfilesPage)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'profiles') {
        console.log(
          '[ChatPage] Profiles changed in localStorage, reloading...',
        );
        const updated = loadProfilesFromStorage();

        // If the currently loaded profile was modified, reload it
        if (persistentLoadedProfileId && updated.length > 0) {
          const currentProfile = updated.find(
            (p) => p.id === persistentLoadedProfileId,
          );
          if (currentProfile) {
            console.log(
              '[ChatPage] Currently loaded profile was modified, reloading...',
            );
            // Trigger reload by bouncing the selected profile ID
            setSelectedProfileId('');
            setTimeout(
              () => setSelectedProfileId(persistentLoadedProfileId),
              10,
            );
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // ── Start new chat with a given profile ──
  const startNewChatWithProfile = async (profileId: string | null) => {
    setMessages([]);
    persistentMessages = [];
    messageCounter.current = 0;
    persistentMessageCounter = 0;
    setUsedTokens(0);

    if (persistentLoadedProfileId) {
      await unloadModel();
    }

    // Trigger reload by bouncing the selected profile ID
    if (profileId) {
      setSelectedProfileId('');
      setTimeout(() => setSelectedProfileId(profileId), 10);
    }
  };

  // ── Confirm dialog handlers ──
  const handleConfirmNewChat = async () => {
    setShowConfirmDialog(false);
    await startNewChatWithProfile(pendingProfileId);
    setPendingProfileId(null);
  };

  const handleCancelNewChat = () => {
    setShowConfirmDialog(false);
    setPendingProfileId(null);
  };

  // ── Sync persistent state ──
  useEffect(() => {
    persistentMessages = messages;
  }, [messages]);
  useEffect(() => {
    persistentSelectedProfileId = selectedProfileId;
  }, [selectedProfileId]);
  useEffect(() => {
    persistentMessageCounter = messageCounter.current;
  });

  // ── On mount, fetch context size in case model is already loaded ──
  useEffect(() => {
    async function syncContextSize() {
      const { contextSize } = await window.electronAPI.chatContextSize();
      if (contextSize !== null) setMaxTokens(contextSize);
    }
    syncContextSize();
  }, []);

  // ── Load profile when selectedProfileId changes ──
  useEffect(() => {
    const abortController = { cancelled: false };
    loadAbortController.current = abortController;

    async function load() {
      if (!selectedProfileId || !selectedProfile) {
        setLoadError(null);
        return;
      }

      // Already loaded — just sync context size
      if (persistentLoadedProfileId === selectedProfileId) {
        const { contextSize } = await window.electronAPI.chatContextSize();
        if (!abortController.cancelled) {
          setMaxTokens(contextSize);
          setLoadError(null);
        }
        return;
      }

      setModelLoading(true);
      setLoadError(null);
      setUsedTokens(0);
      setMaxTokens(null);

      console.log('[ChatPage] Loading profile:', selectedProfile.name);

      // Unload previous model first
      if (persistentLoadedProfileId) {
        await unloadModel();
      }

      // Brief pause to ensure VRAM is freed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (abortController.cancelled) {
        console.log('[ChatPage] Profile load cancelled during unload wait');
        setModelLoading(false);
        return;
      }

      try {
        const res = await window.electronAPI.chatLoadProfile(selectedProfile);

        console.log('[ChatPage] chatLoadProfile response:', res);

        if (abortController.cancelled) {
          setModelLoading(false);
          return;
        }

        setModelLoading(false);

        if (res.success) {
          persistentLoadedProfileId = selectedProfileId;

          const { contextSize } = await window.electronAPI.chatContextSize();

          if (!abortController.cancelled) {
            if (contextSize !== null && contextSize > 0) {
              setMaxTokens(contextSize);
              setLoadError(null);
              console.log(
                '[ChatPage] Profile loaded and verified successfully',
              );
            } else {
              console.error(
                '[ChatPage] Profile loaded but context size is invalid',
              );
              persistentLoadedProfileId = '';
              setLoadError(
                'Profile loaded but context is invalid. Try reloading.',
              );
              await unloadModel();
            }
          }
        } else {
          console.error(`[ChatPage] Backend returned error: ${res.error}`);
          persistentLoadedProfileId = '';
          setLoadError(res.error || 'Failed to load profile');
          await unloadModel();
        }
      } catch (error) {
        console.error('[ChatPage] Exception during profile load:', error);
        setModelLoading(false);
        persistentLoadedProfileId = '';
        setLoadError(
          error instanceof Error ? error.message : 'Unknown error occurred',
        );
        await unloadModel();
      }
    }

    load();

    return () => {
      abortController.cancelled = true;
    };
  }, [selectedProfileId, selectedProfile]);

  // ── Poll for context size until available ──
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
          return contextSize;
        })
        .catch(() => {});
    }, 1000);

    return () => clearInterval(interval);
  }, [maxTokens, selectedProfileId]);

  // ── Real-time context usage polling ──
  useEffect(() => {
    if (!selectedProfileId || modelLoading || loadError) return undefined;

    const updateContextUsage = async () => {
      const usage = await window.electronAPI.chatContextUsage();
      setUsedTokens(usage.used);
      if (usage.total > 0 && maxTokens === null) {
        setMaxTokens(usage.total);
      }
    };

    updateContextUsage();

    const pollInterval = loading ? 500 : 2000;
    const interval = setInterval(updateContextUsage, pollInterval);

    return () => clearInterval(interval);
  }, [selectedProfileId, modelLoading, loading, maxTokens, loadError]);

  // ── Listen for streaming tokens ──
  useEffect(() => {
    const removeTokenListener = window.electronAPI.onChatToken(
      ({ token, segmentType }) => {
        setProcessing(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];

          if (last && last.role === 'assistant') {
            const updatedContent = [...last.content];
            const lastSegment = updatedContent[updatedContent.length - 1];

            let currentType: 'thought' | 'comment' | 'normal' = 'normal';
            if (segmentType === 'thought') currentType = 'thought';
            else if (segmentType === 'comment') currentType = 'comment';

            if (lastSegment && lastSegment.type === currentType) {
              lastSegment.text += token;
            } else {
              segmentCounter.current += 1;
              updatedContent.push({
                id: `seg-${Date.now()}-${segmentCounter.current}`,
                text: token,
                type: currentType,
              });
            }

            return [...prev.slice(0, -1), { ...last, content: updatedContent }];
          }

          const id = messageCounter.current;
          messageCounter.current += 1;

          let initialType: 'thought' | 'comment' | 'normal' = 'normal';
          if (segmentType === 'thought') initialType = 'thought';
          else if (segmentType === 'comment') initialType = 'comment';

          segmentCounter.current += 1;
          return [
            ...prev,
            {
              id,
              role: 'assistant',
              content: [
                {
                  id: `seg-${Date.now()}-${segmentCounter.current}`,
                  text: token.replace(/^\s+/, ''),
                  type: initialType,
                },
              ],
            },
          ];
        });
      },
    );

    const removeDoneListener = window.electronAPI.onChatDone(() => {
      setLoading(false);
      setProcessing(false);
    });

    return () => {
      removeTokenListener();
      removeDoneListener();
    };
  }, []);

  // ── Smart auto-scroll ──
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isAtBottom =
      Math.abs(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      ) < 40;

    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, processing]);

  // ── Placeholder text ──
  useEffect(() => {
    if (modelLoading) setPlaceholder('Loading profile...');
    else if (loadError) setPlaceholder('Profile failed to load');
    else if (selectedProfileId)
      setPlaceholder('Send a message... (Shift+Enter for new line)');
    else setPlaceholder('Select a profile first...');
  }, [modelLoading, selectedProfileId, loadError]);

  const autoResize = (e: FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || loading || modelLoading || !selectedProfileId || loadError)
      return;

    messageCounter.current += 1;
    segmentCounter.current += 1;

    const userMessage: Message = {
      id: messageCounter.current,
      role: 'user',
      content: [
        {
          id: `seg-${Date.now()}-${segmentCounter.current}`,
          text,
          type: 'normal',
        },
      ],
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setLoading(true);
    setProcessing(true);

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

  const handleProfileChange = async (newProfileId: string) => {
    if (newProfileId === selectedProfileId) return;

    if (loadAbortController.current) {
      loadAbortController.current.cancelled = true;
    }

    setLoadError(null);

    if (persistentLoadedProfileId || modelLoading) {
      setModelLoading(false);
      await unloadModel();
    }

    // If there are existing messages, confirm before switching
    if (messages.length > 0) {
      setPendingProfileId(newProfileId);
      setShowConfirmDialog(true);
    } else {
      setSelectedProfileId(newProfileId);
    }
  };

  // ── Retry loading the profile ──
  const handleRetry = async () => {
    console.log('[ChatPage] Retrying profile load...');
    setLoadError(null);

    if (persistentLoadedProfileId) {
      await unloadModel();
    }

    const tempId = selectedProfileId;
    setSelectedProfileId('');
    setTimeout(() => {
      console.log('[ChatPage] Reloading profile:', tempId);
      setSelectedProfileId(tempId);
    }, 100);
  };

  // ── Token counter class ──
  const tokenRatio = maxTokens !== null ? usedTokens / maxTokens : 0;
  let tokenCounterClass = 'chat-token-counter';
  if (tokenRatio >= 0.9) tokenCounterClass += ' chat-token-counter--danger';
  else if (tokenRatio >= 0.75)
    tokenCounterClass += ' chat-token-counter--warning';

  const pendingProfile = profiles.find((p) => p.id === pendingProfileId);

  return (
    <div className="chat-page">
      {/* Profile Selector */}
      <div className="chat-model-selector">
        <Bot
          size={18}
          style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
        />
        <select
          value={selectedProfileId}
          onChange={(e) => handleProfileChange(e.target.value)}
        >
          {profiles.length === 0 ? (
            <option value="">No profiles available</option>
          ) : (
            <>
              <option value="">Select a profile...</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </>
          )}
        </select>

        {modelLoading && !loadError && (
          <span className="chat-model-loading-label">Loading...</span>
        )}
        {loadError && <span className="chat-model-error-label">Error</span>}

        {/* Profiles Button */}
        <button
          type="button"
          className="chat-system-prompt-button"
          onClick={() => navigate('/profiles')}
          title="Manage Profiles"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {/* Confirmation Dialog */}
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

      {/* Messages */}
      <div className="chat-messages" ref={messagesContainerRef}>
        {/* Error Display */}
        {loadError && !modelLoading && (
          <div className="chat-error">
            <AlertCircle size={32} style={{ marginBottom: 4 }} />
            <span className="chat-error__title">Failed to Load Profile</span>
            <span className="chat-error__message">{loadError}</span>
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
                <MessageContent segments={msg.content} />
              ) : (
                msg.content[0]?.text || ''
              )}
            </div>
          </div>
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
          />

          {loading ? (
            <button
              type="button"
              className="chat-send-button chat-send-button--stop"
              onClick={handleAbort}
              title="Stop generation"
            >
              <Square size={20} strokeWidth={2.2} fill="white" />
            </button>
          ) : (
            <button
              type="button"
              className=" chat-send-button"
              disabled={
                !inputText.trim() ||
                !selectedProfileId ||
                modelLoading ||
                !!loadError
              }
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
