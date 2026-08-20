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
  getBackendInfo: () => ipcRenderer.invoke('onboarding:get-backend-info'),
  getParserInfo: () => ipcRenderer.invoke('onboarding:get-parser-info'),
  downloadBinary: (kind: string, download: unknown, dir: string) =>
    ipcRenderer.invoke('binaries:download', kind, download, dir),
  cancelBinaryDownload: (id: string) =>
    ipcRenderer.invoke('binaries:cancel', id),
  getBinaryDownloads: () => ipcRenderer.invoke('binaries:list'),
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
  resumeDownload: (repoId: string, filename: string) =>
    ipcRenderer.invoke('models:resume-download', repoId, filename),
  deletePartFile: (repoId: string, filename: string) =>
    ipcRenderer.invoke('models:delete-part-file', repoId, filename),
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
  onMenuNavigate: (callback: (path: string) => void) => {
    const subscription = (_event: IpcRendererEvent, path: string) =>
      callback(path);

    ipcRenderer.on('menu:navigate', subscription);

    return () => {
      ipcRenderer.removeListener('menu:navigate', subscription);
    };
  },
  onRestartOnboarding: (callback: () => void) => {
    const subscription = () => callback();

    ipcRenderer.on('onboarding:restart', subscription);

    return () => {
      ipcRenderer.removeListener('onboarding:restart', subscription);
    };
  },
  onCancelOnboarding: (callback: () => void) => {
    const subscription = () => callback();

    ipcRenderer.on('onboarding:cancel', subscription);

    return () => {
      ipcRenderer.removeListener('onboarding:cancel', subscription);
    };
  },
  notifyMenuEditState: (state: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canDelete: boolean;
  }) => ipcRenderer.send('menu:edit-state', state),
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress');
  },

  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),

  // ── Chat API ──
  chatLoadProfile: (profile: any) =>
    ipcRenderer.invoke('chat:loadProfile', profile),
  chatGetCurrentProfile: () => ipcRenderer.invoke('chat:getCurrentProfile'),
  getLaunchArgs: (
    profile: unknown,
    resolved?: { ngl: number; ctx: number } | null,
  ) => ipcRenderer.invoke('chat:getLaunchArgs', profile, resolved),
  chatSend: (
    sessionId: string,
    text: string,
    contentParts?: {
      kind: string;
      url?: string;
      filePath?: string;
      text?: string;
    }[],
    displayItems?: any[],
    thinkingTokens?: number,
  ) =>
    ipcRenderer.invoke(
      'chat:send',
      sessionId,
      text,
      contentParts,
      displayItems,
      thinkingTokens,
    ),
  chatStartSession: (profileId: string, title: string) =>
    ipcRenderer.invoke('chat:startSession', profileId, title),
  chatGetSession: (sessionId: string) =>
    ipcRenderer.invoke('chat:getSession', sessionId),
  chatListSessions: (profileId: string) =>
    ipcRenderer.invoke('chat:listSessions', profileId),
  chatRenameSession: (sessionId: string, title: string) =>
    ipcRenderer.invoke('chat:renameSession', sessionId, title),
  chatDeleteSession: (sessionId: string) =>
    ipcRenderer.invoke('chat:deleteSession', sessionId),
  chatRespondInput: (sessionId: string, response: any) =>
    ipcRenderer.invoke('chat:respond-input', sessionId, response),
  chatAbort: (sessionId?: string | null) =>
    ipcRenderer.invoke('chat:abort', sessionId),
  chatUnload: () => ipcRenderer.invoke('chat:unload'),
  chatHasConversation: () => ipcRenderer.invoke('chat:hasConversation'),
  chatIsRunning: () => ipcRenderer.invoke('chat:isRunning'),
  chatReloadProfile: () => ipcRenderer.invoke('chat:reloadProfile'),

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

  onChatStreamEvent: (callback: (payload: any) => void) => {
    const listener = (_event: IpcRendererEvent, payload: any) =>
      callback(payload);
    ipcRenderer.on('chat:stream-event', listener);
    return () => ipcRenderer.removeListener('chat:stream-event', listener);
  },

  removeChatListeners: () => {
    ipcRenderer.removeAllListeners('chat:stream-event');
  },

  chatContextUsage: () => ipcRenderer.invoke('chat:contextUsage'),

  chatTokenize: (text: string): Promise<{ count: number | null }> =>
    ipcRenderer.invoke('chat:tokenize', text),

  chatContextSize: (): Promise<{ contextSize: number | null }> =>
    ipcRenderer.invoke('chat:contextSize'),

  openModelsFolder: () => ipcRenderer.invoke('open-models-folder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (filePath: string) =>
    ipcRenderer.invoke('shell:openPath', filePath),

  chatCumulativeTokenUsage: (): Promise<{
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
  }> => ipcRenderer.invoke('chat:cumulativeTokenUsage'),

  usageSetLastOpenedMonth: (monthId: string | null): Promise<void> =>
    ipcRenderer.invoke('usage:setLastOpenedMonth', monthId),

  chatHasProjector: (): Promise<boolean> =>
    ipcRenderer.invoke('chat:hasProjector'),

  readFileAsDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('files:readFileAsDataUrl', filePath),

  readFileAsBuffer: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('files:readFileAsBuffer', filePath),

  convertFileWithMarkitdown: (
    filePath: string,
  ): Promise<{
    success: boolean;
    markdown?: string;
    error?: string;
  }> => ipcRenderer.invoke('files:convertWithMarkitdown', filePath),

  saveBufferToTemp: (buffer: Uint8Array, filename: string): Promise<string> =>
    ipcRenderer.invoke('files:saveBufferToTemp', buffer, filename),

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
    flashAttn?: 'on' | 'off' | 'auto';
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
    flashAttn?: 'on' | 'off' | 'auto';
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

  // ── Extensions ──
  extensionsList: () => ipcRenderer.invoke('extensions:list'),
  extensionsInstall: () => ipcRenderer.invoke('extensions:install'),
  extensionsRemove: (id: string) => ipcRenderer.invoke('extensions:remove', id),
  extensionsToggle: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('extensions:toggle', id, enabled),
  extensionsGetAllTools: () => ipcRenderer.invoke('extensions:getAllTools'),
  extensionsOpenFolder: () => ipcRenderer.invoke('extensions:openFolder'),
  extensionsGetSettings: (id: string) =>
    ipcRenderer.invoke('extensions:getSettings', id),
  extensionsSetSettings: (id: string, settings: any) =>
    ipcRenderer.invoke('extensions:setSettings', id, settings),
});
