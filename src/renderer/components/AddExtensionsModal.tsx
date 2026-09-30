import { useEffect, useState, MouseEvent, KeyboardEvent } from 'react';
import {
  X,
  Plus,
  Check,
  Loader2,
  FolderOpen,
  Puzzle,
  AlertCircle,
} from 'lucide-react';
import {
  fetchOfficialExtensions,
  invalidateCache,
  isOfficialExtension,
  type OfficialExtensionInfo,
} from '../utils/extensionData';
import { resolveIcon } from './workflows/IconPicker';
import { svgToDataUrl } from '../utils/svgToDataUrl';
import './styles/AddExtensionsModal.css';

interface AddExtensionsModalProps {
  onClose: () => void;
  onAdded: () => void;
}

function OfficialIcon({
  manifest,
}: {
  manifest: OfficialExtensionInfo['manifest'];
}) {
  if (manifest.iconSvgData) {
    return (
      <img
        src={svgToDataUrl(manifest.iconSvgData)}
        alt=""
        className="aem-card__svg-icon"
      />
    );
  }
  const IconComp = manifest.icon ? resolveIcon(manifest.icon) : Puzzle;
  return <IconComp size={22} className="aem-card__lucide-icon" />;
}

export default function AddExtensionsModal({
  onClose,
  onAdded,
}: AddExtensionsModalProps) {
  const [catalog, setCatalog] = useState<OfficialExtensionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [installingExternal, setInstallingExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await fetchOfficialExtensions();
        if (!cancelled) setCatalog(list);
      } catch {
        if (!cancelled) setError('Failed to load official extensions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose();
  };

  const handleAdd = async (id: string) => {
    setAddingId(id);
    setError(null);
    try {
      const result = await window.electronAPI.extensionsAddOfficial(id);
      if (result.success) {
        invalidateCache();
        const refreshed = await fetchOfficialExtensions();
        setCatalog(refreshed);
        onAdded();
      } else {
        setError(result.error || 'Failed to add extension');
      }
    } catch {
      setError('Failed to add extension');
    } finally {
      setAddingId(null);
    }
  };

  const handleInstallExternal = async () => {
    setInstallingExternal(true);
    setError(null);
    try {
      const result = await window.electronAPI.extensionsInstall();
      if (result.success) {
        invalidateCache();
        onAdded();
      } else if (result.error !== 'Cancelled') {
        setError(result.error || 'Installation failed');
      }
    } catch {
      setError('Installation failed');
    } finally {
      setInstallingExternal(false);
    }
  };

  const renderAddContent = (isAdded: boolean, isAdding: boolean) => {
    if (isAdding) {
      return (
        <>
          <Loader2 size={13} className="aem-spinner" />
          Adding...
        </>
      );
    }
    if (isAdded) {
      return (
        <>
          <Check size={13} />
          Added
        </>
      );
    }
    return (
      <>
        <Plus size={13} />
        Add
      </>
    );
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="aem-empty">
          <Loader2 size={20} className="aem-spinner" />
          <p>Loading official extensions...</p>
        </div>
      );
    }
    if (catalog.length === 0) {
      return (
        <div className="aem-empty">
          <Puzzle size={28} />
          <p>No official extensions available.</p>
        </div>
      );
    }
    return (
      <div className="aem-grid">
        {catalog.map((ext) => {
          const toolCount = Object.keys(ext.tools).length;
          const isAdded = ext.added;
          const isAdding = addingId === ext.manifest.id;
          const showOfficial = isOfficialExtension(ext.manifest);

          return (
            <div
              key={ext.manifest.id}
              className={`aem-card${isAdded ? ' aem-card--added' : ''}`}
            >
              <div className="aem-card__top">
                <div className="aem-card__icon-wrap">
                  <OfficialIcon manifest={ext.manifest} />
                </div>
              </div>
              <div className="aem-card__body">
                <div className="aem-card__name-row">
                  <h3 className="aem-card__name">{ext.manifest.name}</h3>
                  {showOfficial && (
                    <span className="aem-card__official-badge">Official</span>
                  )}
                </div>
                <p className="aem-card__description">
                  {ext.manifest.description}
                </p>
                <div className="aem-card__meta-row">
                  <span className="aem-card__tool-count">
                    {toolCount} tools
                  </span>
                  <span className="aem-card__version">
                    v{ext.manifest.version}
                  </span>
                </div>
              </div>
              <div className="aem-card__actions">
                <button
                  type="button"
                  className={`aem-card__add-btn${isAdded ? ' aem-card__add-btn--added' : ''}`}
                  disabled={isAdded || isAdding}
                  onClick={() => handleAdd(ext.manifest.id)}
                >
                  {renderAddContent(isAdded, isAdding)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="aem-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Add extensions"
    >
      <div className="aem-dialog">
        <div className="aem-header">
          <h2 className="aem-title">Add Extensions</h2>
          <button
            type="button"
            className="aem-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="aem-external-wrap">
          <button
            type="button"
            className="aem-external-bar"
            onClick={handleInstallExternal}
            disabled={installingExternal}
          >
            {installingExternal ? (
              <Loader2 size={16} className="aem-spinner" />
            ) : (
              <FolderOpen size={16} />
            )}
            Install External Extension
          </button>
        </div>

        {error && (
          <div className="aem-error" role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="aem-body">
          <div className="aem-section-label">Official</div>
          {renderBody()}
        </div>
      </div>
    </div>
  );
}
