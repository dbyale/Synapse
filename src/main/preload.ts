import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke('settings:save', settings),
  saveSettingsSilent: (settings: unknown) =>
    ipcRenderer.invoke('settings:save-silent', settings),
  pickDirectory: () => ipcRenderer.invoke('settings:pick-directory'),
  getVramStats: () => ipcRenderer.invoke('get-vram-stats'),
  chatMemoryUsage: (): Promise<{
    modelVramUsage: number;
    contextVramUsage: number;
    modelRamUsage: number;
    contextRamUsage: number;
  } | null> => ipcRenderer.invoke('chat:memoryUsage'),
  getServerPid: (): Promise<number | null> =>
    ipcRenderer.invoke('get-server-pid'),

  // Models
  searchModels: (
    query: string,
    filters?: any[],
    sort?: string,
    direction?: number,
    page?: number,
  ) =>
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
  cancelDownload: (repoId: string, filename: string) =>
    ipcRenderer.invoke('models:cancel-download', repoId, filename),
  listLocalModels: () => ipcRenderer.invoke('models:list-local'),
  deleteModel: (filename: string) =>
    ipcRenderer.invoke('models:delete', filename),

  // Events
  onDownloadProgress: (callback: (progress: any) => void) => {
    const subscription = (_event: IpcRendererEvent, progress: any) =>
      callback(progress);

    ipcRenderer.on('download-progress', subscription);

    return () => {
      ipcRenderer.removeListener('download-progress', subscription);
    };
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress');
  },

  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),

  // ── Chat API ──
  chatLoadProfile: (profile: any) =>
    ipcRenderer.invoke('chat:loadProfile', profile),
  chatGetCurrentProfile: () => ipcRenderer.invoke('chat:getCurrentProfile'),
  chatSend: (text: string, mediaDataUrls?: string[]) =>
    ipcRenderer.invoke('chat:send', text, mediaDataUrls),

  onChatToken: (
    callback: (data: {
      token: string;
      segmentType?: 'thought' | 'comment';
    }) => void,
  ) => {
    const listener = (
      _: any,
      data: { token: string; segmentType?: 'thought' | 'comment' },
    ) => callback(data);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },

  onChatDone: (
    callback: (stats?: {
      tokens: number;
      timeMs: number;
      tokensPerSecond: number;
    }) => void,
  ) => {
    const listener = (_event: any, stats?: any) => callback(stats);
    ipcRenderer.on('chat:done', listener);
    return () => ipcRenderer.removeListener('chat:done', listener);
  },

  onChatProgress: (
    callback: (data: {
      progress: number;
      promptN: number;
      promptMs: number;
      total: number;
    }) => void,
  ) => {
    const listener = (
      _event: any,
      data: {
        progress: number;
        promptN: number;
        promptMs: number;
        total: number;
      },
    ) => callback(data);
    ipcRenderer.on('chat:progress', listener);
    return () => ipcRenderer.removeListener('chat:progress', listener);
  },

  onChatPromptDone: (
    callback: (stats: {
      tokens: number;
      timeMs: number;
      tokensPerSecond: number;
    }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      stats: { tokens: number; timeMs: number; tokensPerSecond: number },
    ) => callback(stats);
    ipcRenderer.on('chat:prompt-done', listener);
    return () => ipcRenderer.removeListener('chat:prompt-done', listener);
  },

  onChatSystemProgress: (
    callback: (data: {
      progress: number;
      promptN: number;
      promptMs: number;
      total: number;
    }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      data: {
        progress: number;
        promptN: number;
        promptMs: number;
        total: number;
      },
    ) => callback(data);
    ipcRenderer.on('chat:system-progress', listener);
    return () => ipcRenderer.removeListener('chat:system-progress', listener);
  },

  onChatSystemDone: (
    callback: (data: {
      stats: { tokens: number; timeMs: number; tokensPerSecond: number };
      toolCount: number;
    }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      data: {
        stats: { tokens: number; timeMs: number; tokensPerSecond: number };
        toolCount: number;
      },
    ) => callback(data);
    ipcRenderer.on('chat:system-done', listener);
    return () => ipcRenderer.removeListener('chat:system-done', listener);
  },

  onChatSystemStatus: (
    callback: (data: { phase: string; message: string }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { phase: string; message: string },
    ) => callback(data);
    ipcRenderer.on('chat:system-status', listener);
    return () => ipcRenderer.removeListener('chat:system-status', listener);
  },

  onChatError: (callback: (error: string) => void) => {
    const listener = (_: any, error: string) => callback(error);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.removeListener('chat:error', listener);
  },

  chatAbort: () => ipcRenderer.invoke('chat:abort'),
  chatUnload: () => ipcRenderer.invoke('chat:unload'),
  chatHasConversation: () => ipcRenderer.invoke('chat:hasConversation'),
  chatIsRunning: () => ipcRenderer.invoke('chat:isRunning'),
  chatReloadProfile: () => ipcRenderer.invoke('chat:reloadProfile'),

  removeChatListeners: () => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.removeAllListeners('chat:done');
    ipcRenderer.removeAllListeners('chat:progress');
    ipcRenderer.removeAllListeners('chat:prompt-done');
  },

  chatContextUsage: () => ipcRenderer.invoke('chat:contextUsage'),

  chatTokenize: (text: string): Promise<{ count: number | null }> =>
    ipcRenderer.invoke('chat:tokenize', text),

  chatContextSize: (): Promise<{ contextSize: number | null }> =>
    ipcRenderer.invoke('chat:contextSize'),

  openModelsFolder: () => ipcRenderer.invoke('open-models-folder'),

  onChatFunctionCall: (
    callback: (data: { name: string; params: string }) => void,
  ) => {
    const listener = (_: any, data: { name: string; params: string }) =>
      callback(data);
    ipcRenderer.on('chat-function-call', listener);
    return () => ipcRenderer.removeListener('chat-function-call', listener);
  },

  onChatFunctionCalling: (callback: (data: { name: string }) => void) => {
    const listener = (_: any, data: { name: string }) => callback(data);
    ipcRenderer.on('chat-function-calling', listener);
    return () => ipcRenderer.removeListener('chat-function-calling', listener);
  },

  onChatFunctionResult: (
    callback: (data: { name: string; result: string }) => void,
  ) => {
    const listener = (_: any, data: { name: string; result: string }) =>
      callback(data);
    ipcRenderer.on('chat-function-result', listener);
    return () => ipcRenderer.removeListener('chat-function-result', listener);
  },

  chatCumulativeTokenUsage: (): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
  }> => ipcRenderer.invoke('chat:cumulativeTokenUsage'),

  chatHasProjector: (): Promise<boolean> =>
    ipcRenderer.invoke('chat:hasProjector'),

  readFileAsDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('files:readFileAsDataUrl', filePath),

  readFileAsBuffer: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('files:readFileAsBuffer', filePath),

  getModelMetadata: (params: {
    modelAuthor: string;
    modelFolder: string;
    modelFilename: string;
    projectorFilename?: string;
  }): Promise<{ maxLayers: number; maxContext: number } | null> =>
    ipcRenderer.invoke('profile:getModelMetadata', params),

  runProfileOptimizer: (params: {
    modelAuthor: string;
    modelFolder: string;
    modelFilename: string;
    projectorFilename?: string;
    mode: 'longest-context' | 'most-gpu';
    kvOffload?: boolean;
    mmap?: boolean;
    cacheTypeK?: string;
    cacheTypeV?: string;
  }): Promise<{ ngl: number; ctx: number; vramMB: number; ramMB: number }> =>
    ipcRenderer.invoke('profile:runOptimizer', params),

  estimateMemory: (params: {
    modelAuthor: string;
    modelFolder: string;
    modelFilename: string;
    projectorFilename?: string;
    ngl: number;
    ctx: number;
    kvOffload?: boolean;
    mmap?: boolean;
    cacheTypeK?: string;
    cacheTypeV?: string;
  }): Promise<{
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
  }> => ipcRenderer.invoke('profile:estimateMemory', params),
});
