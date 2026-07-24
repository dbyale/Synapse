import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  SlidersHorizontal,
  MessageSquare,
  Server,
} from 'lucide-react';
import type { AppSettings, HardwareStats } from '../preload.d';
import InfoTooltip from '../components/InfoTooltip';
import {
  MODELS_DIR_TOOLTIP,
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
} from '../utils/tooltipContent';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/SettingsPage.css';

// Minimal buffer — VRAM overflow is preferable to RAM overflow.
// At this point all other allocations (weights, KV cache, other processes)
// are already accounted for, so this only guards against sudden spikes
// and allocator fragmentation.
const VRAM_SAFETY_BUFFER_MB = 300;

// More conservative buffer — RAM overflow causes system-wide instability
// and can crash the OS, not just the inference process.
const RAM_SAFETY_BUFFER_MB = 2048;

interface MemoryStats {
  total: number;
  appAllocated: number;
  otherUsed: number;
  maxRecommended: number;
}

const EMPTY_MEMORY: MemoryStats = {
  total: 0,
  appAllocated: 0,
  otherUsed: 0,
  maxRecommended: 0,
};

const formatGB = (mb: number) => (mb / 1024).toFixed(1);

type MemorySliderProps = {
  title: string;
  stats: MemoryStats;
  loading: boolean;
  unavailableMessage: string;
  onChange: (newVal: number) => void;
  onSave: (newVal: number) => void;
  onRefresh: () => void;
};

function MemorySlider({
  title,
  stats,
  loading,
  unavailableMessage,
  onChange,
  onSave,
  onRefresh,
}: MemorySliderProps) {
  const titleTooltip = title.includes('Video') || title.includes('GPU') ? VRAM_LABEL_TOOLTIP : RAM_LABEL_TOOLTIP;

  const TitleNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <InfoTooltip content={titleTooltip} side="right" hideIcon title={title} className="mem-title-tooltip">
        <div className="mem-title">{title}</div>
      </InfoTooltip>
      <InfoTooltip content="Refresh memory usage" side="bottom" hideIcon>
        <button
          type="button"
          className={`mem-refresh-btn ${loading ? 'loading' : ''}`}
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={14} />
        </button>
      </InfoTooltip>
    </div>
  );

  if (loading) {
    return (
      <div className="mem-container">
        <div className="mem-header">
          {TitleNode}
          <div className="mem-usage-row">Detecting hardware…</div>
        </div>
        <div className="mem-bar-wrapper" style={{ opacity: 0.45 }} />
      </div>
    );
  }

  if (stats.total <= 0 || Number.isNaN(stats.total)) {
    return (
      <div className="mem-container">
        <div className="mem-header">
          {TitleNode}
          <div className="mem-usage-row">{unavailableMessage}</div>
        </div>
      </div>
    );
  }

  const appPct = Math.min((stats.appAllocated / stats.total) * 100, 100);
  const otherPct = Math.min((stats.otherUsed / stats.total) * 100, 100);
  const freePct = Math.max(0, 100 - appPct - otherPct);
  const maxPct = Math.min((stats.maxRecommended / stats.total) * 100, 100);

  const freeSpace = Math.max(
    0,
    stats.total - stats.appAllocated - stats.otherUsed,
  );
  const isExceeded = stats.appAllocated > stats.maxRecommended;

  const appGB = formatGB(stats.appAllocated);
  const otherGB = formatGB(stats.otherUsed);
  const freeGB = formatGB(freeSpace);
  const totalGB = formatGB(stats.total);
  const displayUsedGB = formatGB(stats.appAllocated);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseInt(e.target.value, 10));
  };

  const handleSliderCommit = () => {
    onSave(stats.appAllocated);
  };

  return (
    <div className="mem-container">
      <div className="mem-header">
        {TitleNode}
        <div className="mem-usage-row">
          <span className="mem-value">{displayUsedGB}</span>
          <span className="mem-unit"> / {totalGB} GB</span>
        </div>
      </div>

      <div className="mem-bar-wrapper">
        {/* OTHER — pinned to right edge, always at the same position */}
        <InfoTooltip
          title="OS & Other Apps"
          content={`${otherGB} GB In Use`}
          side="bottom"
          hideIcon
          className="mem-segment-other"
          style={{ right: 0, left: 'auto', width: `${otherPct}%` }}
        />

        {/* FREE — fills gap between APP and OTHER */}
        <InfoTooltip
          title="Free Space"
          content={`${freeGB} GB Available`}
          side="bottom"
          hideIcon
          className="mem-segment-free"
          style={{ left: `${appPct}%`, width: `${freePct}%` }}
        />

        {/* APP — grows from left edge, renders on top of OTHER when overlapping */}
        <InfoTooltip
          title="Synapse Allocation"
          content={`${appGB} GB Reserved`}
          side="bottom"
          hideIcon
          className={`mem-segment-app${isExceeded ? ' exceeded' : ''}`}
          style={{ left: 0, width: `${appPct}%` }}
        />

        {/* MAX line — fixed at maxRecommended / total */}
        <div className="mem-max-wrapper" style={{ left: `${maxPct}%` }}>
          <InfoTooltip content={MAX_LABEL_TOOLTIP} side="top" iconSize={10} title="Maximum">
            <div className="mem-max-label">MAX</div>
          </InfoTooltip>
          <div className="mem-max-line" />
        </div>

        {/* Slider — full width, sits on top of all segments */}
        <input
          type="range"
          min={0}
          max={stats.total}
          value={stats.appAllocated}
          onChange={handleSliderChange}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
              handleSliderCommit();
          }}
          className={`mem-slider ${isExceeded ? 'slider-exceeded' : ''}`}
          style={{ left: 0, width: '100%' }}
        />
      </div>

      <div className="mem-legend-row">
        <div className={`mem-legend-box ${isExceeded ? 'exceeded' : ''}`} />
        <InfoTooltip content={MEMORY_ALLOCATOR_TOOLTIP} side="right" hideIcon title="Synapse Allocation">
          <span>
            Synapse Allocation:{' '}
            <strong className="mem-value-small">{appGB} GB</strong>
          </span>
        </InfoTooltip>
      </div>

      {isExceeded ? (
        <div className="mem-warning">
          <AlertTriangle size={14} />
          <span>
            Exceeding recommended limits may cause system instability or severe
            performance drops.
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  );

  const [hardware, setHardware] = useState<HardwareStats | null>(null);
  const [ramLoading, setRamLoading] = useState(true);
  const [gpuLoading, setGpuLoading] = useState(true);

  const [ramStats, setRamStats] = useState<MemoryStats>(EMPTY_MEMORY);
  const [vramStats, setVramStats] = useState<MemoryStats>(EMPTY_MEMORY);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [tab, setTab] = useState<'system' | 'chat' | 'server'>('system');

  const savedAllocationsRef = useRef<{
    allocatedRAM?: number;
    allocatedVRAM?: number;
  }>({});

  const fetchHardware = useCallback(async () => {
    setRamLoading(true);
    setGpuLoading(true);

    try {
      const hw = await window.electronAPI.getVramStats();

      if (!hw) return;

      setHardware(hw);

      // NOTE: llama-server's own memory is already excluded from
      // hw.ram.otherUsed and hw.vram.otherUsed at the source
      // (computeVramStats reads the server process directly).

      // -- SYSTEM RAM --
      if (hw.ram && hw.ram.total > 0) {
        const savedRam = savedAllocationsRef.current.allocatedRAM;

        // MAX = everything except other processes and the safety buffer.
        // RAM_SAFETY_BUFFER_MB is intentionally generous — RAM overflow
        // destabilises the entire OS, not just the inference process.
        const adjustedMaxRam = Math.max(
          0,
          hw.ram.total - hw.ram.otherUsed - RAM_SAFETY_BUFFER_MB,
        );

        setRamStats((prev) => ({
          total: hw.ram.total,
          appAllocated:
            prev.appAllocated > 0
              ? prev.appAllocated
              : savedRam || Math.floor(hw.ram.total / 2),
          otherUsed: hw.ram.otherUsed,
          maxRecommended: adjustedMaxRam,
        }));
      } else {
        setRamStats(EMPTY_MEMORY);
      }

      // -- VRAM (GPU) --
      if (hw.vram && hw.vram.total > 0) {
        const savedVram = savedAllocationsRef.current.allocatedVRAM;
        const vram = hw.vram;

        // MAX = everything except other processes and the safety buffer.
        // VRAM_SAFETY_BUFFER_MB is intentionally tight — VRAM overflow only
        // slows inference via CPU offload, it does not crash the system.
        const adjustedMaxVram = Math.max(
          0,
          vram.total - vram.otherUsed - VRAM_SAFETY_BUFFER_MB,
        );

        setVramStats((prev) => ({
          total: vram.total,
          appAllocated:
            prev.appAllocated > 0
              ? prev.appAllocated
              : savedVram || vram.maxRecommended,
          otherUsed: vram.otherUsed,
          maxRecommended: adjustedMaxVram,
        }));
      } else {
        setVramStats(EMPTY_MEMORY);
      }
    } catch {
      // Silently fail
    } finally {
      setRamLoading(false);
      setGpuLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const loaded = await window.electronAPI.loadSettings();
        if (!mounted) return;

        const normalized: AppSettings = {
          modelsDirectory: loaded?.modelsDirectory || '',
          allocatedRAM: loaded?.allocatedRAM,
          allocatedVRAM: loaded?.allocatedVRAM,
          autoOpenThinking: loaded?.autoOpenThinking ?? true,
          autoCloseThinkingDone: loaded?.autoCloseThinkingDone ?? true,
          corsOrigins: loaded?.corsOrigins ?? 'localhost',
          corsMethods: loaded?.corsMethods ?? '',
          corsHeaders: loaded?.corsHeaders ?? '',
          corsCredentials: loaded?.corsCredentials ?? true,
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
        await fetchHardware();
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

      const isRunning = await window.electronAPI.chatIsRunning();
      const hasConv = await window.electronAPI.chatHasConversation();

      if (isRunning && hasConv) {
        await window.electronAPI.saveSettingsSilent(payload);
        setShowRestartDialog(true);
      } else {
        await window.electronAPI.saveSettings(payload);
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

  const isUnifiedMemory = hardware ? hardware.isUnifiedMemory : false;
  const showVramSection =
    !isUnifiedMemory && (gpuLoading || vramStats.total > 0);

  const ramTitle = isUnifiedMemory ? 'Unified Memory' : 'System Memory (RAM)';
  const vramTitle =
    hardware && hardware.selectedGpu
      ? `Video Memory (GPU) — ${hardware.selectedGpu.model}`
      : 'Video Memory (GPU)';

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
          className={`settings-tab ${tab === 'system' ? 'settings-tab--active' : ''}`}
          onClick={() => setTab('system')}
        >
          <SlidersHorizontal size={16} /> System
        </button>
        <button
          type="button"
          className={`settings-tab ${tab === 'chat' ? 'settings-tab--active' : ''}`}
          onClick={() => setTab('chat')}
        >
          <MessageSquare size={16} /> Chat
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
            <InfoTooltip content="Configure global application paths and directories." side="right" hideIcon title="Application Setup" className="mem-title-tooltip">
              <h2 className="settings-card-title">Application Setup</h2>
            </InfoTooltip>

            <div className="settings-field">
              <InfoTooltip content={MODELS_DIR_TOOLTIP} side="bottom" hideIcon title="Models Directory" className="models-dir-tooltip">
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
          </div>

          <div className="settings-card">
            <InfoTooltip content={MEMORY_ALLOCATOR_TOOLTIP} side="right" hideIcon title="System Resource Allocator" className="mem-title-tooltip">
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
              <>
                <div style={{ height: 32 }} />
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
              </>
            ) : null}
          </div>
        </>
      )}

      {tab === 'chat' && (
        <div className="settings-card">
          <h2 className="settings-card-title">Thinking</h2>

          <div className="settings-field">
            <label className="settings-toggle-row">
              <span className="settings-label">Automatically open thinking segments</span>
              <div
                className={`epm-toggle-switch${settings.autoOpenThinking ? ' epm-toggle-switch--on' : ''}`}
                onClick={() => triggerSave({ autoOpenThinking: !settings.autoOpenThinking })}
                role="switch"
                aria-checked={settings.autoOpenThinking}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    triggerSave({ autoOpenThinking: !settings.autoOpenThinking });
                  }
                }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </label>
          </div>

          <div className="settings-field">
            <label className={`settings-toggle-row${!settings.autoOpenThinking ? ' settings-toggle-row--disabled' : ''}`}>
              <span className="settings-label">Automatically close thinking segments when finished</span>
              <div
                className={`epm-toggle-switch${settings.autoCloseThinkingDone ? ' epm-toggle-switch--on' : ''}${!settings.autoOpenThinking ? ' epm-toggle-switch--disabled' : ''}`}
                onClick={() => {
                  if (!settings.autoOpenThinking) return;
                  triggerSave({ autoCloseThinkingDone: !settings.autoCloseThinkingDone });
                }}
                role="switch"
                aria-checked={settings.autoCloseThinkingDone}
                tabIndex={settings.autoOpenThinking ? 0 : -1}
                onKeyDown={(e) => {
                  if (!settings.autoOpenThinking) return;
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    triggerSave({ autoCloseThinkingDone: !settings.autoCloseThinkingDone });
                  }
                }}
              >
                <div className="epm-toggle-switch__knob" />
              </div>
            </label>
          </div>
        </div>
      )}

      {tab === 'server' && (
        <div className="settings-card">
          <h2 className="settings-card-title">Server Defaults</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
            These settings are used as global defaults when creating <strong>new</strong> profiles.
            Existing profiles are not affected.
          </p>

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
                onBlur={() => triggerSave({ corsOrigins: settings.corsOrigins })}
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
                onBlur={() => triggerSave({ corsMethods: settings.corsMethods })}
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
                onBlur={() => triggerSave({ corsHeaders: settings.corsHeaders })}
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
                  const next = settings.corsCredentials !== false ? false : true;
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
                    const next = settings.corsCredentials !== false ? false : true;
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
