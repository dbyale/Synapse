import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import './styles/FileSystemSettings.css';

export default function SandboxSettings() {
  const [readSize, setReadSize] = useState(40000);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [timeoutSec, setTimeoutSec] = useState(90);
  const [platform, setPlatform] = useState<string>('win32');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const settings =
        await window.electronAPI.extensionsGetSettings('sandbox');
      if (settings.maxReadSize !== undefined) setReadSize(settings.maxReadSize);
      if (settings.autoLaunchDockerDesktop !== undefined) {
        setAutoLaunch(!!settings.autoLaunchDockerDesktop);
      } else {
        setAutoLaunch(true);
      }
      if (settings.autoLaunchTimeoutSec !== undefined) {
        const n = Math.round(Number(settings.autoLaunchTimeoutSec));
        if (Number.isFinite(n)) setTimeoutSec(Math.max(30, Math.min(180, n)));
      }
      try {
        const plat = await (window.electronAPI as any).getPlatform?.();
        if (plat) setPlatform(plat);
      } catch {
        // fallback: keep win32
      }
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const clampedTimeout = Math.max(
        30,
        Math.min(180, Math.round(timeoutSec) || 90),
      );
      await window.electronAPI.extensionsSetSettings('sandbox', {
        maxReadSize: readSize,
        autoLaunchDockerDesktop: autoLaunch,
        autoLaunchTimeoutSec: clampedTimeout,
      });
      setTimeoutSec(clampedTimeout);
      setDirty(false);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="fss-loading">Loading settings...</div>;
  }

  const isLinux = platform === 'linux';

  return (
    <div className="fss">
      {error && (
        <div className="fss-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="fss-field-label">
        Max Read Size (characters)
        <input
          type="number"
          className="fss-number-input"
          value={readSize}
          min={1000}
          step={1000}
          onChange={(e) => {
            setReadSize(Number(e.target.value));
            setDirty(true);
          }}
        />
      </label>
      <p className="fss-field-hint">
        Read operations returning more than this many characters will return a
        warning instead of the file content.
      </p>

      <div className="fss-divider" />

      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label
        className="fss-field-label"
        style={{ opacity: isLinux ? 0.6 : 1 }}
        title={
          isLinux
            ? 'Automatic launch is disabled on Linux — distro-specific instructions are shown instead.'
            : undefined
        }
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={autoLaunch}
            disabled={isLinux}
            onChange={(e) => {
              setAutoLaunch(e.target.checked);
              setDirty(true);
            }}
          />
          Automatically launch Docker Desktop when needed
        </span>
      </label>
      <p className="fss-field-hint">
        {isLinux
          ? 'Linux: shows distro-specific start instructions only — automatic start is disabled on this platform. (Setting is retained for other platforms.)'
          : 'When Docker is installed but the daemon is not running, launch Docker Desktop automatically (Windows/macOS). Disable to show instructions only.'}
      </p>

      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label
        className="fss-field-label"
        style={{ opacity: isLinux ? 0.6 : 1, marginTop: 12 }}
        title={
          isLinux
            ? 'Timeout is not used on Linux (instructions-only).'
            : undefined
        }
      >
        Auto-launch timeout (seconds)
        <input
          type="number"
          className="fss-number-input"
          value={timeoutSec}
          min={30}
          max={180}
          step={10}
          disabled={isLinux}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTimeoutSec(v);
            setDirty(true);
          }}
        />
      </label>
      <p className="fss-field-hint">
        How long to wait for the Docker daemon after launching (Windows/macOS
        only). Range 30–180s, default 90s.
      </p>

      {dirty && (
        <button
          type="button"
          className="btn-accent"
          onClick={save}
          disabled={saving}
          style={{ marginTop: 8, alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}
    </div>
  );
}
