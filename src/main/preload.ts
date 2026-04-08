import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke('settings:save', settings),
  pickDirectory: () => ipcRenderer.invoke('settings:pick-directory'),
  getVramStats: () => ipcRenderer.invoke('get-vram-stats'),

  // Models
  searchModels: (query: string, filters?: any[], sort?: string, direction?: number, page?: number) =>
    ipcRenderer.invoke('models:search', query, filters, sort, direction, page),
  listModelFiles: (repoId: string) =>
    ipcRenderer.invoke('models:list-files', repoId),
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
  chatLoad: (filepath: string) => ipcRenderer.invoke('chat:load', filepath),
  chatSend: (text: string) => ipcRenderer.invoke('chat:send', text),
  chatAbort: () => ipcRenderer.invoke('chat:abort'),
  chatUnload: () => ipcRenderer.invoke('chat:unload'),

  onChatToken: (callback: (token: string) => void) => {
    const listener = (_event: IpcRendererEvent, token: string) => callback(token);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },
  onChatDone: (callback: () => void) => {
    const listener = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('chat:done', listener);
    return () => ipcRenderer.removeListener('chat:done', listener);
  },
  removeChatListeners: () => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.removeAllListeners('chat:done');
  }
});
