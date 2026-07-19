import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import './styles/FileSystemSettings.css';

export default function SandboxSettings() {
  const [readSize, setReadSize] = useState(40000);
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
      await window.electronAPI.extensionsSetSettings('sandbox', {
        maxReadSize: readSize,
      });
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

  return (
    <div className="fss">
      {error && (
        <div className="fss-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

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
