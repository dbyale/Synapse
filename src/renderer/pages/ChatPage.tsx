import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
  useCallback,
  ReactNode,
  DragEvent,
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
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import MessageContent from '../components/MessageContent';
import ImageViewer from '../components/ImageViewer';
import ConfirmDialog from '../components/ConfirmDialog';
import UserInputModal from '../components/UserInputModal';
import ProfileSelectModal from '../components/ProfileSelectModal';
import { Profile } from '../types/profile';
import type { AppSettings, ContentPart } from '../preload.d';
import { getToolMeta } from '../utils/extensionData';
import { resolveIcon } from '../components/workflows/IconPicker';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../styles/ChatPage.css';

interface GenerationStatsData {
  tokens: number;
  timeMs: number;
  tokensPerSecond: number;
}

interface MediaDisplayItem {
  type: 'image' | 'video' | 'document';
  url?: string;
  name?: string;
}

type PendingMedia =
  | { id: string; type: 'image'; dataUrl: string; name?: string }
  | { id: string; type: 'video'; file: File; objectUrl: string }
  | { id: string; type: 'document'; name: string; content: string };

interface MessageSegment {
  id: string;
  text: string;
  type: 'thought' | 'comment' | 'normal' | 'tool';
  toolName?: string;
  toolStatus?: 'calling' | 'done';
  toolParams?: string;
  toolResult?: string;
  reprocessStats?: GenerationStatsData;
  mediaItems?: MediaDisplayItem[];
}

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: MessageSegment[];
  collapsed?: boolean;
  stats?: GenerationStatsData;
  promptStats?: GenerationStatsData;
}

const INPUT_PRICE_PER_MILLION = 150.0;
const OUTPUT_PRICE_PER_MILLION = 600.0;

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

let persistentMessages: Message[] = [];
let persistentLoadedProfileId: string = '';
let persistentBackend: string | null = null;
let persistentMessageCounter: number = 0;
let persistentModelLoading = false;
let persistentLastLoadId = 0;
let isReprocessing = false;
let pendingSegmentIds: string[] = [];

function ToolCallSegment({
  segment,
  showInlineStats,
}: {
  segment: MessageSegment;
  showInlineStats?: boolean;
}) {
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
        {(() => {
          const meta = segment.toolName
            ? getToolMeta(segment.toolName)
            : undefined;
          const IconComp = meta?.icon ? resolveIcon(meta.icon) : Wrench;
          return <IconComp className="tool-call-segment__icon" size={16} />;
        })()}
        <span className="tool-call-segment__name">
          {(segment.toolName &&
            getToolMeta(segment.toolName)?.label) ??
            segment.toolName}
        </span>
        {segment.toolStatus === 'calling' ? (
          <div className="tool-call-segment__spinner" />
        ) : segment.toolStatus === 'done' ? (
          <Check className="tool-call-segment__check" size={16} />
        ) : null}
        {showInlineStats && segment.reprocessStats && (
          <span className="tool-call-segment__header-stats">
            <Hash size={10} />
            <span>{segment.reprocessStats.tokens}</span>
            <Timer size={10} />
            <span>{(segment.reprocessStats.timeMs / 1000).toFixed(1)}s</span>
            <Zap size={10} />
            <span>{segment.reprocessStats.tokensPerSecond.toFixed(1)}</span>
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
}

const DOC_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'html', 'htm', 'json', 'xml', 'rtf', 'txt', 'md', 'epub'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'webm'];

const DOC_EXTENSIONS_SET = new Set(DOC_EXTENSIONS);
const IMAGE_EXTENSIONS_SET = new Set(IMAGE_EXTENSIONS);
const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

function getExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

function MediaAttachModal({
  onAttach,
  onAttachVideo,
  onAttachText,
  onClose,
  hasProjector,
}: {
  onAttach: (dataUrl: string, name: string) => void;
  onAttachVideo: (file: File) => void;
  onAttachText: (name: string, content: string) => void;
  onClose: () => void;
  hasProjector: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);

  const supportedExtensions = hasProjector
    ? [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...DOC_EXTENSIONS]
    : [...DOC_EXTENSIONS];

  const filterName = hasProjector ? 'All supported files' : 'All supported documents';

  async function processDocument(filePath: string, filename: string) {
    setConverting(true);
    try {
      const result = await window.electronAPI.convertFileWithMarkitdown(filePath);
      if (result.success && result.markdown) {
        onAttachText(filename, result.markdown);
      } else {
        alert(`Failed to convert ${filename}: ${result.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error converting ${filename}: ${err.message}`);
    } finally {
      setConverting(false);
    }
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const ext = getExtension(file.name);
      if (hasProjector && (IMAGE_EXTENSIONS_SET.has(ext) || file.type.startsWith('image/'))) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const result = ev.target?.result;
          if (typeof result === 'string') {
            onAttach(result, file.name);
          }
        };
        reader.readAsDataURL(file);
      } else if (hasProjector && (VIDEO_EXTENSIONS_SET.has(ext) || file.type.startsWith('video/'))) {
        onAttachVideo(file);
        onClose();
        return;
      } else if (DOC_EXTENSIONS_SET.has(ext)) {
        const filePath = (file as any).path;
        if (filePath) {
          await processDocument(filePath, file.name);
        } else {
          alert('Cannot convert files dragged from outside the file system.');
        }
      }
    }
  };

  const handleSelectFromDisk = async () => {
    const paths = await window.electronAPI.browseForFiles({
      title: 'Select files',
      multiSelections: true,
      filters: [
        { name: filterName, extensions: supportedExtensions },
      ],
    });
    if (paths.length === 0) return;
    for (const filePath of paths) {
      const ext = getExtension(filePath);
      const filename = filePath.split(/[/\\]/).pop() || 'file';
      if (hasProjector && VIDEO_EXTENSIONS_SET.has(ext)) {
        const uint8 = await window.electronAPI.readFileAsBuffer(filePath);
        const mime = ext === 'webm' ? 'video/webm' : 'video/mp4';
        const blob = new Blob([uint8.buffer as ArrayBuffer], { type: mime });
        const file = new File([blob], filename, { type: mime });
        onAttachVideo(file);
        break;
      } else if (hasProjector && IMAGE_EXTENSIONS_SET.has(ext)) {
        const dataUrl = await window.electronAPI.readFileAsDataUrl(filePath);
        onAttach(dataUrl, filename);
      } else if (DOC_EXTENSIONS_SET.has(ext)) {
        await processDocument(filePath, filename);
      }
    }
    onClose();
  };

  return (
    <div className="image-modal-overlay" onClick={onClose}>
      <div
        className={`image-modal${dragging ? ' image-modal--dragging' : ''}${converting ? ' image-modal--converting' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <button className="image-modal__close" onClick={onClose} type="button">
          <X size={18} />
        </button>
        <div className="image-modal__drop-zone">
          {converting ? (
            <div className="image-modal__converting">
              <div className="image-modal__spinner" />
              <p className="image-modal__label">Converting file...</p>
            </div>
          ) : (
            <>
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
            </>
          )}
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

  const duration = video.duration;
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

  const achievedFps = actualCount > 0 && lastActualTime > 0
    ? actualCount / lastActualTime
    : fps;
  return { frames, fps: achievedFps };
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tps, setTps] = useState<number>(0);
  const [cumulativeTokens, setCumulativeTokens] = useState<{
    totalInputTokens: number;
    totalOutputTokens: number;
  }>({ totalInputTokens: 0, totalOutputTokens: 0 });
  const [projectorLoaded, setProjectorLoaded] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
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
  const [pendingSendData, setPendingSendData] = useState<{
    text: string;
    pendingMedia: PendingMedia[];
  } | null>(null);
  const [backend, setBackend] = useState<string | null>(persistentBackend);
  const [userInputRequest, setUserInputRequest] = useState<{
    requestId: string;
    type: 'confirm' | 'select' | 'freeform';
    prompt: string;
    options?: string[];
    allowOther?: boolean;
    toolName: string;
    toolParams: any;
  } | null>(null);

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
  const generationBaselineTokens = useRef<number | null>(null);
  const lastTokenSnapshot = useRef<{ tokens: number; time: number } | null>(
    null,
  );
  const systemMessageInsertedRef = useRef(false);
  const pendingSendRef = useRef<{ text: string; pendingMedia: PendingMedia[] } | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const refreshCumulativeTokens = useCallback(async () => {
    try {
      const usage = await window.electronAPI.chatCumulativeTokenUsage();
      setCumulativeTokens(usage);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    refreshCumulativeTokens();
  }, [refreshCumulativeTokens]);

  useEffect(() => {
    window.electronAPI.loadSettings().then((s) => setSettings(s)).catch(() => {});
  }, []);

  const estimatedCost =
    (cumulativeTokens.totalInputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
    (cumulativeTokens.totalOutputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;

  const selectedProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? null;
  const profileHasProjector = !!selectedProfile?.projector;
  const canAttachImages = !!(projectorLoaded || (profileHasProjector && !loadError));

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
    if (!selectedProfileId || modelLoading || loadError) {
      setProjectorLoaded(false);
      return;
    }
    window.electronAPI
      .chatHasProjector()
      .then(setProjectorLoaded)
      .catch(() => setProjectorLoaded(false));
  }, [selectedProfileId, modelLoading, loadError]);

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
    setMessages([]);
    persistentMessages = [];
    messageCounter.current = 0;
    persistentMessageCounter = 0;
    setUsedTokens(0);
    systemMessageInsertedRef.current = false;
    setSystemPromptDone(null);
    setSystemPhase('ready');
    pendingSendRef.current = null;
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
    persistentMessages = messages;
    persistentBackend = backend;
  }, [messages, backend]);

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
      persistentLastLoadId += 1;
      const myLoadId = persistentLastLoadId;

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
        const forceReload = localStorage.getItem('forceProfileReload');
        if (forceReload === selectedProfileId) {
          localStorage.removeItem('forceProfileReload');
          // Profile was edited and server restarted — fall through to full reload
        } else {
          const isRunning = await window.electronAPI.chatIsRunning();
          if (isRunning) {
            const { contextSize } = await window.electronAPI.chatContextSize();
            if (contextSize !== null && contextSize > 0) {
              if (!abortController.cancelled && myLoadId === persistentLastLoadId) {
                setMaxTokens(contextSize);
                setLoadError(null);
              }
              return;
            }
          }
          // Server was restarted or not ready — fall through to full reload
        }
      }

      persistentModelLoading = true;
      setModelLoading(true);
      setLoadError(null);
      setUsedTokens(0);
      setMaxTokens(null);
      setMessages([]);
      setBackend(null);
      persistentMessages = [];
      systemMessageInsertedRef.current = false;
      setSystemPromptDone(null);
      pendingSendRef.current = null;
      pendingMedia.forEach((m) => {
        if (m.type === 'video') URL.revokeObjectURL(m.objectUrl);
      });
      setPendingMedia([]);

      if (persistentLoadedProfileId) {
        await unloadModel();
      }

      try {
        if (abortController.cancelled || myLoadId !== persistentLastLoadId) return;

        const res = await window.electronAPI.chatLoadProfile(profile);

        if (abortController.cancelled || myLoadId !== persistentLastLoadId) return;

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
            }
          }
        } else {
          persistentLoadedProfileId = '';
          setLoadError(res.error || 'Failed to load profile');
          await unloadModel();
        }
      } catch (error) {
        persistentLoadedProfileId = '';
        setLoadError(
          error instanceof Error ? error.message : 'Unknown error occurred',
        );
        await unloadModel();
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

      if (loading && usage.used > 0) {
        if (!lastTokenSnapshot.current) {
          lastTokenSnapshot.current = { tokens: usage.used, time: Date.now() };
          if (generationBaselineTokens.current === null) {
            generationBaselineTokens.current = usage.used;
          }
        } else if (usage.used > lastTokenSnapshot.current.tokens) {
          const deltaTokens = usage.used - lastTokenSnapshot.current.tokens;
          const deltaTime =
            (Date.now() - lastTokenSnapshot.current.time) / 1000;
          const instantTps = deltaTime > 0 ? deltaTokens / deltaTime : 0;
          setTps((prev) => 0.3 * instantTps + 0.7 * prev);
          lastTokenSnapshot.current = { tokens: usage.used, time: Date.now() };
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

    const removeDoneListener = window.electronAPI.onChatDone((stats) => {
      pendingSegmentIds = [];

      setLoading(false);
      setProcessing(false);
      setTps(0);
      setProgressPercent(0);
      refreshCumulativeTokens();

      if (stats) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !last.stats) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, stats };
            return updated;
          }
          return prev;
        });
      }
    });

    const removeProgressListener = window.electronAPI.onChatProgress((data) => {
      setProgressPercent(data.progress);
    });

    const removePromptDoneListener = window.electronAPI.onChatPromptDone(
      (promptStats) => {
        if (isReprocessing) {
          isReprocessing = false;
          // This reprompt's promptStats belong to tool segments from the PREVIOUS round
          if (pendingSegmentIds.length > 0) {
            const ids = pendingSegmentIds.splice(0);
            setMessages((prev) => {
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
          }
        } else {
          setMessages((prev) => {
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
      },
    );

    const unsubscribeFunctionCalling = window.electronAPI.onChatFunctionCalling(
      (data) => {
        setMessages((prevMessages) => {
          const updatedMessages = [...prevMessages];
          const lastMessage = updatedMessages[updatedMessages.length - 1];

          const segId = crypto.randomUUID();
          pendingSegmentIds.push(segId);

          const toolSegment: MessageSegment = {
            id: segId,
            text: '',
            type: 'tool',
            toolName: data.name,
            toolStatus: 'calling',
          };

          if (lastMessage?.role === 'assistant') {
            lastMessage.content.push(toolSegment);
          } else {
            const assistantMessage: Message = {
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

    const unsubscribeFunctionCall = window.electronAPI.onChatFunctionCall(
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
              toolSegment.toolParams = data.params;
            }
          }

          return updatedMessages;
        });
      },
    );

    const unsubscribeFunctionResult = window.electronAPI.onChatFunctionResult(
      (data) => {
        isReprocessing = true;
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

    const unsubscribeUserInput = window.electronAPI.onChatUserInput(
      (data) => {
        setUserInputRequest(data);
      },
    );

    const removeSystemProgressListener =
      window.electronAPI.onChatSystemProgress((data) => {
        setSystemPhase('preloading');
        setSystemStatusMessage('Preloading system prompt…');
        setSystemProgress(data.progress);
      });

    const removeSystemStatusListener = window.electronAPI.onChatSystemStatus(
      (data) => {
        setSystemPhase(data.phase);
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
      removeTokenListener();
      removeDoneListener();
      removeProgressListener();
      removePromptDoneListener();
      unsubscribeFunctionCalling();
      unsubscribeFunctionCall();
      unsubscribeFunctionResult();
      unsubscribeUserInput();
      removeSystemProgressListener();
      removeSystemStatusListener();
      removeSystemDoneListener();
    };
  }, [refreshCumulativeTokens]);

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

  // Flush queued message when system prompt preloading completes
  useEffect(() => {
    if (systemPhase === 'ready' && systemPromptDone && pendingSendRef.current) {
      const { text, pendingMedia: queuedMedia } = pendingSendRef.current;
      pendingSendRef.current = null;

      (async () => {
        const contentParts: ContentPart[] = [];
        const mediaItems: MediaDisplayItem[] = [];

        for (const item of queuedMedia) {
          if (item.type === 'image') {
            if (item.name) contentParts.push({ kind: 'text', text: `[${item.name}]` });
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
                contentParts.push({ kind: 'text', text: `[${String(mins).padStart(2, '0')}:${String(secsOnly).padStart(2, '0')}]` });
              });
              mediaItems.push({ type: 'video', url: item.objectUrl });
            } catch {
              return;
            }
          }
        }

        const sysId = messageCounter.current++;
        const userId = messageCounter.current++;
        const segId = segmentCounter.current++;

        const systemMsg: Message = {
          id: sysId,
          role: 'system',
          content: [
            {
              id: `seg-sys-${Date.now()}`,
              text:
                systemPromptDone.toolCount > 0
                  ? `System Prompt with ${systemPromptDone.toolCount} Tools`
                  : 'System Prompt',
              type: 'normal',
            },
          ],
          promptStats: systemPromptDone.stats,
        };

        const userMsg: Message = {
          id: userId,
          role: 'user',
          content: [
            {
              id: `seg-${Date.now()}-${segId}`,
              text,
              type: 'normal',
              mediaItems,
            },
          ],
          collapsed: text.length >= 20 && text.split('\n').length > 5,
        };

        systemMessageInsertedRef.current = true;
        setMessages((prev) => [...prev, systemMsg, userMsg]);
        setLoading(true);
        setProcessing(true);
        setTps(0);
        generationBaselineTokens.current = null;
        lastTokenSnapshot.current = null;

        await window.electronAPI.chatSend(text, contentParts);
      })();
    }
  }, [systemPhase, systemPromptDone]);

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
    if (
      !text ||
      loading ||
      modelLoading ||
      persistentModelLoading ||
      !selectedProfileId ||
      loadError
    )
      return;

    // If system prompt is still preloading, queue the message
    if (systemPhase !== 'ready') {
      pendingSendRef.current = {
        text,
        pendingMedia: [...pendingMedia],
      };
      setPendingMedia([]);
      setInputText('');
      const textarea = document.querySelector('textarea');
      if (textarea) textarea.style.height = 'auto';
      return;
    }

    // Build content parts and media display items from pendingMedia
    const contentParts: ContentPart[] = [];
    const mediaItems: MediaDisplayItem[] = [];
    let videoExtractError: string | null = null;

    setLoading(true);
    setProcessing(true);

    for (const item of pendingMedia) {
      if (item.type === 'image') {
        if (item.name) contentParts.push({ kind: 'text', text: `[${item.name}]` });
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
            contentParts.push({ kind: 'text', text: `[${String(mins).padStart(2, '0')}:${String(secsOnly).padStart(2, '0')}]` });
          });
          mediaItems.push({ type: 'video', url: item.objectUrl });
        } catch (err: any) {
          videoExtractError = err.message;
          URL.revokeObjectURL(item.objectUrl);
          break;
        }
      } else if (item.type === 'document') {
        contentParts.push({ kind: 'text', text: `[${item.name}]\n${item.content}` });
        mediaItems.push({ type: 'document', name: item.name });
      }
    }

    if (videoExtractError) {
      setPendingMedia([]);
      setLoading(false);
      setProcessing(false);
      alert(`Failed to process video: ${videoExtractError}`);
      return;
    }

    setPendingMedia([]);

    const userMessage: Message = {
      id: messageCounter.current,
      role: 'user',
      content: [
        {
          id: `seg-${Date.now()}-${segmentCounter.current}`,
          text,
          type: 'normal',
          mediaItems,
        },
      ],
      collapsed: text.length >= 20 && text.split('\n').length > 5,
    };

    messageCounter.current += 1;
    segmentCounter.current += 1;

    setMessages((prev) => {
      const updated = [...prev];
      if (systemPromptDone && !systemMessageInsertedRef.current) {
        const sysId = messageCounter.current;
        messageCounter.current += 1;
        systemMessageInsertedRef.current = true;
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
      return updated;
    });
    setInputText('');
    isReprocessing = false;
    pendingSegmentIds = [];

    const textarea = document.querySelector('textarea');
    if (textarea) textarea.style.height = 'auto';

    generationBaselineTokens.current = null;
    lastTokenSnapshot.current = null;
    setTps(0);

    await window.electronAPI.chatSend(text, contentParts);
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

      {userInputRequest && (
        <UserInputModal
          type={userInputRequest.type}
          prompt={userInputRequest.prompt}
          options={userInputRequest.options}
          allowOther={userInputRequest.allowOther}
          toolName={userInputRequest.toolName}
          toolParams={userInputRequest.toolParams}
          onResponse={async (response) => {
            setUserInputRequest(null);
            await window.electronAPI.respondToUserInput(response);
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
            {(() => {
              const text = msg.content[0]?.text || '';
              const collapsible = msg.role !== 'user' || text.length >= 20;
              return (
                <div
                  className="chat-message__label"
                  role="button"
                  tabIndex={collapsible ? 0 : undefined}
                  onClick={() => {
                    if (!collapsible) return;
                    setMessages((prev) => {
                      const updated = [...prev];
                      const idx = updated.findIndex((m) => m.id === msg.id);
                      if (idx >= 0) {
                        updated[idx] = {
                          ...updated[idx],
                          collapsed: !updated[idx].collapsed,
                        };
                      }
                      return updated;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (!collapsible) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMessages((prev) => {
                        const updated = [...prev];
                        const idx = updated.findIndex((m) => m.id === msg.id);
                        if (idx >= 0) {
                          updated[idx] = {
                            ...updated[idx],
                            collapsed: !updated[idx].collapsed,
                          };
                        }
                        return updated;
                      });
                    }
                  }}
                >
                  {msg.role === 'user'
                    ? 'You'
                    : msg.role === 'system'
                      ? 'System'
                      : selectedProfile?.name || 'Assistant'}
                  {collapsible && (
                    <ChevronDown
                      size={12}
                      className={`chat-message__label-chevron${msg.collapsed ? ' chat-message__label-chevron--collapsed' : ''}`}
                    />
                  )}
                </div>
              );
            })()}
            {msg.collapsed && msg.role === 'user' ? (
              <div
                className="chat-message__bubble chat-message__bubble--collapsed"
                role="button"
                tabIndex={0}
                onClick={() =>
                  setMessages((prev) => {
                    const updated = [...prev];
                    const idx = updated.findIndex((m) => m.id === msg.id);
                    if (idx >= 0) {
                      updated[idx] = { ...updated[idx], collapsed: false };
                    }
                    return updated;
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setMessages((prev) => {
                      const updated = [...prev];
                      const idx = updated.findIndex((m) => m.id === msg.id);
                      if (idx >= 0) {
                        updated[idx] = { ...updated[idx], collapsed: false };
                      }
                      return updated;
                    });
                  }
                }}
              >
                {(msg.content[0]?.text || '').slice(0, 20)}…
              </div>
            ) : (
              !msg.collapsed && (
                <>
                  {loading &&
                    msg === messages[messages.length - 1] &&
                    msg.role === 'assistant' &&
                    !processing && (
                      <div className="chat-message__indicator-box">
                        <div className="chat-indicator">
                          <div className="chat-indicator__spinner" />
                          <span className="chat-indicator__label">
                            Generating…
                          </span>
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
                              if (
                                currentGroup.length > 0 &&
                                currentStats !== stats
                              ) {
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
                                    />
                                  ))}
                                </div>
                                {group.stats && (
                                  <div className="tool-call-group__stats">
                                    <div
                                      className="chat-stat-item"
                                      title="Prompt tokens"
                                    >
                                      <Hash size={12} />
                                      <span>
                                        {group.stats.tokens} tokens
                                      </span>
                                    </div>
                                    <div
                                      className="chat-stat-item"
                                      title="Prompt processing time"
                                    >
                                      <Timer size={12} />
                                      <span>
                                        {(group.stats.timeMs / 1000).toFixed(2)}s
                                      </span>
                                    </div>
                                    <div
                                      className="chat-stat-item"
                                      title="Prompt processing speed"
                                    >
                                      <Zap size={12} />
                                      <span>
                                        {group.stats.tokensPerSecond.toFixed(1)} t/s
                                      </span>
                                    </div>
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
                                if (seg.type === 'thought' && seg.text.trim().length > 0) {
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
                            const autoCloseDone = settings?.autoCloseThinkingDone ?? false;
                            const thoughtDefaultOpen = autoOpen
                              ? (!autoCloseDone || !thinkingDone)
                              : false;

                            if (hasThought) {
                              const items = buildThoughtItems(batchSegments);
                              elements.push(
                                <MessageContent
                                  key={`batch-${elements.length}-thought-${!!thinkingDone}`}
                                  segments={[]}
                                  thoughtItems={items}
                                  onImageClick={setImageViewerUrl}
                                  defaultOpen={thoughtDefaultOpen}
                                  renderTool={(seg, showInline) => (
                                    <ToolCallSegment
                                      key={seg.id}
                                      segment={seg}
                                      showInlineStats={showInline}
                                    />
                                  )}
                                />,
                              );
                            } else {
                              elements.push(
                                <MessageContent
                                  key={`batch-${elements.length}`}
                                  segments={batchSegments}
                                  onImageClick={setImageViewerUrl}
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
                                  (s) =>
                                    s.type === 'thought' || s.type === 'tool',
                                );

                              if (isInThoughtBatch) {
                                batchSegments.push(segment);
                              } else {
                                flushBatch();
                                standaloneToolBuffer.push(segment);
                              }
                            } else {
                              flushStandaloneTools();
                              if (
                                batchSegments.length > 0 &&
                                segment.type !== 'thought'
                              ) {
                                flushBatch(true);
                              }
                              batchSegments.push(segment);
                            }
                          });

                          flushStandaloneTools();
                          flushBatch();

                          return elements;
                        })()}
                        {loading &&
                          msg === messages[messages.length - 1] &&
                          msg.role === 'assistant' &&
                          processing && (
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
                                onClick={() => setImageViewerUrl(item.url!)}
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
                              <div key={`doc-${idx}`} className="chat-message__user-document">
                                <FileText size={20} />
                                <span className="chat-message__user-document-name">{item.name}</span>
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
            {(msg.role === 'user' || msg.role === 'system') &&
              msg.promptStats && (
                <div className="chat-message__stats">
                  <div className="chat-stat-item" title="Prompt tokens">
                    <Hash size={12} />
                    <span>{msg.promptStats.tokens} tokens</span>
                  </div>
                  <div
                    className="chat-stat-item"
                    title="Prompt processing time"
                  >
                    <Timer size={12} />
                    <span>{(msg.promptStats.timeMs / 1000).toFixed(2)}s</span>
                  </div>
                  <div
                    className="chat-stat-item"
                    title="Prompt processing speed"
                  >
                    <Zap size={12} />
                    <span>
                      {msg.promptStats.tokensPerSecond.toFixed(1)} t/s
                    </span>
                  </div>
                </div>
              )}

            {/* Display generation statistics below assistant responses */}
            {msg.role === 'assistant' && msg.stats && (
              <div className="chat-message__stats">
                <div className="chat-stat-item" title="Tokens generated">
                  <Hash size={12} />
                  <span>{msg.stats.tokens} tokens</span>
                </div>
                <div className="chat-stat-item" title="Generation time">
                  <Timer size={12} />
                  <span>{(msg.stats.timeMs / 1000).toFixed(2)}s</span>
                </div>
                <div className="chat-stat-item" title="Generation speed">
                  <Zap size={12} />
                  <span>{msg.stats.tokensPerSecond.toFixed(1)} t/s</span>
                </div>
              </div>
            )}
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
                    {processing
                      ? `Processing prompt… (${progressPercent}%)`
                      : 'Generating…'}
                  </span>
                </div>
                {processing && (
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

      <div className="chat-input-wrapper">
        <div className="chat-input-row">
          <button
            type="button"
            className="chat-attach-button"
            onClick={() => setShowImageModal(true)}
            title={
              canAttachImages
                ? 'Attach images, videos, or documents'
                : 'Attach documents'
            }
          >
            {canAttachImages ? <ImagePlus size={18} /> : <FilePlusCorner size={18} />}
          </button>

          <div className="chat-input-inner">
            {pendingMedia.length > 0 && (
              <div className="chat-media-preview">
                {pendingMedia.map((item) => (
                  <div key={item.id} className="chat-media-preview__item">
                    {item.type === 'image' && (
                      <img src={item.dataUrl} alt="Attached" className="chat-media-preview__image" />
                    )}
                    {item.type === 'video' && (
                      <video src={item.objectUrl} controls className="chat-media-preview__video" />
                    )}
                    {item.type === 'document' && (
                      <div className="chat-media-preview__document">
                        <FileText size={20} />
                        <span className="chat-media-preview__doc-name">{item.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="chat-media-preview__remove"
                      onClick={() => {
                        if (item.type === 'video') {
                          URL.revokeObjectURL(item.objectUrl);
                        }
                        setPendingMedia((prev) => prev.filter((m) => m.id !== item.id));
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
            />
          </div>

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
                persistentModelLoading ||
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
          <span className="chat-backend-indicator">
            {backend ? formatBackend(backend) : ''}
          </span>
          <span>
            {loading && tps > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginRight: '10px',
                  opacity: 0.75,
                }}
              >
                <Gauge size={13} />
                {tps.toFixed(1)} t/s
              </span>
            )}
            {maxTokens !== null ? (
              <span>
                {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()}{' '}
                tokens
              </span>
            ) : (
              <span>— / — tokens</span>
            )}
          </span>
        </div>
      </div>

      {estimatedCost > 0 && (
        <div className="chat-cost-display">
          {`Estimated savings: $${estimatedCost.toFixed(2)}`}
        </div>
      )}

      {showImageModal && (
        <MediaAttachModal
          onAttach={(dataUrl, name) => {
            const id = crypto.randomUUID();
            setPendingMedia((prev) => [...prev, { id, type: 'image', dataUrl, name }]);
          }}
          onAttachVideo={(file) => {
            const id = crypto.randomUUID();
            setPendingMedia((prev) => [...prev, { id, type: 'video', file, objectUrl: URL.createObjectURL(file) }]);
          }}
          onAttachText={(name, content) => {
            const id = crypto.randomUUID();
            setPendingMedia((prev) => [...prev, { id, type: 'document', name, content }]);
          }}
          onClose={() => setShowImageModal(false)}
          hasProjector={canAttachImages}
        />
      )}

      {imageViewerUrl && (
        <ImageViewer
          imageUrl={imageViewerUrl}
          onClose={() => setImageViewerUrl(null)}
        />
      )}
    </div>
  );
}
