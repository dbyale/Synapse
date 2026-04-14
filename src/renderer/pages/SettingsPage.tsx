import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type { AppSettings, HardwareStats } from '../preload.d';
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
  const TitleNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div className="mem-title">{title}</div>
      <button
        type="button"
        className={`mem-refresh-btn ${loading ? 'loading' : ''}`}
        onClick={onRefresh}
        disabled={loading}
        title="Refresh memory usage"
      >
        <RefreshCw size={14} />
      </button>
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
        <div
          className="mem-tooltip-target mem-segment-other"
          style={{ right: 0, left: 'auto', width: `${otherPct}%` }}
        >
          <div className="mem-tooltip">
            <div className="mem-tooltip-title">OS & Other Apps</div>
            <div className="mem-tooltip-text">{otherGB} GB In Use</div>
          </div>
        </div>

        {/* FREE — fills gap between APP and OTHER */}
        <div
          className="mem-tooltip-target mem-segment-free"
          style={{ left: `${appPct}%`, width: `${freePct}%` }}
        >
          <div className="mem-tooltip">
            <div className="mem-tooltip-title">Free Space</div>
            <div className="mem-tooltip-text">{freeGB} GB Available</div>
          </div>
        </div>

        {/* APP — grows from left edge, renders on top of OTHER when overlapping */}
        <div
          className={`mem-tooltip-target mem-segment-app ${isExceeded ? 'exceeded' : ''}`}
          style={{ left: 0, width: `${appPct}%` }}
        >
          <div className="mem-tooltip">
            <div
              className="mem-tooltip-title"
              style={{ color: isExceeded ? '#f38ba8' : 'var(--text-primary)' }}
            >
              Synapse Allocation
            </div>
            <div className="mem-tooltip-text">{appGB} GB Reserved</div>
          </div>
        </div>

        {/* MAX line — fixed at maxRecommended / total */}
        <div className="mem-max-wrapper" style={{ left: `${maxPct}%` }}>
          <div className="mem-max-label">MAX</div>
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
        <span>
          Synapse Allocation:{' '}
          <strong className="mem-value-small">{appGB} GB</strong>
        </span>
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

  const savedAllocationsRef = useRef<{
    allocatedRAM?: number;
    allocatedVRAM?: number;
  }>({});

  const fetchHardware = useCallback(async () => {
    setRamLoading(true);
    setGpuLoading(true);

    try {
      const [hw, modelMemory]: [any, any] = await Promise.all([
        window.electronAPI.getVramStats(),
        window.electronAPI.chatMemoryUsage(),
      ]);

      if (!hw) return;

      setHardware(hw);

      const modelRamMB = modelMemory
        ? Math.round(
            (modelMemory.modelRamUsage + modelMemory.contextRamUsage) /
              1024 /
              1024,
          )
        : 0;

      const modelVramMB = modelMemory
        ? Math.round(
            (modelMemory.modelVramUsage + modelMemory.contextVramUsage) /
              1024 /
              1024,
          )
        : 0;

      // -- SYSTEM RAM --
      if (hw.ram && hw.ram.total > 0) {
        const savedRam = savedAllocationsRef.current.allocatedRAM;
        const adjustedOtherRam = Math.max(0, hw.ram.otherUsed - modelRamMB);

        // MAX = everything except other processes and the safety buffer.
        // RAM_SAFETY_BUFFER_MB is intentionally generous — RAM overflow
        // destabilises the entire OS, not just the inference process.
        const adjustedMaxRam = Math.max(
          0,
          hw.ram.total - adjustedOtherRam - RAM_SAFETY_BUFFER_MB,
        );

        setRamStats((prev) => ({
          total: hw.ram.total,
          appAllocated:
            prev.appAllocated > 0
              ? prev.appAllocated
              : savedRam || Math.floor(hw.ram.total / 2),
          otherUsed: adjustedOtherRam,
          maxRecommended: adjustedMaxRam,
        }));
      } else {
        setRamStats(EMPTY_MEMORY);
      }

      // -- VRAM (GPU) --
      if (hw.vram && hw.vram.total > 0) {
        const savedVram = savedAllocationsRef.current.allocatedVRAM;
        const adjustedOtherVram = Math.max(0, hw.vram.otherUsed - modelVramMB);

        // MAX = everything except other processes and the safety buffer.
        // VRAM_SAFETY_BUFFER_MB is intentionally tight — VRAM overflow only
        // slows inference via CPU offload, it does not crash the system.
        const adjustedMaxVram = Math.max(
          0,
          hw.vram.total - adjustedOtherVram - VRAM_SAFETY_BUFFER_MB,
        );

        setVramStats((prev) => ({
          total: hw.vram.total,
          appAllocated:
            prev.appAllocated > 0
              ? prev.appAllocated
              : savedVram || hw.vram.maxRecommended,
          otherUsed: adjustedOtherVram,
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

      await window.electronAPI.saveSettings(payload);

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

      <div className="settings-card">
        <h2 className="settings-card-title">Application Setup</h2>

        <div className="settings-field">
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
        </div>
      </div>

      <div className="settings-card">
        <h2 className="settings-card-title">System Resource Allocator</h2>

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
    </div>
  );
}
