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

export interface LocalModel {
  filename: string;
  filepath: string;
  sizeBytes: number;
  lastModified: string;
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

declare global {
  interface Window {
    electronAPI: {
      loadSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<boolean>;
      pickDirectory: () => Promise<string | null>;
      searchModels: (
        query: string,
        filters: SearchFilter[],
        sort: string,
        direction: number,
        limit: number
      ) => Promise<ModelSearchResult[]>;
      listModelFiles: (repoId: string) => Promise<RemoteModelFile[]>;
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
