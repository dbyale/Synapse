import { useState, useEffect } from 'react';
import { Plus, Trash2, FolderOpen, AlertCircle } from 'lucide-react';
import './styles/FileSystemSettings.css';

export default function FileSystemSettings() {
  const [directories, setDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadDirectories() {
    setLoading(true);
    try {
      const settings =
        await window.electronAPI.extensionsGetSettings('filesystem');
      setDirectories(settings.allowedDirectories || []);
    } catch {
      setError('Failed to load allowed directories');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDirectories();
  }, []);

  async function saveDirectories(dirs: string[]) {
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.extensionsSetSettings('filesystem', {
        allowedDirectories: dirs,
      });
      setDirectories(dirs);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDirectory() {
    const result = await window.electronAPI.pickDirectory();
    if (result) {
      const updated = [...directories, result];
      await saveDirectories(updated);
    }
  }

  function handleRemoveDirectory(dir: string) {
    const updated = directories.filter((d) => d !== dir);
    saveDirectories(updated);
  }

  if (loading) {
    return <div className="fss-loading">Loading settings...</div>;
  }

  return (
    <div className="fss">
      <p className="fss-description">
        Restrict filesystem access to specific folders. When empty, all paths
        are allowed.
      </p>

      {error && (
        <div className="fss-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="fss-list">
        {directories.length === 0 ? (
          <div className="fss-empty">
            No directories restricted — all paths are accessible.
          </div>
        ) : (
          directories.map((dir) => (
            <div key={dir} className="fss-dir-row">
              <FolderOpen size={14} className="fss-dir-icon" />
              <span className="fss-dir-path" title={dir}>
                {dir}
              </span>
              <button
                type="button"
                className="fss-remove-btn"
                onClick={() => handleRemoveDirectory(dir)}
                disabled={saving}
                aria-label={`Remove ${dir}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        className="btn-secondary fss-add-btn"
        onClick={handleAddDirectory}
        disabled={saving}
      >
        <Plus size={14} />
        Add Directory
      </button>
    </div>
  );
}
