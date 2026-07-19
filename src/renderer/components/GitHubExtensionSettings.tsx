import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Users,
  FolderOpen,
} from 'lucide-react';
import './styles/GitHubExtensionSettings.css';

interface GitHubSettings {
  appId?: string;
  installationId?: string;
  privateKey?: string;
  allowedRepos?: string[];
  coAuthorName?: string;
  coAuthorEmail?: string;
}

export default function GitHubExtensionSettings() {
  const [tab, setTab] = useState<'auth' | 'coauthor' | 'repos'>('auth');
  const [settings, setSettings] = useState<GitHubSettings>({
    allowedRepos: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [newRepo, setNewRepo] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const privateKeyRef = useRef<HTMLTextAreaElement>(null);

  async function loadSettings() {
    setLoading(true);
    try {
      const s = await window.electronAPI.extensionsGetSettings('github');
      setSettings({ allowedRepos: [], ...s });
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    return () => {
      const s = settingsRef.current;
      window.electronAPI.extensionsSetSettings('github', s).catch(() => {});
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await window.electronAPI.extensionsSetSettings('github', settings);
      setMessage('Settings saved successfully');
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function handleAddRepo() {
    const repo = newRepo
      .trim()
      .replace('https://github.com/', '')
      .replace('.git', '');
    if (!repo) return;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      setError('Invalid format. Use "owner/repo"');
      return;
    }
    const updated = [...(settings.allowedRepos || [])];
    if (!updated.some((r) => r.toLowerCase() === repo.toLowerCase())) {
      updated.push(repo);
      setSettings({ ...settings, allowedRepos: updated });
    }
    setNewRepo('');
    setError(null);
  }

  function handleRemoveRepo(repo: string) {
    setSettings({
      ...settings,
      allowedRepos: (settings.allowedRepos || []).filter((r) => r !== repo),
    });
  }

  function handleRepoKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddRepo();
    }
  }

  if (loading) {
    return <div className="ghes-loading">Loading settings...</div>;
  }

  return (
    <div className="ghes">
      {error && (
        <div className="ghes-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {message && <div className="ghes-success">{message}</div>}

      <div className="ghes-tabs">
        <button
          type="button"
          className={`ghes-tab${tab === 'auth' ? ' ghes-tab--active' : ''}`}
          onClick={() => setTab('auth')}
        >
          <KeyRound size={14} />
          Authentication
        </button>
        <button
          type="button"
          className={`ghes-tab${tab === 'coauthor' ? ' ghes-tab--active' : ''}`}
          onClick={() => setTab('coauthor')}
        >
          <Users size={14} />
          Co-Author
        </button>
        <button
          type="button"
          className={`ghes-tab${tab === 'repos' ? ' ghes-tab--active' : ''}`}
          onClick={() => setTab('repos')}
        >
          <FolderOpen size={14} />
          Repositories
        </button>
      </div>

      <div className="ghes-body">
        {tab === 'auth' && (
          <div className="ghes-tab-content">
            <div className="ghes-section">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="ghes-label" htmlFor="ghes-appid">
                App ID
              </label>
              <input
                id="ghes-appid"
                type="text"
                className="ghes-input"
                value={settings.appId || ''}
                onChange={(e) =>
                  setSettings({ ...settings, appId: e.target.value })
                }
                placeholder="123456"
              />
            </div>
            <div className="ghes-section">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="ghes-label" htmlFor="ghes-instid">
                Installation ID
              </label>
              <input
                id="ghes-instid"
                type="text"
                className="ghes-input"
                value={settings.installationId || ''}
                onChange={(e) =>
                  setSettings({ ...settings, installationId: e.target.value })
                }
                placeholder="654321"
              />
            </div>
            <div className="ghes-section">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="ghes-label" htmlFor="ghes-pkey">
                Private Key (PEM)
              </label>
              <div className="ghes-input-wrap">
                <textarea
                  ref={privateKeyRef}
                  id="ghes-pkey"
                  className={`ghes-textarea${!showKey ? ' ghes-textarea--masked' : ''}`}
                  value={settings.privateKey || ''}
                  onChange={(e) =>
                    setSettings({ ...settings, privateKey: e.target.value })
                  }
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                  rows={4}
                />
                <button
                  type="button"
                  className="ghes-toggle-btn ghes-toggle-btn--textarea"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'coauthor' && (
          <div className="ghes-tab-content">
            <p className="ghes-hint">
              When set, every commit created by the model will include a
              Co-authored-by trailer with this name and email.
            </p>
            <div className="ghes-section">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="ghes-label" htmlFor="ghes-coauthor-name">
                Name
              </label>
              <input
                id="ghes-coauthor-name"
                type="text"
                className="ghes-input"
                value={settings.coAuthorName || ''}
                onChange={(e) =>
                  setSettings({ ...settings, coAuthorName: e.target.value })
                }
                placeholder="Jane Doe"
              />
            </div>
            <div className="ghes-section">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="ghes-label" htmlFor="ghes-coauthor-email">
                Email
              </label>
              <input
                id="ghes-coauthor-email"
                type="text"
                className="ghes-input"
                value={settings.coAuthorEmail || ''}
                onChange={(e) =>
                  setSettings({ ...settings, coAuthorEmail: e.target.value })
                }
                placeholder="jane@example.com"
              />
            </div>
          </div>
        )}

        {tab === 'repos' && (
          <div className="ghes-tab-content">
            <p className="ghes-hint">
              When empty, all accessible repositories can be used. Add specific
              repos to restrict access.
            </p>
            <div className="ghes-repo-input-row">
              <input
                type="text"
                className="ghes-input ghes-input--mono"
                value={newRepo}
                onChange={(e) => setNewRepo(e.target.value)}
                onKeyDown={handleRepoKeyDown}
                placeholder="owner/repo"
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddRepo}
                disabled={!newRepo.trim()}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
            <div className="ghes-repo-list">
              {!settings.allowedRepos || settings.allowedRepos.length === 0 ? (
                <div className="ghes-empty">
                  No restrictions — all repos accessible.
                </div>
              ) : (
                settings.allowedRepos.map((repo) => (
                  <div key={repo} className="ghes-repo-row">
                    <span className="ghes-repo-name">{repo}</span>
                    <button
                      type="button"
                      className="ghes-remove-btn"
                      onClick={() => handleRemoveRepo(repo)}
                      aria-label={`Remove ${repo}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="ghes-actions">
        <button
          type="button"
          className="btn-accent"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
