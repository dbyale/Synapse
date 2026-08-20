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
  TriangleAlert,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactComponent as NvidiaLogo } from '../../../assets/logos/nvidia.svg';
import type {
  BackendDownload,
  BackendInfo,
  BackendTag,
  DownloadProgress,
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

function BackendCardIcon({ download }: { download: BackendDownload }) {
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

function BackendCard({
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
        <BackendCardIcon download={download} />
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
        {download.warning && (
          <span className="onb-backend-warning">
            <TriangleAlert size={13} strokeWidth={2.2} />
            {download.warning}
          </span>
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

export default function BackendSetupPage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const [info, setInfo] = useState<BackendInfo | null>(null);
  const [downloadDir, setDownloadDir] = useState('');
  const [customBinaries, setCustomBinaries] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [dlStatus, setDlStatus] = useState<Record<string, DownloadStatus>>({});

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [backend, settings] = await Promise.all([
          window.electronAPI.getBackendInfo(),
          window.electronAPI.loadSettings(),
        ]);
        if (!mounted) return;
        setInfo(backend);
        setDownloadDir(settings.backendDirectory || backend.defaultDownloadDir);
        setCustomBinaries(settings.customBinaryPaths ?? []);
        setDlStatus((prev) => {
          const next = { ...prev };
          (settings.backendDownloads ?? []).forEach((d) => {
            next[d.id] = 'completed';
          });
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

  const handleBrowse = async () => {
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir) setDownloadDir(dir);
    } catch {
      // Silently fail
    }
  };

  const handleAddBinaries = async () => {
    try {
      const paths = await window.electronAPI.browseForFiles({
        title: 'Select llama-server binary',
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
      await window.electronAPI.downloadBinary('backend', download, downloadDir);
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
        backendDirectory: downloadDir,
        customBinaryPaths: customBinaries,
      });
    } catch {
      // Silently fail — installation location still applied in memory
    }
    onContinue();
  };

  const optional = info?.optional ?? [];
  const custom = optional.find((d) => d.id === 'custom');
  const others = optional.filter((d) => d.id !== 'custom');
  const allBackends = info ? [...others, ...info.others] : [];
  const completedAny = Object.values(dlStatus).some((s) => s === 'completed');
  const canContinue = !!info && (completedAny || customBinaries.length > 0);

  return (
    <div className="onb-page onb-backend-page">
      <button
        type="button"
        aria-label="Back to setup experience"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-backend">
        <div className="onb-backend-info">
          <h1 className="onb-professions-title onb-rise onb-delay-1">
            Backend Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            The inference backends run your models locally. They are installed
            next to your models folder, and downloads continue in the background
            after you continue.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            The recommended downloads below are picked from your detected
            hardware. A Vulkan backend is always included as a backup — it also
            covers CPU inference.
          </p>

          {(info?.warnings ?? []).map((warning) => (
            <div
              key={warning}
              className="onb-backend-warning-box onb-rise onb-delay-3"
            >
              <TriangleAlert size={16} strokeWidth={2.2} />
              <span>{warning}</span>
            </div>
          ))}
        </div>

        <div className="onb-backend-right">
          {!info ? (
            <p className="onb-professions-hint onb-rise onb-delay-1">
              Detecting hardware…
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
                    placeholder="Choose where backends are downloaded"
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
                    <BackendCard
                      key={download.id}
                      download={download}
                      onDownload={handleDownload}
                      status={dlStatus[download.id]}
                      disabled={false}
                    />
                  ))}
                </div>
              </div>

              {(others.length > 0 || custom) && (
                <div className="onb-backend-section onb-rise onb-delay-3">
                  <p className="onb-professions-hint">Optional</p>
                  <div className="onb-backend-cards">
                    {others.map((download) => (
                      <BackendCard
                        key={download.id}
                        download={download}
                        onDownload={handleDownload}
                        status={dlStatus[download.id]}
                        disabled={false}
                      />
                    ))}
                    {custom && (
                      <div className="onb-backend-card">
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
                            Select your own llama-server builds — as many as you
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
                          >
                            <Plus size={16} strokeWidth={2} />
                            Add Binary
                          </button>
                        </span>
                      </div>
                    )}
                    {allBackends.length > 0 && (
                      <div className="onb-backend-card onb-backend-other">
                        <button
                          type="button"
                          className="onb-backend-other-toggle"
                          onClick={() => setOthersOpen(true)}
                        >
                          <span className="onb-backend-card-icon">
                            <PackageOpen size={22} strokeWidth={2} />
                          </span>
                          <span className="onb-backend-card-body">
                            <span className="onb-backend-card-title-row">
                              <span className="onb-backend-card-title">
                                All Backends
                              </span>
                              <span className="onb-backend-other-count">
                                {allBackends.length}
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
            aria-label="All backend binaries"
          >
            <div className="onb-backend-overlay-header">
              <div className="onb-backend-overlay-heading">
                <h2 className="onb-backend-overlay-title">All Backends</h2>
                <p className="onb-backend-overlay-sub">
                  Every prebuilt binary for this platform
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
              {allBackends.map((download) => (
                <BackendCard
                  key={download.id}
                  download={download}
                  onDownload={handleDownload}
                  status={dlStatus[download.id]}
                  disabled={false}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
