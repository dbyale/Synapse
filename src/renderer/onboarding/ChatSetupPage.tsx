import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useSettingsBuffer } from '../components/settingsShared/useSettingsBuffer';
import '../styles/SettingsPage.css';

export default function ChatSetupPage({
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
            Chat Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Configure how thinking segments and the inference server behave
            during chat. These are the same settings found in Settings → Chat.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            Thinking controls whether the model’s chain-of-thought is shown.
            Server auto-launch is a global default for new sessions.
          </p>
        </div>

        <div className="onb-backend-right">
          <div className="onb-backend-section onb-rise onb-delay-1">
            <h2 className="settings-card-title">Thinking</h2>

            <div className="settings-field">
              <label className="settings-toggle-row">
                <span className="settings-label">
                  Automatically open thinking segments
                </span>
                <div
                  className={`epm-toggle-switch${settings.autoOpenThinking ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() =>
                    setSettings((prev) =>
                      prev
                        ? { ...prev, autoOpenThinking: !prev.autoOpenThinking }
                        : prev,
                    )
                  }
                  role="switch"
                  aria-checked={settings.autoOpenThinking}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              autoOpenThinking: !prev.autoOpenThinking,
                            }
                          : prev,
                      );
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
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            autoCloseThinkingDone: !prev.autoCloseThinkingDone,
                          }
                        : prev,
                    );
                  }}
                  role="switch"
                  aria-checked={settings.autoCloseThinkingDone}
                  tabIndex={settings.autoOpenThinking ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!settings.autoOpenThinking) return;
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              autoCloseThinkingDone: !prev.autoCloseThinkingDone,
                            }
                          : prev,
                      );
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </label>
            </div>
          </div>

          <div className="onb-backend-section onb-rise onb-delay-2">
            <h2 className="settings-card-title">Server</h2>
            <div className="settings-field">
              <label className="settings-toggle-row">
                <span className="settings-label">
                  Launch Server Automatically
                </span>
                <div
                  className={`epm-toggle-switch${(settings.launchServerAutomatically ?? true) ? ' epm-toggle-switch--on' : ''}`}
                  onClick={() =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            launchServerAutomatically: !(
                              prev.launchServerAutomatically ?? true
                            ),
                          }
                        : prev,
                    )
                  }
                  role="switch"
                  aria-checked={settings.launchServerAutomatically ?? true}
                  aria-label="Launch Server Automatically"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              launchServerAutomatically: !(
                                prev.launchServerAutomatically ?? true
                              ),
                            }
                          : prev,
                      );
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
