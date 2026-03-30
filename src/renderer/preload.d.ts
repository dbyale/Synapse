export interface DownloadProgress {
  modelId: string;
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface ProfileSettings {
  name: string;
  modelsDirectory: string;
  defaultModel: string;
  contextSize: number;
  gpuLayers: number;
}

export interface AppSettings {
  modelsDirectory: string;
  activeProfile: string;
  profiles: Record<string, ProfileSettings>;
}

export interface ModelSearchResult {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  lastModified: string;
}

export interface LocalModel {
  filename: string;
  filepath: string;
  sizeBytes: number;
  lastModified: string;
}

declare global {
  interface Window {
    electronAPI: {
      loadSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<boolean>;
      pickDirectory: () => Promise<string | null>;
      searchModels: (query: string) => Promise<ModelSearchResult[]>;
      listModelFiles: (repoId: string) => Promise<string[]>;
      downloadModel: (repoId: string, filename: string) => Promise<string>;
      listLocalModels: () => Promise<LocalModel[]>;
      deleteModel: (filename: string) => Promise<boolean>;
      onDownloadProgress: (
        callback: (progress: DownloadProgress) => void
      ) => void;
      removeDownloadProgressListener: () => void;
    };
  }
}
