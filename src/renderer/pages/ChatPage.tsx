import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
  useCallback,
  ReactNode,
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
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import MessageContent from '../components/MessageContent';
import ConfirmDialog from '../components/ConfirmDialog';
import { Profile } from '../types/profile';
import '../styles/ChatPage.css';

interface MessageSegment {
  id: string;
  text: string;
  type: 'thought' | 'comment' | 'normal' | 'tool';
  toolName?: string;
  toolStatus?: 'calling' | 'done';
  toolParams?: string;
  toolResult?: string;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: MessageSegment[];
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: MessageSegment[];
}

let persistentMessages: Message[] = [];
let persistentLoadedProfileId: string = '';
let persistentMessageCounter: number = 0;

function ToolCallSegment({ segment }: { segment: MessageSegment }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(segment.toolParams || segment.toolResult);

  const prettyPrintJson = (jsonString: string): string => {
    try {
      const parsed = JSON.parse(jsonString);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonString;
    }
  };

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
        <Wrench className="tool-call-segment__icon" size={16} />
        <span className="tool-call-segment__name">{segment.toolName}</span>
        {segment.toolStatus === 'calling' ? (
          <div className="tool-call-segment__spinner" />
        ) : segment.toolStatus === 'done' ? (
          <Check className="tool-call-segment__check" size={16} />
        ) : null}
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
              <pre className="tool-call-segment__json">
                {prettyPrintJson(segment.toolParams)}
              </pre>
            </>
          )}
          {segment.toolResult && (
            <>
              <div className="tool-call-segment__label">Result</div>
              <pre className="tool-call-segment__json">
                {prettyPrintJson(segment.toolResult)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>(persistentMessages);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
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
  const profilesRef = useRef<Profile[]>([]);
  const activeToolSegmentId = useRef<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const selectedProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? null;

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

      const navStoredId = localStorage.getItem('selectedProfileId');

      if (navStoredId && navStoredId !== persistentLoadedProfileId) {
        setSelectedProfileId(navStoredId);
      } else if (!navStoredId && persistentLoadedProfileId) {
        setSelectedProfileId('');
      }
    }
  }, [location.pathname, loadProfilesFromStorage]);

  const startNewChatWithProfile = async (profileId: string | null) => {
    setMessages([]);
    persistentMessages = [];
    messageCounter.current = 0;
    persistentMessageCounter = 0;
    setUsedTokens(0);

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
    persistentMessages = messages;
  }, [messages]);

  useEffect(() => {
    if (selectedProfileId) {
      localStorage.setItem('selectedProfileId', selectedProfileId);
    } else {
      localStorage.removeItem('selectedProfileId');
    }
  }, [selectedProfileId]);

  useEffect(() => {
    persistentMessageCounter = messageCounter.current;
  });

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
      if (!selectedProfileId) {
        setLoadError(null);
        return;
      }

      const profile =
        profilesRef.current.find((p) => p.id === selectedProfileId) ?? null;

      if (!profile) {
        setLoadError(null);
        return;
      }

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

      if (persistentLoadedProfileId) {
        await unloadModel();
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
      });

      if (abortController.cancelled) {
        setModelLoading(false);
        return;
      }

      try {
        const res = await window.electronAPI.chatLoadProfile(profile);

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
            } else {
              persistentLoadedProfileId = '';
              setLoadError(
                'Profile loaded but context is invalid. Try reloading.',
              );
              await unloadModel();
            }
          }
        } else {
          persistentLoadedProfileId = '';
          setLoadError(res.error || 'Failed to load profile');
          await unloadModel();
        }
      } catch (error) {
        setModelLoading(false);
        persistentLoadedProfileId = '';
        setLoadError(
          error instanceof Error ? error.message : 'Unknown error occurred',
        );
        await unloadModel();
      }
    };

    load();

    return () => {
      abortController.cancelled = true;
    };
  }, [selectedProfileId]);

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
    };

    updateContextUsage();

    const pollInterval = loading ? 500 : 2000;
    const interval = setInterval(updateContextUsage, pollInterval);

    return () => clearInterval(interval);
  }, [selectedProfileId, modelLoading, loading, maxTokens, loadError]);

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

    const unsubscribeFunctionCall = window.electronAPI.onChatFunctionCall(
      (data) => {
        setMessages((prevMessages) => {
          const updatedMessages = [...prevMessages];
          const lastMessage = updatedMessages[updatedMessages.length - 1];

          const toolSegment: MessageSegment = {
            id: crypto.randomUUID(),
            text: '',
            type: 'tool',
            toolName: data.name,
            toolStatus: 'calling',
            toolParams: data.params,
          };

          if (lastMessage?.role === 'assistant') {
            lastMessage.content.push(toolSegment);
          } else {
            const assistantMessage: ChatMessage = {
              id: messageCounter.current,
              role: 'assistant',
              content: [toolSegment],
            };
            messageCounter.current += 1;
            updatedMessages.push(assistantMessage);
          }

          activeToolSegmentId.current = toolSegment.id;
          setProcessing(true);
          return updatedMessages;
        });
      },
    );

    const unsubscribeFunctionResult = window.electronAPI.onChatFunctionResult(
      (data) => {
        setMessages((prevMessages) => {
          const updatedMessages = [...prevMessages];
          const lastMessage = updatedMessages[updatedMessages.length - 1];

          if (
            lastMessage?.role === 'assistant' &&
            activeToolSegmentId.current
          ) {
            const toolSegment = lastMessage.content.find(
              (seg) => seg.id === activeToolSegmentId.current,
            );
            if (toolSegment && toolSegment.type === 'tool') {
              toolSegment.toolStatus = 'done';
              toolSegment.toolResult = data.result;
            }
          }

          activeToolSegmentId.current = null;
          return updatedMessages;
        });
      },
    );

    return () => {
      removeTokenListener();
      removeDoneListener();
      unsubscribeFunctionCall();
      unsubscribeFunctionResult();
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
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, processing]);

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

    messageCounter.current += 1;
    segmentCounter.current += 1;

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

    if (messages.length > 0) {
      setPendingProfileId(newProfileId);
      setShowConfirmDialog(true);
    } else {
      setSelectedProfileId(newProfileId);
    }
  };

  const handleRetry = async () => {
    setLoadError(null);

    if (persistentLoadedProfileId) {
      await unloadModel();
    }

    const tempId = selectedProfileId;
    setSelectedProfileId('');
    setTimeout(() => {
      setSelectedProfileId(tempId);
    }, 100);
  };

  const tokenRatio = maxTokens !== null ? usedTokens / maxTokens : 0;
  let tokenCounterClass = 'chat-token-counter';
  if (tokenRatio >= 0.9) tokenCounterClass += ' chat-token-counter--danger';
  else if (tokenRatio >= 0.75)
    tokenCounterClass += ' chat-token-counter--warning';

  const pendingProfile = profiles.find((p) => p.id === pendingProfileId);

  return (
    <div className="chat-page">
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

        <button
          type="button"
          className="chat-system-prompt-button"
          onClick={() => navigate('/profiles')}
          title="Manage Profiles"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

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

      <div className="chat-messages" ref={messagesContainerRef}>
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
                <div className="chat-message__assistant-content">
                  {/* Approach: Group consecutive non-tool segments and interleave with tool segments.
                  This preserves insertion order while allowing MessageContent to handle
                  consecutive text/thought/comment segments as a single logical unit. */}
                  {(() => {
                    const elements: ReactNode[] = [];
                    let currentTextSegments: MessageSegment[] = [];

                    msg.content.forEach((segment) => {
                      if (segment.type === 'tool') {
                        // Flush any accumulated text segments before rendering the tool call
                        if (currentTextSegments.length > 0) {
                          elements.push(
                            <MessageContent
                              key={`text-batch-${elements.length}`}
                              segments={currentTextSegments}
                            />,
                          );
                          currentTextSegments = [];
                        }
                        // Render the tool call segment inline
                        elements.push(
                          <ToolCallSegment
                            key={segment.id}
                            segment={segment}
                          />,
                        );
                      } else {
                        // Accumulate non-tool segments
                        currentTextSegments.push(segment);
                      }
                    });

                    // Flush any remaining text segments at the end
                    if (currentTextSegments.length > 0) {
                      elements.push(
                        <MessageContent
                          key={`text-batch-${elements.length}`}
                          segments={currentTextSegments}
                        />,
                      );
                    }

                    return elements;
                  })()}
                </div>
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
              className="chat-send-button"
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
