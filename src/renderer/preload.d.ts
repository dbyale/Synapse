import { Profile } from './types/profile';
import type {
  SavedSession,
  SessionView,
  ChatStreamEvent,
} from '../shared/chatTypes';

export interface DownloadProgress {
  modelId: string;
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  status?: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

export interface LocalModel {
  filename: string;
  filepath: string;
  sizeBytes: number;
  lastModified: string;
  generalName: string;
  quantization: string;
  isProjector: boolean;
}

export interface SearchFilter {
  id: string;
  label: string;
  type: 'library' | 'pipeline_tag' | 'tag' | 'author' | 'language';
}

export interface ModelSearchResult {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  trendingScore: number;
  lastModified: string;
  pipelineTag: string;
  parameters: string | null;
  tags: string[];
}

export interface RemoteModelFile {
  filename: string;
  sizeBytes: number;
  quantization: string;
  bits: number;
}

export interface SystemMemStats {
  total: number;
  appCurrentUsage: number;
  otherUsed: number;
}

export interface GpuMemStats {
  isUnifiedMemory: boolean;
  total?: number;
  otherUsed?: number;
  maxRecommended?: number;
}

export interface AppSettings {
  modelsDirectory: string;
  allocatedVRAM?: number;
  allocatedRAM?: number;
  autoOpenThinking?: boolean;
  autoCloseThinkingDone?: boolean;
  host?: string;
  port?: number;
  corsOrigins?: string;
  corsMethods?: string;
  corsHeaders?: string;
  corsCredentials?: boolean;
  disableExternalReadmes?: boolean;
}

export interface HardwareGpuInfo {
  id: string;
  vendor: string;
  model: string;
  bus: string;
  vram: number;
  vramDynamic: boolean;
  driverVersion: string;
  busAddress: string;
}

export interface HardwareRamStats {
  total: number;
  appCurrentUsage: number;
  otherUsed: number;
  maxRecommended: number;
}

export interface HardwareVramStats {
  total: number;
  otherUsed: number;
  maxRecommended: number;
}

export interface HardwareStats {
  isUnifiedMemory: boolean;
  ram: HardwareRamStats;
  vram: HardwareVramStats | null;
  gpus: HardwareGpuInfo[];
  selectedGpu: HardwareGpuInfo | null;
}

declare global {
  interface Window {
    electronAPI: {
      // Search & Models
      searchModels: (
        query: string,
        filters?: SearchFilter[],
        sort?: string,
        direction?: number,
        limit?: number,
      ) => Promise<ModelSearchResult[]>;
      listModelFiles: (repoId: string) => Promise<RemoteModelFile[]>;
      downloadModel: (repoId: string, filename: string) => Promise<string>;
      cancelDownload: (repoId: string, filename: string) => Promise<boolean>;
      resumeDownload: (repoId: string, filename: string) => Promise<string>;
      deletePartFile: (repoId: string, filename: string) => Promise<boolean>;
      listLocalModels: () => Promise<LocalModel[]>;
      deleteModel: (filename: string) => Promise<boolean>;
      onDownloadProgress: (
        callback: (progress: DownloadProgress) => void,
      ) => () => void;
      removeDownloadProgressListener: () => void;
      onMenuNavigate: (callback: (path: string) => void) => () => void;
      onRestartOnboarding: (callback: () => void) => () => void;
      notifyMenuEditState: (state: {
        canCopy: boolean;
        canCut: boolean;
        canPaste: boolean;
        canDelete: boolean;
      }) => void;

      // Settings & Hardware
      getMemoryStats: () => Promise<SystemMemStats>;
      getVramStats: () => Promise<HardwareStats>;
      chatMemoryUsage: () => Promise<{
        modelVramUsage: number;
        contextVramUsage: number;
        modelRamUsage: number;
        contextRamUsage: number;
      } | null>;
      getServerPid: () => Promise<number | null>;
      loadSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<void>;
      saveSettingsSilent: (settings: AppSettings) => Promise<void>;
      pickDirectory: () => Promise<string | null>;

      // Chat
      chatLoadProfile: (profile: Profile) => Promise<{
        success: boolean;
        error?: string;
        profile?: Profile;
        backend?: string;
      }>;
      chatGetCurrentProfile: () => Promise<Profile | null>;
      getLaunchArgs: (
        profile: Partial<Profile>,
        resolved?: { ngl: number; ctx: number } | null,
      ) => Promise<string[] | null>;
      chatHasProjector: () => Promise<boolean>;
      chatSend: (
        sessionId: string,
        text: string,
        contentParts?: ContentPart[],
        displayItems?: any[],
        thinkingTokens?: number,
      ) => Promise<{ success: boolean; error?: string }>;
      chatStartSession: (profileId: string, title: string) => Promise<string>;
      chatGetSession: (sessionId: string) => Promise<SessionView | null>;
      chatListSessions: (profileId: string) => Promise<SavedSession[]>;
      chatRenameSession: (sessionId: string, title: string) => Promise<void>;
      chatDeleteSession: (sessionId: string) => Promise<{ success: boolean }>;
      chatRespondInput: (
        sessionId: string,
        response: {
          action: 'confirmed' | 'denied' | 'selected';
          value?: string;
        },
      ) => Promise<{ success: boolean }>;
      onChatStreamEvent: (
        callback: (payload: ChatStreamEvent) => void,
      ) => () => void;
      chatAbort: (sessionId?: string | null) => Promise<void>;
      chatUnload: () => Promise<void>;
      chatHasConversation: () => Promise<boolean>;
      chatIsRunning: () => Promise<boolean>;
      chatReloadProfile: () => Promise<{
        success: boolean;
        error?: string;
        profile?: Profile;
      }>;
      onChatSystemProgress: (
        callback: (data: {
          progress: number;
          promptN: number;
          promptMs: number;
          total: number;
        }) => void,
      ) => () => void;
      onChatSystemStatus: (
        callback: (data: { phase: string; message: string }) => void,
      ) => () => void;
      onChatSystemDone: (
        callback: (data: {
          stats: {
            tokens: number;
            timeMs: number;
            tokensPerSecond: number;
          };
          toolCount: number;
        }) => void,
      ) => () => void;
      removeChatListeners: () => void;
      chatTokenize: (text: string) => Promise<{ count: number | null }>;
      chatContextUsage: () => Promise<{ used: number; total: number }>;
      chatContextSize: () => Promise<{ contextSize: number | null }>;

      chatCumulativeTokenUsage: () => Promise<{
        totalInputTokens: number;
        totalOutputTokens: number;
        totalWebSearches: number;
        lastAutoOpenedMonthId: string | null;
        monthly: Record<
          string,
          {
            totalInputTokens: number;
            totalOutputTokens: number;
            totalWebSearches: number;
          }
        >;
      }>;
      usageSetLastOpenedMonth: (monthId: string | null) => Promise<void>;

      browseForFiles: (options: {
        title: string;
        filters?: { name: string; extensions: string[] }[];
        multiSelections?: boolean;
      }) => Promise<string[]>;

      registerLocalModel: (payload: {
        name: string;
        author: string;
        modelPaths: string[];
        projectorPaths: string[];
      }) => Promise<{ success: boolean; message?: string }>;

      openModelsFolder: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      openPath: (filePath: string) => Promise<void>;

      readFileAsDataUrl: (filePath: string) => Promise<string>;
      readFileAsBuffer: (filePath: string) => Promise<Uint8Array>;

      convertFileWithMarkitdown: (filePath: string) => Promise<{
        success: boolean;
        markdown?: string;
        error?: string;
      }>;

      saveBufferToTemp: (
        buffer: Uint8Array,
        filename: string,
      ) => Promise<string>;

      getModelMetadata: (params: {
        modelAuthor: string;
        modelFolder: string;
        modelFilename: string;
        projectorFilename?: string;
        parallel?: number;
      }) => Promise<{ maxLayers: number; maxContext: number } | null>;

      runProfileOptimizer: (params: {
        modelAuthor: string;
        modelFolder: string;
        modelFilename: string;
        projectorFilename?: string;
        mode: 'longest-context' | 'most-gpu';
        kvOffload?: boolean;
        flashAttn?: 'on' | 'off' | 'auto';
        mmap?: boolean;
        cacheTypeK?: string;
        cacheTypeV?: string;
        parallel?: number;
      }) => Promise<{
        ngl: number;
        ctx: number;
        vramMB: number;
        ramMB: number;
      }>;

      estimateMemory: (params: {
        modelAuthor: string;
        modelFolder: string;
        modelFilename: string;
        projectorFilename?: string;
        ngl: number;
        ctx: number;
        kvOffload?: boolean;
        flashAttn?: 'on' | 'off' | 'auto';
        mmap?: boolean;
        cacheTypeK?: string;
        cacheTypeV?: string;
        parallel?: number;
      }) => Promise<{
        modelVramUsage: number;
        contextVramUsage: number;
        computeOverheadVram: number;
        modelRamUsage: number;
        contextRamUsage: number;
        computeOverheadRam: number;
        fileBufferRam: number;
      }>;

      // ── Extensions API ──
      extensionsList: () => Promise<
        Array<{
          manifest: {
            id: string;
            name: string;
            description: string;
            author: string;
            version: string;
            icon: string;
            builtIn: boolean;
            iconSvgData?: string;
          };
          tools: Record<
            string,
            {
              meta: {
                name: string;
                label: string;
                description: string;
                descriptionForHuman?: string;
                descriptionForModel?: string;
                icon: string;
                displayType?: string;
                tags?: string[];
              };
              params: Record<string, any>;
            }
          >;
          enabled: boolean;
          extensionDir?: string;
        }>
      >;
      extensionsInstall: () => Promise<{ success: boolean; error?: string }>;
      extensionsRemove: (
        id: string,
      ) => Promise<{ success: boolean; error?: string }>;
      extensionsToggle: (
        id: string,
        enabled: boolean,
      ) => Promise<{ success: boolean }>;
      extensionsGetAllTools: () => Promise<
        Record<
          string,
          {
            meta: {
              name: string;
              label: string;
              description: string;
              descriptionForHuman?: string;
              descriptionForModel?: string;
              icon: string;
              displayType?: string;
              tags?: string[];
            };
            params: Record<string, any>;
          }
        >
      >;
      extensionsOpenFolder: () => Promise<void>;
      extensionsGetSettings: (id: string) => Promise<Record<string, any>>;
      extensionsSetSettings: (
        id: string,
        settings: Record<string, any>,
      ) => Promise<{ success: boolean }>;
    };
  }
}

export interface ContentPart {
  kind: 'image_url' | 'text';
  url?: string;
  text?: string;
}

export {};
