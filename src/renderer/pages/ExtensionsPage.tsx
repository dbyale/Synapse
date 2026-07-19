import { useState, useEffect, useCallback } from 'react';
import {
  Puzzle,
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
  X,
  Check,
  FolderOpen,
} from 'lucide-react';
import {
  fetchExtensionData,
  getExtensions,
  invalidateCache,
} from '../utils/extensionData';
import { resolveIcon } from '../components/workflows/IconPicker';
import ConfirmDialog from '../components/ConfirmDialog';
import ExtensionModal from '../components/ExtensionModal';
import '../styles/ExtensionsPage.css';

type ExtensionInfo = {
  manifest: {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    icon: string;
    builtIn: boolean;
    iconSvgData?: string;
    hasSettings?: boolean;
  };
  tools: Record<
    string,
    {
      meta: { name: string; label: string; description: string; icon: string };
      params: Record<string, any>;
    }
  >;
  enabled: boolean;
  extensionDir?: string;
};

function ExtensionIcon({ manifest }: { manifest: ExtensionInfo['manifest'] }) {
  if (manifest.iconSvgData) {
    const svgContent = atob(manifest.iconSvgData.split(',')[1]);
    return (
      <span
        className="ep-card__svg-icon"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    );
  }
  const IconComp = manifest.icon ? resolveIcon(manifest.icon) : Puzzle;
  return <IconComp size={22} className="ep-card__lucide-icon" />;
}

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [detailExt, setDetailExt] = useState<ExtensionInfo | null>(null);

  const loadExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchExtensionData();
      setExtensions(getExtensions());
    } catch {
      setError('Failed to load extensions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExtensions();
  }, [loadExtensions]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const result = await window.electronAPI.extensionsInstall();
      if (result.success) {
        invalidateCache();
        await loadExtensions();
      } else if (result.error !== 'Cancelled') {
        setError(result.error || 'Installation failed');
      }
    } catch {
      setError('Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const handleRemove = async () => {
    if (!removeId) return;
    try {
      const result = await window.electronAPI.extensionsRemove(removeId);
      if (result.success) {
        invalidateCache();
        await loadExtensions();
      } else {
        setError(result.error || 'Removal failed');
      }
    } catch {
      setError('Removal failed');
    } finally {
      setRemoveId(null);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await window.electronAPI.extensionsToggle(id, enabled);
      invalidateCache();
      setExtensions((prev) =>
        prev.map((e) => (e.manifest.id === id ? { ...e, enabled } : e)),
      );
    } catch {
      setError('Failed to toggle extension');
    }
  };

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.extensionsOpenFolder();
    } catch {
      setError('Failed to open extensions folder');
    }
  };

  return (
    <div className="ep-page">
      <div className="ep-page__header">
        <div className="ep-page__header-text">
          <h1>Extensions</h1>
          <p>
            Manage installed extensions. Each extension provides a set of tools
            that the AI can use. Built-in extensions are always available;
            user-installed extensions can be added or removed.
          </p>
        </div>
        <div className="ep-page__header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleOpenFolder}
          >
            <FolderOpen size={16} />
            Open Folder
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={handleInstall}
            disabled={installing}
          >
            {installing ? (
              <Loader2 size={16} className="ep-spinner" />
            ) : (
              <Plus size={16} />
            )}
            Install Extension
          </button>
        </div>
      </div>

      {error && (
        <div className="ep-page__error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button
            type="button"
            className="ep-page__error-close"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="ep-page__content">
        {loading ? (
          <div className="ep-page__empty">
            <Loader2 size={24} className="ep-spinner" />
            <p>Loading extensions...</p>
          </div>
        ) : extensions.length === 0 ? (
          <div className="ep-page__empty">
            <Puzzle size={32} />
            <p>No extensions found.</p>
            <p>
              Click <strong>Install Extension</strong> to add one.
            </p>
          </div>
        ) : (
          <div className="ep-grid">
            {extensions.map((ext, idx) => {
              const toolCount = Object.keys(ext.tools).length;
              const enabledCount = ext.enabled ? toolCount : 0;

              return (
                <div
                  key={ext.manifest.id || `ext-${idx}`}
                  className={`ep-card${!ext.enabled ? ' ep-card--disabled' : ''}`}
                  onClick={() => setDetailExt(ext)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetailExt(ext);
                    }
                  }}
                >
                  <div className="ep-card__top">
                    <div className="ep-card__icon-wrap">
                      <ExtensionIcon manifest={ext.manifest} />
                    </div>
                    <div className="ep-card__actions-top">
                      {!ext.manifest.builtIn && (
                        <button
                          type="button"
                          className="ep-card__action-btn ep-card__action-btn--danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRemoveId(ext.manifest.id || ext.manifest.name);
                          }}
                          title="Remove extension"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="ep-card__body">
                    <div className="ep-card__name-row">
                      <h3 className="ep-card__name">{ext.manifest.name}</h3>
                      {ext.manifest.builtIn && (
                        <span className="ep-card__builtin-badge">Built-in</span>
                      )}
                    </div>

                    <p className="ep-card__description">
                      {ext.manifest.description}
                    </p>

                    <div className="ep-card__meta-row">
                      <span className="ep-card__tool-count">
                        {enabledCount}/{toolCount} tools
                      </span>
                      {ext.manifest.author !== 'Synapse' && (
                        <span className="ep-card__author">
                          by {ext.manifest.author}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ep-card__actions">
                    <button
                      type="button"
                      className={`ep-card__toggle-btn${ext.enabled ? ' ep-card__toggle-btn--on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(ext.manifest.id, !ext.enabled);
                      }}
                    >
                      {ext.enabled ? (
                        <>
                          <Check size={12} />
                          Enabled
                        </>
                      ) : (
                        <>
                          <X size={12} />
                          Disabled
                        </>
                      )}
                    </button>
                    <span className="ep-card__version">
                      v{ext.manifest.version}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {removeId && (
        <ConfirmDialog
          title="Remove Extension?"
          message={`Remove "${extensions.find((e) => e.manifest.id === removeId)?.manifest.name ?? removeId}"? This will delete the extension folder and all its files.`}
          confirmText="Remove"
          cancelText="Cancel"
          onConfirm={handleRemove}
          onCancel={() => setRemoveId(null)}
        />
      )}

      {detailExt && (
        <ExtensionModal
          extension={detailExt}
          onClose={() => setDetailExt(null)}
        />
      )}
    </div>
  );
}
