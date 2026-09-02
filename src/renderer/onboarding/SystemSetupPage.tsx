import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, FolderOpen } from 'lucide-react';
import { MemorySlider } from '../components/settingsShared/MemorySlider';
import { useHardwareStats } from '../components/settingsShared/useHardwareStats';
import { useSettingsBuffer } from '../components/settingsShared/useSettingsBuffer';
import InfoTooltip from '../components/InfoTooltip';
import {
  MODELS_DIR_TOOLTIP,
  BACKEND_DIR_TOOLTIP,
  PARSER_DIR_TOOLTIP,
  MEMORY_ALLOCATOR_TOOLTIP,
} from '../utils/tooltipContent';
import '../styles/SettingsPage.css';

export default function SystemSetupPage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const { settings, setSettings, savedAllocationsRef } = useSettingsBuffer();
  const {
    ramLoading,
    ramStats,
    vramStats,
    setRamStats,
    setVramStats,
    showVramSection,
    ramTitle,
    vramTitle,
    fetchHardware,
  } = useHardwareStats(savedAllocationsRef);

  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    if (settings) setSettingsReady(true);
  }, [settings]);

  useEffect(() => {
    if (settingsReady) fetchHardware().catch(() => {});
  }, [settingsReady, fetchHardware]);

  const [saving, setSaving] = useState(false);

  const handlePickModels = async () => {
    if (!settings) return;
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir && dir !== settings.modelsDirectory) {
        setSettings((prev) =>
          prev ? { ...prev, modelsDirectory: dir } : prev,
        );
      }
    } catch {
      // Silently fail
    }
  };
  const handlePickBackend = async () => {
    if (!settings) return;
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir && dir !== settings.backendDirectory) {
        setSettings((prev) =>
          prev ? { ...prev, backendDirectory: dir } : prev,
        );
      }
    } catch {
      // Silently fail
    }
  };
  const handlePickParser = async () => {
    if (!settings) return;
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir && dir !== settings.parserDirectory) {
        setSettings((prev) =>
          prev ? { ...prev, parserDirectory: dir } : prev,
        );
      }
    } catch {
      // Silently fail
    }
  };

  const handleContinue = async () => {
    if (saving || !settings) return;
    setSaving(true);
    try {
      const payload = {
        ...settings,
        allocatedRAM: ramStats.appAllocated,
        allocatedVRAM: vramStats.total > 0 ? vramStats.appAllocated : undefined,
      } as typeof settings;
      if (vramStats.total <= 0) delete (payload as any).allocatedVRAM;
      await window.electronAPI.saveSettingsSilent(payload);
      savedAllocationsRef.current = {
        allocatedRAM: payload.allocatedRAM,
        allocatedVRAM: (payload as any).allocatedVRAM,
      };
      setSettings(payload);
    } catch {
      // Silently fail
    }
    setSaving(false);
    onContinue();
  };

  if (!settings) {
    return (
      <div className="onb-page onb-backend-page">
        <p className="onb-professions-hint onb-rise">Loading…</p>
      </div>
    );
  }

  return (
    <div className="onb-page onb-backend-page">
      <button
        type="button"
        aria-label="Back"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-backend">
        <div className="onb-backend-info">
          <h1 className="onb-professions-title onb-rise onb-delay-1">
            System Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Configure where Synapse stores models and backends, and how much
            system memory to reserve for inference. These are the same settings
            found in Settings → System.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            Memory allocation defaults to half your RAM and the recommended VRAM
            for your detected GPU. You can tune it later in Settings.
          </p>
        </div>

        <div className="onb-backend-right">
          <div className="onb-backend-section onb-rise onb-delay-1">
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
              onSave={() => {}}
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
                  onSave={() => {}}
                  onRefresh={fetchHardware}
                  loading={false}
                  unavailableMessage="GPU memory information unavailable"
                />
              </>
            ) : null}
          </div>

          <div className="onb-backend-section onb-rise onb-delay-2">
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
                    onClick={handlePickModels}
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
                    onClick={handlePickBackend}
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
                    onClick={handlePickParser}
                    title="Browse"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </InfoTooltip>
            </div>
          </div>
        </div>
      </div>

      <div className="onb-professions-footer onb-rise onb-delay-4">
        <button
          type="button"
          className="onb-continue"
          onClick={handleContinue}
          disabled={saving}
        >
          Continue <ArrowRight size={20} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
