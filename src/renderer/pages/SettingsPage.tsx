import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  SlidersHorizontal,
  MessageSquare,
  Server,
  ShieldCog,
} from 'lucide-react';
import type { AppSettings, HardwareStats } from '../preload.d';
import InfoTooltip from '../components/InfoTooltip';
import {
  MODELS_DIR_TOOLTIP,
  BACKEND_DIR_TOOLTIP,
  PARSER_DIR_TOOLTIP,
  MEMORY_ALLOCATOR_TOOLTIP,
  MAX_LABEL_TOOLTIP,
  RAM_LABEL_TOOLTIP,
  VRAM_LABEL_TOOLTIP,
  MODEL_WEIGHTS_TOOLTIP,
  KV_CACHE_MEM_TOOLTIP,
  COMPUTE_OVERHEAD_TOOLTIP,
  FILE_BUFFER_TOOLTIP,
  CORS_ORIGINS_TOOLTIP,
  CORS_METHODS_TOOLTIP,
  CORS_HEADERS_TOOLTIP,
  CORS_CREDENTIALS_TOOLTIP,
  HOST_TOOLTIP,
  PORT_TOOLTIP,
} from '../utils/tooltipContent';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/SettingsPage.css';
import { MemorySlider } from '../components/settingsShared/MemorySlider';
import { useHardwareStats } from '../components/settingsShared/useHardwareStats';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  );

  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [tab, setTab] = useState<'system' | 'chat' | 'security' | 'server'>(
    'chat',
  );

  const savedAllocationsRef = useRef<{
    allocatedRAM?: number;
    allocatedVRAM?: number;
  }>({});

  const {
    hardware,
    ramLoading,
    gpuLoading,
    ramStats,
    vramStats,
    setRamStats,
    setVramStats,
    showVramSection,
    ramTitle,
    vramTitle,
    fetchHardware,
  } = useHardwareStats(savedAllocationsRef);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const loaded = await window.electronAPI.loadSettings();
        if (!mounted) return;

        const normalized: AppSettings = {
          modelsDirectory: loaded?.modelsDirectory || '',
          backendDirectory: loaded?.backendDirectory || '',
          parserDirectory: loaded?.parserDirectory || '',
          customBinaryPaths: loaded?.customBinaryPaths ?? [],
          parserCustomBinaryPaths: loaded?.parserCustomBinaryPaths ?? [],
          backendDownloads: loaded?.backendDownloads ?? [],
          parserDownloads: loaded?.parserDownloads ?? null,
          selectedBackend: loaded?.selectedBackend ?? 'Default',
          openvinoDevice: loaded?.openvinoDevice ?? 'CPU',
          openvinoStateful: loaded?.openvinoStateful ?? false,
          allocatedRAM: loaded?.allocatedRAM,
          allocatedVRAM: loaded?.allocatedVRAM,
          autoOpenThinking: loaded?.autoOpenThinking ?? true,
          autoCloseThinkingDone: loaded?.autoCloseThinkingDone ?? true,
          corsOrigins: loaded?.corsOrigins ?? 'localhost',
          corsMethods: loaded?.corsMethods ?? '',
          corsHeaders: loaded?.corsHeaders ?? '',
          corsCredentials: loaded?.corsCredentials ?? true,
          disableExternalReadmes: loaded?.disableExternalReadmes ?? false,
          launchServerAutomatically: loaded?.launchServerAutomatically ?? true,
          host: loaded?.host ?? '127.0.0.1',
          port: loaded?.port ?? 9931,
        };

        savedAllocationsRef.current = {
          allocatedRAM: normalized.allocatedRAM,
          allocatedVRAM: normalized.allocatedVRAM,
        };

        setSettings(normalized);
      } catch {
        // Silently fail
      }

      if (mounted) {
        // Detect RAM/VRAM in background — do not block page/tab rendering.
        // The RAM bar shows "Detecting hardware…" via ramLoading until resolved.
        // VRAM bar stays hidden until resolved (see showVramSection).
        fetchHardware().catch(() => {});
      }
    }

    init().catch(() => {});

    return () => {
      mounted = false;
    };
  }, [fetchHardware]);

  const triggerSave = async (overrides: Partial<AppSettings> = {}) => {
    if (!settings) return;

    setSaveStatus('saving');
    try {
      const payload: AppSettings = {
        ...settings,
        allocatedRAM: ramStats.appAllocated,
        ...overrides,
      };

      if (vramStats.total > 0) {
        payload.allocatedVRAM =
          overrides.allocatedVRAM ?? vramStats.appAllocated;
      } else {
        delete payload.allocatedVRAM;
      }

      const isMemChange =
        'allocatedRAM' in overrides || 'allocatedVRAM' in overrides;
      let shouldPrompt = false;
      if (isMemChange) {
        const currentProfile = await window.electronAPI.chatGetCurrentProfile();
        shouldPrompt =
          currentProfile !== null && currentProfile.autoOptimizer !== 'custom';
      }

      if (shouldPrompt) {
        const isRunning = await window.electronAPI.chatIsRunning();
        const hasConv = await window.electronAPI.chatHasConversation();
        if (isRunning && hasConv) {
          await window.electronAPI.saveSettingsSilent(payload);
          setShowRestartDialog(true);
        } else {
          await window.electronAPI.saveSettings(payload);
        }
      } else {
        await window.electronAPI.saveSettingsSilent(payload);
      }

      savedAllocationsRef.current = {
        allocatedRAM: payload.allocatedRAM,
        allocatedVRAM: payload.allocatedVRAM,
      };

      setSettings(payload);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  };

  const handleRestartNow = async () => {
    setShowRestartDialog(false);
    try {
      await window.electronAPI.chatReloadProfile();
    } catch {
      // Silently fail
    }
  };

  const handleKeepConversation = () => {
    setShowRestartDialog(false);
  };

  async function handlePickDirectory() {
    if (!settings) return;

    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir && dir !== settings.modelsDirectory) {
        setSettings((prev) =>
          prev ? { ...prev, modelsDirectory: dir } : prev,
        );
        triggerSave({ modelsDirectory: dir });
      }
    } catch {
      // Silently fail
    }
  }

  async function handlePickBackendDirectory() {
    if (!settings) return;

    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir && dir !== settings.backendDirectory) {
        setSettings((prev) =>
          prev ? { ...prev, backendDirectory: dir } : prev,
        );
        triggerSave({ backendDirectory: dir });
      }
    } catch {
      // Silently fail
    }
  }

  async function handlePickParserDirectory() {
    if (!settings) return;

    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir && dir !== settings.parserDirectory) {
        setSettings((prev) =>
          prev ? { ...prev, parserDirectory: dir } : prev,
        );
        triggerSave({ parserDirectory: dir });
      }
    } catch {
      // Silently fail
    }
  }



  if (!settings) {
    return null;
  }

  return (
    <div className="settings-page">
      <div className="settings-header-row">
        <h1 className="settings-heading">Settings</h1>
        {saveStatus === 'saved' && (
          <div className="settings-saved-indicator">
            <CheckCircle2 size={16} /> Auto-saved
          </div>
        )}
      </div>

      <div className="settings-tabs">
        <button
          type="button"
          className={`settings-tab ${tab === 'chat' ? 'settings-tab--active' : ''}`}
          onClick={() => setTab('chat')}
        >
          <MessageSquare size={16} /> Chat
        </button>
        <button
          type="button"
          className={`settings-tab ${tab === 'system' ? 'settings-tab--active' : ''}`}
          onClick={() => setTab('system')}
        >
          <SlidersHorizontal size={16} /> System
        </button>
        <button
          type="button"
          className={`settings-tab ${tab === 'security' ? 'settings-tab--active' : ''}`}
          onClick={() => setTab('security')}
        >
          <ShieldCog size={16} /> Security
        </button>
        <button
          type="button"
          className={`settings-tab ${tab === 'server' ? 'settings-tab--active' : ''}`}
          onClick={() => setTab('server')}
        >
          <Server size={16} /> Server
        </button>
      </div>

      {tab === 'system' && (
        <>
          <div className="settings-card">
            <InfoTooltip
              content={MEMORY_ALLOCATOR_TOOLTIP}
              side="right"
              hideIcon
              title="System Resource Allocator"
              className="mem-title-tooltip"
            >
              <h2 className="settings-card-title">System Resource Allocator</h2>
            </InfoTooltip>

            <MemorySlider
              title={ramTitle}
              stats={ramStats}
              onChange={(newVal) =>
                setRamStats((prev) => ({ ...prev, appAllocated: newVal }))
              }
              onSave={(newVal) => triggerSave({ allocatedRAM: newVal })}
              onRefresh={fetchHardware}
              loading={ramLoading}
              unavailableMessage="RAM information unavailable"
            />

            {showVramSection ? (
              <MemorySlider
                title={vramTitle}
                stats={vramStats}
                onChange={(newVal) =>
                  setVramStats((prev) => ({ ...prev, appAllocated: newVal }))
                }
                onSave={(newVal) => triggerSave({ allocatedVRAM: newVal })}
                onRefresh={fetchHardware}
                loading={gpuLoading}
                unavailableMessage="GPU memory information unavailable"
              />
            ) : null}
          </div>

          <div className="settings-card">
            <InfoTooltip
              content="Configure global application paths and directories."
              side="right"
              hideIcon
              title="Application Setup"
              className="mem-title-tooltip"
            >
              <h2 className="settings-card-title">Application Setup</h2>
            </InfoTooltip>

            <div className="settings-field">
              <InfoTooltip
                content={MODELS_DIR_TOOLTIP}
                side="bottom"
                hideIcon
                title="Models Directory"
                className="models-dir-tooltip"
              >
                <span className="settings-label">Models Directory</span>
                <div className="settings-row">
                  <input
                    className="settings-input"
                    value={settings.modelsDirectory}
                    readOnly
                  />
                  <button
                    type="button"
                    className="settings-icon-btn"
                    onClick={handlePickDirectory}
                    title="Browse"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </InfoTooltip>
            </div>

            <div className="settings-field">
              <InfoTooltip
                content={BACKEND_DIR_TOOLTIP}
                side="bottom"
                hideIcon
                title="Backend Directory"
                className="backend-dir-tooltip"
              >
                <span className="settings-label">Backend Directory</span>
                <div className="settings-row">
                  <input
                    className="settings-input"
                    value={settings.backendDirectory}
                    readOnly
                  />
                  <button
                    type="button"
                    className="settings-icon-btn"
                    onClick={handlePickBackendDirectory}
                    title="Browse"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </InfoTooltip>
            </div>

            <div className="settings-field">
              <InfoTooltip
                content={PARSER_DIR_TOOLTIP}
                side="bottom"
                hideIcon
                title="Parser Directory"
                className="parser-dir-tooltip"
              >
                <span className="settings-label">Parser Directory</span>
                <div className="settings-row">
                  <input
                    className="settings-input"
                    value={settings.parserDirectory}
                    readOnly
                  />
                  <button
                    type="button"
                    className="settings-icon-btn"
                    onClick={handlePickParserDirectory}
                    title="Browse"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </InfoTooltip>
            </div>
          </div>
        </>
      )}

      {tab === 'chat' && (
        <>
          <div className="settings-card">
            <h2 className="settings-card-title">Thinking</h2>

            <div className="settings-field">
              <label className="settings-toggle-row">
                <span className="settings-label">
                  Automatically open thinking segments
                </span>
                <div
                  className={`epm-toggle-switch${settings.autoOpenThinking ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() =>
                    triggerSave({
                      autoOpenThinking: !settings.autoOpenThinking,
                    })
                  }
                  role="switch"
                  aria-checked={settings.autoOpenThinking}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      triggerSave({
                        autoOpenThinking: !settings.autoOpenThinking,
                      });
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </label>
            </div>

            <div className="settings-field">
              <label
                className={`settings-toggle-row${!settings.autoOpenThinking ? ' settings-toggle-row--disabled' : ''}`}
              >
                <span className="settings-label">
                  Automatically close thinking segments when finished
                </span>
                <div
                  className={`epm-toggle-switch${settings.autoCloseThinkingDone ? ' epm-toggle-switch--on' : ''}${!settings.autoOpenThinking ? ' epm-toggle-switch--disabled' : ''}`}
                  onClick={() => {
                    if (!settings.autoOpenThinking) return;
                    triggerSave({
                      autoCloseThinkingDone: !settings.autoCloseThinkingDone,
                    });
                  }}
                  role="switch"
                  aria-checked={settings.autoCloseThinkingDone}
                  tabIndex={settings.autoOpenThinking ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!settings.autoOpenThinking) return;
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      triggerSave({
                        autoCloseThinkingDone: !settings.autoCloseThinkingDone,
                      });
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </label>
            </div>
          </div>

          <div className="settings-card">
            <h2 className="settings-card-title">Server</h2>

            <div className="settings-field">
              <label className="settings-toggle-row">
                <span className="settings-label">
                  Launch Server Automatically
                </span>
                <div
                  className={`epm-toggle-switch${(settings.launchServerAutomatically ?? true) ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() =>
                    triggerSave({
                      launchServerAutomatically: !(
                        settings.launchServerAutomatically ?? true
                      ),
                    })
                  }
                  role="switch"
                  aria-checked={settings.launchServerAutomatically ?? true}
                  aria-label="Launch Server Automatically"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      triggerSave({
                        launchServerAutomatically: !(
                          settings.launchServerAutomatically ?? true
                        ),
                      });
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </label>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                When enabled, the inference server starts automatically if none
                is running when you open Chat. When disabled, the server stays
                offline until you press Server Online or the Power button. This
                does not stop an already-running server.
              </p>
            </div>
          </div>
        </>
      )}

      {tab === 'security' && (
        <div className="settings-card">
          <h2 className="settings-card-title">Security</h2>

          <div className="settings-field">
            <div className="settings-toggle-row">
              <span className="settings-label">
                Disable downloading external READMEs
              </span>
              <div
                className={`epm-toggle-switch${settings.disableExternalReadmes ? ' epm-toggle-switch--on' : ''}`}
                onClick={() =>
                  triggerSave({
                    disableExternalReadmes: !settings.disableExternalReadmes,
                  })
                }
                role="switch"
                aria-label="Disable downloading external READMEs"
                aria-checked={settings.disableExternalReadmes}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    triggerSave({
                      disableExternalReadmes: !settings.disableExternalReadmes,
                    });
                  }
                }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'server' && (
        <div className="settings-card">
          <h2 className="settings-card-title">Server Defaults</h2>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '20px',
              lineHeight: 1.5,
            }}
          >
            These settings are used as global defaults when creating{' '}
            <strong>new</strong> profiles. Existing profiles are not affected.
          </p>

          <div className="settings-field">
            <div
              style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="epm-section__label">Host</div>
                <InfoTooltip
                  content={HOST_TOOLTIP}
                  side="bottom"
                  stretch
                  className="info-tooltip-stretch--col"
                  title="Host"
                >
                  <input
                    type="text"
                    className="settings-input"
                    value={settings.host ?? ''}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, host: e.target.value } : prev,
                      )
                    }
                    onBlur={() => triggerSave({ host: settings.host })}
                    placeholder="127.0.0.1"
                    style={{ marginTop: '8px' }}
                  />
                </InfoTooltip>
              </div>
              <div style={{ flex: 1, minWidth: 0, maxWidth: '240px' }}>
                <div className="epm-section__label">Port</div>
                <InfoTooltip
                  content={PORT_TOOLTIP}
                  side="bottom"
                  stretch
                  className="info-tooltip-stretch--col"
                  title="Port"
                >
                  <input
                    type="number"
                    className="settings-input"
                    value={settings.port?.toString() ?? ''}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              port: parseInt(e.target.value, 10) || 9931,
                            }
                          : prev,
                      )
                    }
                    onBlur={() => triggerSave({ port: settings.port })}
                    placeholder="9931"
                    min="1"
                    max="65535"
                    style={{ marginTop: '8px' }}
                  />
                </InfoTooltip>
              </div>
            </div>
          </div>

          <div className="settings-field">
            <div className="epm-section__label">CORS Origins</div>
            <InfoTooltip
              content={CORS_ORIGINS_TOOLTIP}
              side="bottom"
              stretch
              className="info-tooltip-stretch--col"
              title="CORS Origins"
            >
              <input
                type="text"
                className="settings-input"
                value={settings.corsOrigins ?? ''}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, corsOrigins: e.target.value } : prev,
                  )
                }
                onBlur={() =>
                  triggerSave({ corsOrigins: settings.corsOrigins })
                }
                placeholder="*"
                style={{ marginTop: '8px' }}
              />
            </InfoTooltip>
          </div>

          <div className="settings-field">
            <div className="epm-section__label">CORS Methods</div>
            <InfoTooltip
              content={CORS_METHODS_TOOLTIP}
              side="bottom"
              stretch
              className="info-tooltip-stretch--col"
              title="CORS Methods"
            >
              <input
                type="text"
                className="settings-input"
                value={settings.corsMethods ?? ''}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, corsMethods: e.target.value } : prev,
                  )
                }
                onBlur={() =>
                  triggerSave({ corsMethods: settings.corsMethods })
                }
                placeholder="GET, POST, DELETE, OPTIONS"
                style={{ marginTop: '8px' }}
              />
            </InfoTooltip>
          </div>

          <div className="settings-field">
            <div className="epm-section__label">CORS Headers</div>
            <InfoTooltip
              content={CORS_HEADERS_TOOLTIP}
              side="bottom"
              stretch
              className="info-tooltip-stretch--col"
              title="CORS Headers"
            >
              <input
                type="text"
                className="settings-input"
                value={settings.corsHeaders ?? ''}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, corsHeaders: e.target.value } : prev,
                  )
                }
                onBlur={() =>
                  triggerSave({ corsHeaders: settings.corsHeaders })
                }
                placeholder="*"
                style={{ marginTop: '8px' }}
              />
            </InfoTooltip>
          </div>

          <div className="settings-field">
            <label className="settings-toggle-row">
              <InfoTooltip
                content={CORS_CREDENTIALS_TOOLTIP}
                side="bottom"
                stretch
                className="info-tooltip-stretch--row"
                title="CORS Credentials"
              >
                <span className="settings-label">Allow Credentials</span>
              </InfoTooltip>
              <div
                className={`epm-toggle-switch${settings.corsCredentials !== false ? ' epm-toggle-switch--on' : ''}`}
                onClick={() => {
                  const next = settings.corsCredentials === false;
                  setSettings((prev) =>
                    prev ? { ...prev, corsCredentials: next } : prev,
                  );
                  triggerSave({ corsCredentials: next });
                }}
                role="switch"
                aria-checked={settings.corsCredentials !== false}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    const next = settings.corsCredentials === false;
                    setSettings((prev) =>
                      prev ? { ...prev, corsCredentials: next } : prev,
                    );
                    triggerSave({ corsCredentials: next });
                  }
                }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </label>
          </div>
        </div>
      )}

      {showRestartDialog && (
        <ConfirmDialog
          title="Restart Server?"
          message="Changing system allocation requires a server restart to take effect. Your current conversation will be lost."
          confirmText="Restart Now"
          cancelText="Restart Later"
          onConfirm={handleRestartNow}
          onCancel={handleKeepConversation}
        />
      )}
    </div>
  );
}
