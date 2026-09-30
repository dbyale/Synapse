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
  isAddableOfficialExtension,
  isOfficialExtension,
  type ExtensionInfo,
} from '../utils/extensionData';
import { resolveIcon } from '../components/workflows/IconPicker';
import { svgToDataUrl } from '../utils/svgToDataUrl';
import ConfirmDialog from '../components/ConfirmDialog';
import ExtensionModal from '../components/ExtensionModal';
import AddExtensionsModal from '../components/AddExtensionsModal';
import '../styles/ExtensionsPage.css';

export function ExtensionIcon({
  manifest,
}: {
  manifest: ExtensionInfo['manifest'];
}) {
  if (manifest.iconSvgData) {
    return (
      <img
        src={svgToDataUrl(manifest.iconSvgData)}
        alt=""
        className="ep-card__svg-icon"
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
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [detailExt, setDetailExt] = useState<ExtensionInfo | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

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

  const handleAdded = useCallback(async () => {
    invalidateCache();
    await loadExtensions();
  }, [loadExtensions]);

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
      await loadExtensions();
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

  const officialExtensions = extensions.filter((e) =>
    isAddableOfficialExtension(e.manifest),
  );
  const installedExtensions = extensions.filter(
    (e) => !isAddableOfficialExtension(e.manifest),
  );
  const removeTarget = extensions.find((e) => e.manifest.id === removeId);
  const removeIsOfficial =
    removeTarget != null && isAddableOfficialExtension(removeTarget.manifest);

  const renderCard = (ext: ExtensionInfo, idx: number) => {
    const toolCount = Object.keys(ext.tools).length;
    const showOfficial = isOfficialExtension(ext.manifest);
    // Built-ins show both badges (visual only) but are never removable and
    // never leave the built-in section. Only addable officials are removable.
    const canRemove = !ext.manifest.builtIn;

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
            {canRemove && (
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
            {showOfficial && (
              <span className="ep-card__official-badge">Official</span>
            )}
          </div>

          <p className="ep-card__description">{ext.manifest.description}</p>

          <div className="ep-card__meta-row">
            <span className="ep-card__tool-count">{toolCount} tools</span>
            {ext.manifest.author !== 'Synapse' && (
              <span className="ep-card__author">by {ext.manifest.author}</span>
            )}
            <span className="ep-card__version">v{ext.manifest.version}</span>
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
        </div>
      </div>
    );
  };

  return (
    <div className="ep-page">
      <div className="ep-page__header">
        <div className="ep-page__header-text">
          <h1>Extensions</h1>
          <p>
            Manage installed extensions. Each extension provides a set of tools
            that the AI can use. Official extensions can be added on demand;
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
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} />
            Add Extensions
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
              Click <strong>Add Extensions</strong> to add one.
            </p>
          </div>
        ) : (
          <>
            <section className="ep-section" aria-label="Official extensions">
              <div className="ep-section__header">
                <h2 className="ep-section__title">Official</h2>
                <span className="ep-section__count">
                  {officialExtensions.length}
                </span>
              </div>
              {officialExtensions.length === 0 ? (
                <p className="ep-section__empty">
                  No official extensions added yet. Use Add Extensions below to
                  add one.
                </p>
              ) : (
                <div className="ep-grid">
                  {officialExtensions.map((ext, idx) => renderCard(ext, idx))}
                </div>
              )}
            </section>

            <section className="ep-section" aria-label="Installed extensions">
              <div className="ep-section__header">
                <h2 className="ep-section__title">Installed</h2>
                <span className="ep-section__count">
                  {installedExtensions.length}
                </span>
              </div>
              {installedExtensions.length === 0 ? (
                <p className="ep-section__empty">
                  No other extensions installed.
                </p>
              ) : (
                <div className="ep-grid">
                  {installedExtensions.map((ext, idx) =>
                    renderCard(ext, idx + officialExtensions.length),
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {!loading && extensions.length > 0 && (
        <button
          type="button"
          className="ep-fullwidth-bar ep-fullwidth-bar--add"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} />
          Add Extensions
        </button>
      )}

      {removeId && (
        <ConfirmDialog
          title="Remove Extension?"
          message={
            removeIsOfficial
              ? `Remove "${removeTarget?.manifest.name ?? removeId}"? It will be returned to the Add Extensions catalog and can be re-added at any time.`
              : `Remove "${extensions.find((e) => e.manifest.id === removeId)?.manifest.name ?? removeId}"? This will delete the extension folder and all its files.`
          }
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

      {showAddModal && (
        <AddExtensionsModal
          onClose={() => setShowAddModal(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
