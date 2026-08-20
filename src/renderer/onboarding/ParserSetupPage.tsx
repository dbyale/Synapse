import { useEffect, useState } from 'react';
import {
  Apple,
  ArrowLeft,
  ArrowRight,
  Binary,
  Check,
  Cpu,
  Download,
  FolderOpen,
  Gpu,
  HardDrive,
  List,
  Loader2,
  Microchip,
  PackageOpen,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactComponent as NvidiaLogo } from '../../../assets/logos/nvidia.svg';
import type {
  BackendDownload,
  BackendTag,
  DownloadProgress,
  ParserInfo,
} from '../preload.d';

const ICON_MAP: Record<BackendDownload['icon'], LucideIcon> = {
  cuda: Gpu,
  opencl: Gpu,
  vulkan: Sparkles,
  apple: Apple,
  cpu: Cpu,
  openvino: Microchip,
  rocm: Gpu,
  sycl: Gpu,
  android: Smartphone,
  parser: Binary,
  custom: HardDrive,
};

const TAG_BADGES: Record<BackendTag, { label: string; className: string }> = {
  'no-gpu': { label: 'No Valid GPU', className: 'onb-backend-badge-red' },
  'wrong-arch': {
    label: 'Wrong Architecture',
    className: 'onb-backend-badge-red',
  },
  outdated: { label: 'Outdated', className: 'onb-backend-badge-yellow' },
};

function ParserCardIcon({ download }: { download: BackendDownload }) {
  const Icon = ICON_MAP[download.icon];
  if (download.icon === 'cuda') {
    return <NvidiaLogo className="onb-backend-logo" />;
  }
  if (download.dualIcon) {
    return (
      <>
        <Gpu size={22} strokeWidth={2} />
        <Cpu size={22} strokeWidth={2} />
      </>
    );
  }
  return <Icon size={24} strokeWidth={2} />;
}

type DownloadStatus = 'downloading' | 'completed' | 'failed' | 'cancelled';

function DownloadIcon({ status }: { status: DownloadStatus | undefined }) {
  if (status === 'completed') return <Check size={18} strokeWidth={2} />;
  if (status === 'downloading') {
    return (
      <Loader2 size={18} strokeWidth={2} className="onb-backend-spinner" />
    );
  }
  return <Download size={18} strokeWidth={2} />;
}

function ParserCard({
  download,
  onDownload,
  status,
  disabled,
}: {
  download: BackendDownload;
  onDownload: (download: BackendDownload) => void;
  status: DownloadStatus | undefined;
  disabled: boolean;
}) {
  const isDownloading = status === 'downloading';
  const isCompleted = status === 'completed';
  const cardClass = [
    'onb-backend-card',
    isDownloading ? 'onb-backend-card--downloading' : '',
    isCompleted ? 'onb-backend-card--completed' : '',
    disabled ? 'onb-backend-card--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClass}>
      <span className="onb-backend-card-icon">
        <ParserCardIcon download={download} />
      </span>
      <span className="onb-backend-card-body">
        <span className="onb-backend-card-title-row">
          <span className="onb-backend-card-title">{download.label}</span>
          {download.recommended && (
            <span className="onb-backend-recommended">Recommended</span>
          )}
          {download.experimental && (
            <span className="onb-backend-experimental">Experimental</span>
          )}
          {download.tags?.map((tag) => {
            const badge = TAG_BADGES[tag];
            return (
              <span key={tag} className={badge.className}>
                {badge.label}
              </span>
            );
          })}
        </span>
        {download.sublabel && (
          <span className="onb-backend-card-sublabel">{download.sublabel}</span>
        )}
      </span>
      {download.url && (
        <button
          type="button"
          className="onb-backend-download"
          title={
            isCompleted
              ? `${download.label} — downloaded`
              : `Download ${download.label}`
          }
          onClick={() => onDownload(download)}
          disabled={isDownloading || disabled}
        >
          <DownloadIcon status={status} />
        </button>
      )}
    </div>
  );
}

export default function ParserSetupPage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const [info, setInfo] = useState<ParserInfo | null>(null);
  const [downloadDir, setDownloadDir] = useState('');
  const [customBinaries, setCustomBinaries] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [dlStatus, setDlStatus] = useState<Record<string, DownloadStatus>>({});

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [parser, settings] = await Promise.all([
          window.electronAPI.getParserInfo(),
          window.electronAPI.loadSettings(),
        ]);
        if (!mounted) return;
        setInfo(parser);
        setDownloadDir(settings.parserDirectory || parser.defaultDownloadDir);
        setCustomBinaries(settings.parserCustomBinaryPaths ?? []);
        setDlStatus((prev) => {
          const next = { ...prev };
          if (settings.parserDownloads) {
            next[settings.parserDownloads.id] = 'completed';
          }
          return next;
        });
      } catch {
        // Silently fail — page still renders with an editable path
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!othersOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOthersOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [othersOpen]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onDownloadProgress(
      (progress: DownloadProgress) => {
        const { modelId, status } = progress;
        if (!modelId || !status) return;
        if (
          status === 'completed' ||
          status === 'failed' ||
          status === 'cancelled'
        ) {
          setDlStatus((prev) => ({ ...prev, [modelId]: status }));
        }
      },
    );
    return unsubscribe;
  }, []);

  const optional = info?.optional ?? [];
  const custom = optional.find((d) => d.id === 'custom');
  const others = optional.filter((d) => d.id !== 'custom');
  const allBuilds = info ? [...others, ...info.others] : [];
  const parserHasDownload = Object.values(dlStatus).some(
    (s) => s === 'completed',
  );
  const anyDownloading = Object.values(dlStatus).some(
    (s) => s === 'downloading',
  );
  // Only one parser is ever allowed: once downloaded or connected, every
  // other option stays disabled until a connected custom path is removed.
  const locked = parserHasDownload || customBinaries.length > 0;
  const canContinue =
    !!info && (parserHasDownload || customBinaries.length > 0);

  const handleBrowse = async () => {
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir) setDownloadDir(dir);
    } catch {
      // Silently fail
    }
  };

  const handleAddBinaries = async () => {
    if (locked || anyDownloading) return;
    try {
      const paths = await window.electronAPI.browseForFiles({
        title: 'Select GGUF Parser binary',
        filters: [
          {
            name: 'Executables',
            extensions: ['exe', 'bin', 'cmd', 'bat', 'sh', 'out'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
        multiSelections: true,
      });
      if (paths.length === 0) return;
      setCustomBinaries((prev) => {
        const next = [...prev];
        paths.forEach((p) => {
          if (!next.includes(p)) next.push(p);
        });
        return next;
      });
    } catch {
      // Silently fail
    }
  };

  const handleRemoveBinary = (binary: string) => {
    setCustomBinaries((prev) => prev.filter((p) => p !== binary));
  };

  const handleDownload = async (download: BackendDownload) => {
    if (!download.url) return;
    setDlStatus((prev) => ({ ...prev, [download.id]: 'downloading' }));
    window.dispatchEvent(
      new CustomEvent('open-download-manager', {
        detail: { modelId: download.id, filename: download.label },
      }),
    );
    try {
      await window.electronAPI.downloadBinary('parser', download, downloadDir);
      setDlStatus((prev) => ({ ...prev, [download.id]: 'completed' }));
    } catch {
      // Status events from the main process drive the final state
    }
  };

  const handleContinue = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const settings = await window.electronAPI.loadSettings();
      await window.electronAPI.saveSettingsSilent({
        ...settings,
        parserDirectory: downloadDir,
        parserCustomBinaryPaths: customBinaries,
      });
    } catch {
      // Silently fail — installation location still applied in memory
    }
    onContinue();
  };

  return (
    <div className="onb-page onb-backend-page">
      <button
        type="button"
        aria-label="Back to backend setup"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-backend">
        <div className="onb-backend-info">
          <h1 className="onb-professions-title onb-rise onb-delay-1">
            Parser Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            The GGUF Parser Go reads model files to estimate how much memory
            each one needs. It is installed next to your models folder, and
            downloads continue in the background after you continue.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            The recommended build below matches your system architecture. Any
            other build can be added manually or viewed under All Builds.
          </p>
        </div>

        <div className="onb-backend-right">
          {!info ? (
            <p className="onb-professions-hint onb-rise onb-delay-1">
              Detecting system…
            </p>
          ) : (
            <>
              <div className="onb-backend-section onb-rise onb-delay-1">
                <p className="onb-professions-hint">Download location</p>
                <div className="onb-path-row">
                  <input
                    className="onb-path-input"
                    value={downloadDir}
                    onChange={(e) => setDownloadDir(e.target.value)}
                    placeholder="Choose where the parser is downloaded"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="onb-path-browse"
                    onClick={handleBrowse}
                    title="Browse"
                  >
                    <FolderOpen size={16} strokeWidth={2} />
                  </button>
                </div>
                <p className="onb-backend-path-hint">
                  Installed in a folder next to your models folder by default.
                </p>
              </div>

              <div className="onb-backend-section onb-rise onb-delay-2">
                <p className="onb-professions-hint">Recommended</p>
                <div className="onb-backend-cards">
                  {info.recommended.map((download) => (
                    <ParserCard
                      key={download.id}
                      download={download}
                      onDownload={handleDownload}
                      status={dlStatus[download.id]}
                      disabled={
                        (locked || anyDownloading) &&
                        dlStatus[download.id] !== 'completed'
                      }
                    />
                  ))}
                </div>
              </div>

              {(others.length > 0 || custom) && (
                <div className="onb-backend-section onb-rise onb-delay-3">
                  <p className="onb-professions-hint">Optional</p>
                  <div className="onb-backend-cards">
                    {others.map((download) => (
                      <ParserCard
                        key={download.id}
                        download={download}
                        onDownload={handleDownload}
                        status={dlStatus[download.id]}
                        disabled={
                          (locked || anyDownloading) &&
                          dlStatus[download.id] !== 'completed'
                        }
                      />
                    ))}
                    {custom && (
                      <div
                        className={`onb-backend-card${locked || anyDownloading ? ' onb-backend-card--disabled' : ''}`}
                      >
                        <span className="onb-backend-card-icon">
                          <HardDrive size={24} strokeWidth={2} />
                        </span>
                        <span className="onb-backend-card-body">
                          <span className="onb-backend-card-title-row">
                            <span className="onb-backend-card-title">
                              Custom Binary
                            </span>
                          </span>
                          <span className="onb-backend-card-sublabel">
                            Select your own GGUF Parser build — as many as you
                            like
                          </span>
                          {customBinaries.length > 0 && (
                            <div className="onb-custom-list">
                              {customBinaries.map((binary) => (
                                <div key={binary} className="onb-path-row">
                                  <input
                                    className="onb-path-input"
                                    value={binary}
                                    readOnly
                                    spellCheck={false}
                                  />
                                  <button
                                    type="button"
                                    aria-label={`Remove ${binary}`}
                                    className="onb-custom-remove"
                                    onClick={() => handleRemoveBinary(binary)}
                                  >
                                    <Trash2 size={16} strokeWidth={2} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className="onb-custom-add"
                            onClick={handleAddBinaries}
                            disabled={locked || anyDownloading}
                          >
                            <Plus size={16} strokeWidth={2} />
                            Add Binary
                          </button>
                        </span>
                      </div>
                    )}
                    {allBuilds.length > 0 && (
                      <div
                        className={`onb-backend-card onb-backend-other${locked || anyDownloading ? ' onb-backend-card--disabled' : ''}`}
                      >
                        <button
                          type="button"
                          className="onb-backend-other-toggle"
                          onClick={() => setOthersOpen(true)}
                          disabled={locked || anyDownloading}
                        >
                          <span className="onb-backend-card-icon">
                            <PackageOpen size={22} strokeWidth={2} />
                          </span>
                          <span className="onb-backend-card-body">
                            <span className="onb-backend-card-title-row">
                              <span className="onb-backend-card-title">
                                All Builds
                              </span>
                              <span className="onb-backend-other-count">
                                {allBuilds.length}
                              </span>
                            </span>
                            <span className="onb-backend-card-sublabel">
                              Every other prebuilt binary
                            </span>
                          </span>
                          <List
                            size={18}
                            strokeWidth={2}
                            className="onb-backend-other-open"
                          />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="onb-professions-footer onb-rise onb-delay-4">
        <button
          type="button"
          className="onb-continue"
          onClick={handleContinue}
          disabled={!canContinue || saving}
        >
          Continue
          <ArrowRight size={20} strokeWidth={2} />
        </button>
      </div>

      {info && othersOpen && (
        <div className="onb-backend-overlay">
          <button
            type="button"
            aria-label="Close"
            className="onb-backend-overlay-backdrop"
            onClick={() => setOthersOpen(false)}
          />
          <div
            className="onb-backend-overlay-panel"
            role="dialog"
            aria-modal="true"
            aria-label="All GGUF Parser builds"
          >
            <div className="onb-backend-overlay-header">
              <div className="onb-backend-overlay-heading">
                <h2 className="onb-backend-overlay-title">All Builds</h2>
                <p className="onb-backend-overlay-sub">
                  Every prebuilt GGUF Parser build for this platform
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="onb-backend-overlay-close"
                onClick={() => setOthersOpen(false)}
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="onb-backend-overlay-list">
              {allBuilds.map((download) => (
                <ParserCard
                  key={download.id}
                  download={download}
                  onDownload={handleDownload}
                  status={dlStatus[download.id]}
                  disabled={
                    (locked || anyDownloading) &&
                    dlStatus[download.id] !== 'completed'
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
