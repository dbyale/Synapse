import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke('settings:save', settings),
  pickDirectory: () => ipcRenderer.invoke('settings:pick-directory'),
  getVramStats: () => ipcRenderer.invoke('get-vram-stats'),
  chatMemoryUsage: (): Promise<{
    modelVramUsage: number;
    contextVramUsage: number;
    modelRamUsage: number;
    contextRamUsage: number;
  } | null> => ipcRenderer.invoke('chat:memoryUsage'),

  // Models
  searchModels: (query: string, filters?: any[], sort?: string, direction?: number, page?: number) =>
    ipcRenderer.invoke('models:search', query, filters, sort, direction, page),
  listModelFiles: (repoId: string) =>
    ipcRenderer.invoke('models:list-files', repoId),

  browseForFiles: (options: {
    title: string;
    filters?: { name: string; extensions: string[] }[];
    multiSelections?: boolean;
  }) => ipcRenderer.invoke('browse-for-files', options),

  registerLocalModel: (payload: {
    name: string;
    modelPaths: string[];
    projectorPaths: string[];
  }) => ipcRenderer.invoke('register-local-model', payload),


  downloadModel: (repoId: string, filename: string) =>
    ipcRenderer.invoke('models:download', repoId, filename),
  cancelDownload: (filename: string) => ipcRenderer.invoke('models:cancel-download', filename),
  listLocalModels: () => ipcRenderer.invoke('models:list-local'),
  deleteModel: (filename: string) =>
    ipcRenderer.invoke('models:delete', filename),

  // Events
  onDownloadProgress: (callback: (progress: any) => void) => {
    // Wrap callback to strip the Electron event object
    const subscription = (_event: IpcRendererEvent, progress: any) =>
      callback(progress);

    ipcRenderer.on('download-progress', subscription);

    // Return an unsubscribe function if needed
    return () => {
      ipcRenderer.removeListener('download-progress', subscription);
    };
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress');
  },

  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),

  // ── Chat API ──
  chatSend: (text: string) => ipcRenderer.invoke('chat:send', text),

  onChatToken: (callback: (data: { token: string; segmentType?: 'thought' | 'comment' }) => void) => {
    const listener = (_: any, data: { token: string; segmentType?: 'thought' | 'comment' }) => callback(data);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },

  onChatDone: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('chat:done', listener);
    return () => ipcRenderer.removeListener('chat:done', listener);
  },

  onChatError: (callback: (error: string) => void) => {
    const listener = (_: any, error: string) => callback(error);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.removeListener('chat:error', listener);
  },

  chatLoad: (filepath: string, systemPrompt?: string) => ipcRenderer.invoke('chat:load', filepath, systemPrompt),
  chatAbort: () => ipcRenderer.invoke('chat:abort'),
  chatUnload: () => ipcRenderer.invoke('chat:unload'),

  removeChatListeners: () => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.removeAllListeners('chat:done');
  },

  chatContextUsage: () => ipcRenderer.invoke('chat:contextUsage'),

  chatTokenize: (text: string): Promise<{ count: number | null }> =>
    ipcRenderer.invoke('chat:tokenize', text),

  chatContextSize: (): Promise<{ contextSize: number | null }> =>
    ipcRenderer.invoke('chat:contextSize'),

  chatUpdateSystemPrompt: (systemPrompt: string) =>
    ipcRenderer.invoke('chat:updateSystemPrompt', systemPrompt),

  chatGetCurrentSystemPrompt: () =>
    ipcRenderer.invoke('chat:getCurrentSystemPrompt'),

  openModelsFolder: () => ipcRenderer.invoke('open-models-folder'),
});
