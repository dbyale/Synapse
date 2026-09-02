import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useSettingsBuffer } from '../components/settingsShared/useSettingsBuffer';
import InfoTooltip from '../components/InfoTooltip';
import {
  HOST_TOOLTIP,
  PORT_TOOLTIP,
  CORS_ORIGINS_TOOLTIP,
  CORS_METHODS_TOOLTIP,
  CORS_HEADERS_TOOLTIP,
  CORS_CREDENTIALS_TOOLTIP,
} from '../utils/tooltipContent';
import '../styles/SettingsPage.css';

export default function ServerSetupPage({
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
            Server Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Configure the inference server defaults used when creating new
            profiles. Existing profiles are not affected.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            These are the same settings found in Settings → Server. Host, port
            and CORS control how clients connect to your local server.
          </p>
        </div>

        <div className="onb-backend-right">
          <div className="onb-backend-section onb-rise onb-delay-1">
            <h2 className="settings-card-title">Server Defaults</h2>
            <p
              style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                marginBottom: '12px',
                lineHeight: 1.5,
              }}
            >
              These settings are used as global defaults when creating{' '}
              <strong>new</strong> profiles. Existing profiles are not affected.
            </p>

            <div className="settings-field">
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}
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
                    }
                  }}
                >
                  <div className="epm-toggle-switch__knob" />
                </div>
              </label>
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
