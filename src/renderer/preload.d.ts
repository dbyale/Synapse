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

import { Profile } from "./types/profile";

declare global {
  interface Window {
    electronAPI: {
      // Search & Models
      searchModels: (
        query: string,
        filters?: SearchFilter[],
        sort?: string,
        direction?: number,
        limit?: number
      ) => Promise<ModelSearchResult[]>;
      listModelFiles: (repoId: string) => Promise<RemoteModelFile[]>;
      downloadModel: (repoId: string, filename: string) => Promise<string>;
      cancelDownload: (filename: string) => Promise<boolean>;
      listLocalModels: () => Promise<LocalModel[]>;
      deleteModel: (filename: string) => Promise<boolean>;
      onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
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
      loadSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<void>;
      pickDirectory: () => Promise<string | null>;

      // Chat
      chatLoadProfile: (profile: Profile) => Promise<{ success: boolean; error?: string }>;
      chatGetCurrentProfile: () => Promise<Profile | null>;
      chatSend: (text: string) => Promise<{ success: boolean; error?: string; aborted?: boolean }>;
      onChatToken: (callback: (data: { token: string; segmentType?: 'thought' | 'comment' }) => void) => () => void;
      onChatDone: (callback: () => void) => () => void;
      onChatError: (callback: (error: string) => void) => () => void;
      chatAbort: () => Promise<void>;
      chatUnload: () => Promise<void>;
      removeChatListeners: () => void;
      chatTokenize: (text: string) => Promise<{ count: number | null }>;
      chatContextUsage: () => Promise<{ used: number; total: number }>;
      chatContextSize: () => Promise<{ contextSize: number | null }>;

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
    };
  }
}

export {};
