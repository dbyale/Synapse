import { Profile } from './types/profile';

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
  corsOrigins?: string;
  corsMethods?: string;
  corsHeaders?: string;
  corsCredentials?: boolean;
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
      listLocalModels: () => Promise<LocalModel[]>;
      deleteModel: (filename: string) => Promise<boolean>;
      onDownloadProgress: (
        callback: (progress: DownloadProgress) => void,
      ) => () => void;
      removeDownloadProgressListener: () => void;

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
      chatHasProjector: () => Promise<boolean>;
      chatSend: (
        text: string,
        contentParts?: ContentPart[],
      ) => Promise<{ success: boolean; error?: string; aborted?: boolean }>;
      onChatToken: (
        callback: (data: {
          token: string;
          segmentType?: 'thought' | 'comment';
        }) => void,
      ) => () => void;
      onChatDone: (
        callback: (stats?: {
          tokens: number;
          timeMs: number;
          tokensPerSecond: number;
        }) => void,
      ) => () => void;
      onChatProgress: (
        callback: (data: {
          progress: number;
          promptN: number;
          promptMs: number;
          total: number;
        }) => void,
      ) => () => void;
      onChatPromptDone: (
        callback: (stats: {
          tokens: number;
          timeMs: number;
          tokensPerSecond: number;
        }) => void,
      ) => () => void;
      onChatError: (callback: (error: string) => void) => () => void;
      onChatSystemProgress: (
        callback: (data: {
          progress: number;
          promptN: number;
          promptMs: number;
          total: number;
        }) => void,
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
      chatAbort: () => Promise<void>;
      chatUnload: () => Promise<void>;
      chatHasConversation: () => Promise<boolean>;
      chatIsRunning: () => Promise<boolean>;
      chatReloadProfile: () => Promise<{
        success: boolean;
        error?: string;
        profile?: Profile;
      }>;
      removeChatListeners: () => void;
      chatTokenize: (text: string) => Promise<{ count: number | null }>;
      chatContextUsage: () => Promise<{ used: number; total: number }>;
      chatContextSize: () => Promise<{ contextSize: number | null }>;

      chatCumulativeTokenUsage: () => Promise<{
        totalInputTokens: number;
        totalOutputTokens: number;
      }>;

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

      onChatFunctionCall: (
        callback: (data: { name: string; params: string }) => void,
      ) => () => void;
      onChatFunctionCalling: (
        callback: (data: { name: string; params: string }) => void,
      ) => () => void;
      onChatFunctionResult: (
        callback: (data: { name: string; result: string }) => void,
      ) => () => void;

      readFileAsDataUrl: (filePath: string) => Promise<string>;
      readFileAsBuffer: (filePath: string) => Promise<Uint8Array>;

      convertFileWithMarkitdown: (filePath: string) => Promise<{
        success: boolean;
        markdown?: string;
        error?: string;
      }>;

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
      extensionsList: () => Promise<Array<{
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
        tools: Record<string, {
          meta: { name: string; label: string; description: string; descriptionForHuman?: string; descriptionForModel?: string; icon: string };
          params: Record<string, any>;
        }>;
        enabled: boolean;
        extensionDir?: string;
      }>>;
      extensionsInstall: () => Promise<{ success: boolean; error?: string }>;
      extensionsRemove: (id: string) => Promise<{ success: boolean; error?: string }>;
      extensionsToggle: (id: string, enabled: boolean) => Promise<{ success: boolean }>;
      extensionsGetAllTools: () => Promise<Record<string, {
        meta: { name: string; label: string; description: string; descriptionForHuman?: string; descriptionForModel?: string; icon: string };
        params: Record<string, any>;
      }>>;
      extensionsOpenFolder: () => Promise<void>;
      extensionsGetSettings: (id: string) => Promise<Record<string, any>>;
      extensionsSetSettings: (id: string, settings: Record<string, any>) => Promise<{ success: boolean }>;

      onChatUserInput: (callback: (data: {
        requestId: string;
        type: 'confirm' | 'select' | 'freeform';
        prompt: string;
        options?: string[];
        allowOther?: boolean;
        toolName: string;
        toolParams: any;
      }) => void) => () => void;
      respondToUserInput: (response: {
        action: 'confirmed' | 'denied' | 'selected';
        value?: string;
      }) => Promise<{ success: boolean }>;
    };
  }
}

export interface ContentPart {
  kind: 'image_url' | 'text';
  url?: string;
  text?: string;
}

export {};
