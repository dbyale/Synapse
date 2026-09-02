import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useSettingsBuffer } from '../components/settingsShared/useSettingsBuffer';
import '../styles/SettingsPage.css';

export default function SecuritySetupPage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const { settings, setSettings } = useSettingsBuffer();
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    if (saving || !settings) return;
    setSaving(true);
    try {
      await window.electronAPI.saveSettingsSilent(settings);
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
            Security Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Control how Synapse handles external content. These are the same
            settings found in Settings → Security.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            You can change this anytime in Settings. Disabling external READMEs
            prevents fetching model READMEs from the network.
          </p>
        </div>

        <div className="onb-backend-right">
          <div className="onb-backend-section onb-rise onb-delay-1">
            <h2 className="settings-card-title">Security</h2>
            <div className="settings-field">
              <div className="settings-toggle-row">
                <span className="settings-label">
                  Disable downloading external READMEs
                </span>
                <div
                  className={`epm-toggle-switch${settings.disableExternalReadmes ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            disableExternalReadmes: !prev.disableExternalReadmes,
                          }
                        : prev,
                    )
                  }
                  role="switch"
                  aria-label="Disable downloading external READMEs"
                  aria-checked={settings.disableExternalReadmes}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              disableExternalReadmes:
                                !prev.disableExternalReadmes,
                            }
                          : prev,
                      );
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </div>
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
