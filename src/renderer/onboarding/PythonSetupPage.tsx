import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FolderOpen,
  Loader2,
  TriangleAlert,
  X,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { ReactComponent as PythonLogo } from '../../../assets/logos/python.svg';
import type {
  BackendDownload,
  DownloadProgress,
  PythonInfo,
  PythonRuntime,
} from '../preload.d';

type DownloadStatus = 'downloading' | 'completed' | 'failed' | 'cancelled';

function DownloadIcon({ status }: { status: DownloadStatus | undefined }) {
  if (status === 'completed') return <X size={18} strokeWidth={2} />;
  if (status === 'downloading') {
    return (
      <Loader2 size={18} strokeWidth={2} className="onb-backend-spinner" />
    );
  }
  return <Download size={18} strokeWidth={2} />;
}

function RuntimeRow({
  title,
  runtime,
  fallback,
}: {
  title: string;
  runtime: PythonRuntime;
  fallback: string;
}) {
  return (
    <div className="onb-backend-card">
      <span className="onb-backend-card-icon">
        <PythonLogo className="onb-backend-logo" />
      </span>
      <span className="onb-backend-card-body">
        <span className="onb-backend-card-title-row">
          <span className="onb-backend-card-title">{title}</span>
          {runtime.available && (
            <span className="onb-backend-recommended">
              <Check size={12} strokeWidth={2.5} /> Ready
            </span>
          )}
        </span>
        <span className="onb-backend-card-sublabel">
          {runtime.available
            ? `${runtime.version ?? 'Detected'}${runtime.binary ? ` — ${runtime.binary}` : ''}`
            : fallback}
        </span>
      </span>
    </div>
  );
}

export default function PythonSetupPage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const [info, setInfo] = useState<PythonInfo | null>(null);
  const [downloadDir, setDownloadDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [dlStatus, setDlStatus] = useState<Record<string, DownloadStatus>>({});
  const [pendingUninstall, setPendingUninstall] =
    useState<BackendDownload | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [python, settings] = await Promise.all([
          window.electronAPI.getPythonInfo(),
          window.electronAPI.loadSettings(),
        ]);
        if (!mounted) return;
        setInfo(python);
        setDownloadDir(settings.pythonDirectory || python.defaultInstallDir);
        setDlStatus(() => {
          const next: Record<string, DownloadStatus> = {};
          if (
            python.recommended &&
            (python.managed.available || settings.pythonInstall)
          ) {
            next[python.recommended.id] = 'completed';
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

  const handleDownload = async (download: BackendDownload) => {
    if (!download.url) return;
    if (dlStatus[download.id] === 'completed') return;
    setDlStatus((prev) => ({ ...prev, [download.id]: 'downloading' }));
    window.dispatchEvent(
      new CustomEvent('open-download-manager', {
        detail: { modelId: download.id, filename: download.label },
      }),
    );
    try {
      await window.electronAPI.downloadBinary('python', download, downloadDir);
      setDlStatus((prev) => ({ ...prev, [download.id]: 'completed' }));
      const refreshed = await window.electronAPI.getPythonInfo();
      setInfo(refreshed);
    } catch {
      // Status events from the main process drive the final state
    }
  };

  const requestUninstall = (download: BackendDownload) => {
    if (dlStatus[download.id] !== 'completed') return;
    setPendingUninstall(download);
  };

  const handleUninstallConfirm = async () => {
    const target = pendingUninstall;
    if (!target) return;
    setPendingUninstall(null);
    const result = await window.electronAPI.uninstallBinary(
      'python',
      target,
      downloadDir,
    );
    if (result.success) {
      setDlStatus((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      const refreshed = await window.electronAPI.getPythonInfo();
      setInfo(refreshed);
    }
  };

  const handleUninstallCancel = () => setPendingUninstall(null);

  const handleContinue = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const settings = await window.electronAPI.loadSettings();
      await window.electronAPI.saveSettingsSilent({
        ...settings,
        pythonDirectory: downloadDir,
      });
    } catch {
      // Silently fail — installation location still applied in memory
    }
    onContinue();
  };

  const recommended = info?.recommended ?? null;
  const managedReady =
    dlStatus[recommended?.id ?? ''] === 'completed' ||
    !!info?.managed.available;
  const systemReady = !!info?.system.available;
  const canContinue = !!info && (managedReady || systemReady);
  const continueReason = (() => {
    if (!info) return 'Detecting Python — please wait…';
    if (saving) return 'Saving configuration…';
    if (!canContinue)
      return 'Download the recommended Python runtime or install Python to continue.';
    return null;
  })();
  const isContinueDisabled = !canContinue || saving;

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
          <span className="onb-rise">
            <PythonLogo className="onb-backend-logo" />
          </span>
          <h1 className="onb-professions-title onb-rise onb-delay-1">
            Python Setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Python powers document conversion and code execution in Synapse.
            Synapse can install and manage a private copy for you — it is kept
            next to your other files and never touches your system Python.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            The download continues in the background after you continue.
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
              Detecting Python…
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
                    placeholder="Choose where Python is installed"
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
                  Installed in a folder managed by Synapse by default.
                </p>
              </div>

              {recommended && (
                <div className="onb-backend-section onb-rise onb-delay-2">
                  <div className="onb-backend-cards">
                    <div
                      className={[
                        'onb-backend-card',
                        dlStatus[recommended.id] === 'downloading'
                          ? 'onb-backend-card--downloading'
                          : '',
                        managedReady ? 'onb-backend-card--completed' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="onb-backend-card-icon">
                        <PythonLogo className="onb-backend-logo" />
                      </span>
                      <span className="onb-backend-card-body">
                        <span className="onb-backend-card-title-row">
                          <span className="onb-backend-card-title">
                            {recommended.label}
                          </span>
                        </span>
                        {recommended.sublabel && (
                          <span className="onb-backend-card-sublabel">
                            {recommended.sublabel}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className={`onb-backend-download ${managedReady ? 'onb-backend-download--uninstall' : ''}`}
                        title={
                          managedReady
                            ? `Uninstall ${recommended.label}`
                            : `Download ${recommended.label}`
                        }
                        onClick={() =>
                          managedReady
                            ? requestUninstall(recommended)
                            : handleDownload(recommended)
                        }
                        disabled={
                          dlStatus[recommended.id] === 'downloading' || saving
                        }
                      >
                        <DownloadIcon status={dlStatus[recommended.id]} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="onb-backend-section onb-rise onb-delay-3">
                <p className="onb-professions-hint">System Python</p>
                <div className="onb-backend-cards">
                  <RuntimeRow
                    title="System Python"
                    runtime={info.system}
                    fallback="Not found — the download above is required for Python-based tools."
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="onb-professions-footer onb-rise onb-delay-4">
        {isContinueDisabled && continueReason && (
          <p
            id="python-continue-reason"
            className="onb-continue-reason"
            role="status"
            aria-live="polite"
          >
            {continueReason}
          </p>
        )}
        <button
          type="button"
          className="onb-continue"
          onClick={handleContinue}
          disabled={isContinueDisabled}
          aria-disabled={isContinueDisabled}
          aria-describedby={
            isContinueDisabled && continueReason
              ? 'python-continue-reason'
              : undefined
          }
        >
          Continue
          <ArrowRight size={20} strokeWidth={2} />
        </button>
      </div>

      {pendingUninstall && (
        <ConfirmDialog
          title={`Uninstall ${pendingUninstall.label}?`}
          message={`This will delete ${pendingUninstall.label} from ${downloadDir || 'the install folder'}. You can re-download it later, or fall back to a system Python.`}
          confirmText="Uninstall"
          cancelText="Cancel"
          danger
          onConfirm={handleUninstallConfirm}
          onCancel={handleUninstallCancel}
        />
      )}
    </div>
  );
}
