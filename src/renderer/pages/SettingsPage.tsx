import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Save, AlertTriangle } from 'lucide-react';
import type { AppSettings, HardwareStats } from '../preload.d';
import '../styles/SettingsPage.css';

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

type MemorySliderProps = {
  title: string;
  stats: MemoryStats;
  appName: string;
  loading: boolean;
  unavailableMessage: string;
  onChange: (newVal: number) => void;
};

function MemorySlider({
  title,
  stats,
  appName,
  loading,
  unavailableMessage,
  onChange,
}: MemorySliderProps) {
  if (loading) {
    return (
      <div className="mem-container">
        <div className="mem-header">
          <div className="mem-title">{title}</div>
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
          <div className="mem-title">{title}</div>
          <div className="mem-usage-row">{unavailableMessage}</div>
        </div>
      </div>
    );
  }

  const totalUsed = stats.appAllocated + stats.otherUsed;
  const otherPct = Math.min((stats.otherUsed / stats.total) * 100, 100);
  const appPct = Math.min(
    (stats.appAllocated / stats.total) * 100,
    Math.max(0, 100 - otherPct),
  );
  const maxPct = Math.min((stats.maxRecommended / stats.total) * 100, 100);
  const isExceeded = totalUsed > stats.maxRecommended;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseInt(e.target.value, 10));
  };

  return (
    <div className="mem-container">
      <div className="mem-header">
        <div className="mem-title">{title}</div>
        <div className="mem-usage-row">
          <span className="mem-value">{totalUsed}</span>
          <span className="mem-unit"> / {stats.total} MB</span>
        </div>
      </div>

      <div className="mem-bar-wrapper">
        <div
          className="mem-segment-other"
          style={{ width: `${otherPct}%` }}
          title="Used by OS and other apps"
        />

        <div
          className={`mem-segment-app ${isExceeded ? 'exceeded' : ''}`}
          style={{ left: `${otherPct}%`, width: `${appPct}%` }}
        />

        <div className="mem-max-wrapper" style={{ left: `${maxPct}%` }}>
          <div className="mem-max-label">Rec. Max</div>
          <div className="mem-max-line" />
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(0, stats.total - stats.otherUsed)}
          value={stats.appAllocated}
          onChange={handleSliderChange}
          className={`mem-slider ${isExceeded ? 'slider-exceeded' : ''}`}
          style={{
            left: `${otherPct}%`,
            width: `${100 - otherPct}%`,
          }}
          title="Drag to allocate memory"
        />
      </div>

      <div className="mem-legend-row">
        <div className={`mem-legend-box ${isExceeded ? 'exceeded' : ''}`} />
        <span>
          {appName} Allocation:{' '}
          <strong className="mem-value-small">{stats.appAllocated} MB</strong>
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
  const [saved, setSaved] = useState(false);

  const [hardware, setHardware] = useState<HardwareStats | null>(null);
  const [ramLoading, setRamLoading] = useState(true);
  const [gpuLoading, setGpuLoading] = useState(true);

  const [ramStats, setRamStats] = useState<MemoryStats>(EMPTY_MEMORY);
  const [vramStats, setVramStats] = useState<MemoryStats>(EMPTY_MEMORY);

  const savedAllocationsRef = useRef<{
    allocatedRAM?: number;
    allocatedVRAM?: number;
  }>({});

  useEffect(() => {
    let mounted = true;

    async function fetchHardware() {
      try {
        const hw: any = await window.electronAPI.getVramStats();
        if (!mounted || !hw) return;

        setHardware(hw);

        // -- SYSTEM RAM (Pulled dynamically from getVramStats backend payload) --
        if (hw.ram && hw.ram.total > 0) {
          const savedRam = savedAllocationsRef.current.allocatedRAM;
          setRamStats((prev) => ({
            total: hw.ram.total,
            appAllocated:
              prev.appAllocated > 0
                ? prev.appAllocated
                : savedRam || Math.floor(hw.ram.total / 2),
            otherUsed: hw.ram.otherUsed,
            maxRecommended: hw.ram.maxRecommended,
          }));
        } else {
          setRamStats(EMPTY_MEMORY);
        }

        // -- VRAM (GPU) --
        if (hw.vram && hw.vram.total > 0) {
          const savedVram = savedAllocationsRef.current.allocatedVRAM;
          setVramStats((prev) => ({
            total: hw.vram.total,
            appAllocated:
              prev.appAllocated > 0
                ? prev.appAllocated
                : savedVram || hw.vram.maxRecommended,
            otherUsed: hw.vram.otherUsed,
            maxRecommended: hw.vram.maxRecommended,
          }));
        } else {
          setVramStats(EMPTY_MEMORY);
        }
      } catch {
        // Silently fail
      } finally {
        if (mounted) {
          setRamLoading(false);
          setGpuLoading(false);
        }
      }
    }

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

      // Initial hardware fetch on page load
      fetchHardware();
    }

    init().catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  async function handlePickDirectory() {
    if (!settings) return;

    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir) {
        setSettings((prev) => {
          if (!prev) return prev;
          return { ...prev, modelsDirectory: dir };
        });
      }
    } catch {
      // Silently fail
    }
  }

  async function handleSave() {
    if (!settings) return;

    try {
      const payload: AppSettings = {
        ...settings,
        allocatedRAM: ramStats.appAllocated,
      };

      if (vramStats.total > 0) {
        payload.allocatedVRAM = vramStats.appAllocated;
      }

      await window.electronAPI.saveSettings(payload);

      savedAllocationsRef.current = {
        allocatedRAM: payload.allocatedRAM,
        allocatedVRAM: payload.allocatedVRAM,
      };

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Silently fail
    }
  }

  const isUnifiedMemory = hardware ? hardware.isUnifiedMemory : false;
  const showVramSection =
    !isUnifiedMemory && (gpuLoading || vramStats.total > 0);
  const showGpuList = hardware ? hardware.gpus.length > 0 : false;
  const showNoGpuMessage = hardware
    ? !gpuLoading && hardware.gpus.length === 0
    : false;

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
      <h1 className="settings-heading">Settings</h1>

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

        <button
          type="button"
          className="settings-save-btn"
          onClick={handleSave}
        >
          <Save size={16} />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="settings-card">
        <h2 className="settings-card-title">System Resource Allocator</h2>

        <MemorySlider
          title={ramTitle}
          stats={ramStats}
          appName="Synapse AI Models"
          onChange={(newVal) => {
            setRamStats((prev) => ({
              ...prev,
              appAllocated: newVal,
            }));
          }}
          loading={ramLoading}
          unavailableMessage="RAM information unavailable"
        />

        {showVramSection ? (
          <>
            <div style={{ height: 32 }} />
            <MemorySlider
              title={vramTitle}
              stats={vramStats}
              appName="Synapse AI Models"
              onChange={(newVal) => {
                setVramStats((prev) => ({
                  ...prev,
                  appAllocated: newVal,
                }));
              }}
              loading={gpuLoading}
              unavailableMessage="GPU memory information unavailable"
            />
          </>
        ) : null}

        {showGpuList ? (
          <div style={{ marginTop: 24 }}>
            <h3 className="settings-label" style={{ marginBottom: 12 }}>
              Detected GPUs
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {hardware?.gpus.map((gpu) => (
                <div
                  key={gpu.id}
                  style={{
                    padding: '12px 14px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'var(--bg-input)',
                  }}
                >
                  <div>
                    <strong>{gpu.model}</strong>
                  </div>
                  <div>Vendor: {gpu.vendor}</div>
                  <div>VRAM: {gpu.vram} MB</div>
                  <div>Dynamic VRAM: {gpu.vramDynamic ? 'Yes' : 'No'}</div>
                  {gpu.driverVersion ? (
                    <div>Driver: {gpu.driverVersion}</div>
                  ) : null}
                  {gpu.bus ? <div>Bus: {gpu.bus}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showNoGpuMessage ? (
          <div style={{ marginTop: 24 }} className="settings-label">
            No GPUs detected.
          </div>
        ) : null}
      </div>
    </div>
  );
}
