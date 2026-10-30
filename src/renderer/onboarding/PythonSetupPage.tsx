import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  markBinaryInstalled,
  refreshPythonPackagesStatus,
  removeBinaryInstall,
  startBinaryInstall,
  startPythonPackagesInstall,
} from './backgroundInstalls';
import { ReactComponent as PythonLogo } from '../../../assets/logos/python.svg';
import type {
  BackendDownload,
  DownloadProgress,
  PythonInfo,
  PythonPackageInfo,
  PythonPackagesSnapshot,
} from '../preload.d';

type DownloadStatus = 'downloading' | 'completed' | 'failed' | 'cancelled';
type RuntimeSelection = 'managed' | 'system';

function DownloadIcon({ status }: { status: DownloadStatus | undefined }) {
  if (status === 'completed') return <X size={18} strokeWidth={2} />;
  if (status === 'downloading') {
    return (
      <Loader2 size={18} strokeWidth={2} className="onb-backend-spinner" />
    );
  }
  return <Download size={18} strokeWidth={2} />;
}

function RuntimeCard({
  title,
  subtitle,
  selected,
  available,
  recommended = false,
  onSelect,
  action = undefined,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  available: boolean;
  recommended: boolean;
  onSelect: () => void;
  action: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={available ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!available}
      className={[
        'onb-backend-card',
        'onb-runtime-card',
        selected ? 'onb-backend-card--selected' : '',
        available ? '' : 'onb-runtime-card--unavailable',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        if (available) onSelect();
      }}
      onKeyDown={(event) => {
        if (!available) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="onb-runtime-radio" aria-hidden="true">
        {selected && <span className="onb-runtime-radio-dot" />}
      </span>
      <span className="onb-backend-card-icon">
        <PythonLogo className="onb-backend-logo" />
      </span>
      <span className="onb-backend-card-body">
        <span className="onb-backend-card-title-row">
          <span className="onb-backend-card-title">{title}</span>
          {recommended && (
            <span className="onb-backend-recommended">Recommended</span>
          )}
          {selected && (
            <span className="onb-runtime-selected-pill">Selected</span>
          )}
        </span>
        <span className="onb-backend-card-sublabel">{subtitle}</span>
      </span>
      {action && (
        <span
          className="onb-runtime-action"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          {action}
        </span>
      )}
    </div>
  );
}

function PackageStatusIcon({
  status,
}: {
  status: PythonPackageInfo['status'];
}) {
  if (status === 'installed') return <Check size={11} strokeWidth={3} />;
  if (status === 'installing') {
    return (
      <Loader2 size={11} strokeWidth={3} className="onb-backend-spinner" />
    );
  }
  if (status === 'failed') return <X size={11} strokeWidth={3} />;
  return <Circle size={9} strokeWidth={2.5} />;
}

function LibrariesPanel({
  packages,
  retrying,
  onRetry,
}: {
  packages: PythonPackagesSnapshot;
  retrying: boolean;
  onRetry: () => void;
}) {
  const failed = packages.packages.filter((pkg) => pkg.status === 'failed');
  const current =
    packages.packages.find((pkg) => pkg.id === packages.currentId) ??
    packages.packages.find((pkg) => pkg.status === 'installing');
  const percent =
    packages.total > 0
      ? Math.round((packages.completed / packages.total) * 100)
      : 0;
  const allInstalled =
    packages.total > 0 && packages.completed === packages.total;

  const groups = packages.packages.reduce<
    Record<string, { label: string; items: PythonPackageInfo[] }>
  >((acc, pkg) => {
    const existing = acc[pkg.group];
    if (existing) {
      existing.items.push(pkg);
    } else {
      acc[pkg.group] = { label: pkg.groupLabel, items: [pkg] };
    }
    return acc;
  }, {});

  let summary = `${packages.completed} of ${packages.total} installed`;
  if (allInstalled) summary = 'All tool libraries are ready';
  if (packages.installing) {
    summary = `Installing ${current?.label ?? 'libraries'} — ${packages.completed} of ${packages.total}`;
  }
  let fillClass = '';
  if (allInstalled) {
    fillClass = 'onb-download-fill--complete';
  } else if (failed.length > 0) {
    fillClass = 'onb-download-fill--failed';
  }

  return (
    <div className="onb-library-panel">
      <div className="onb-library-head">
        <span>{summary}</span>
        <span>{percent}%</span>
      </div>
      <div className="onb-download-bar onb-library-bar">
        <div
          className={`onb-download-fill ${fillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="onb-library-groups">
        {Object.entries(groups).map(([group, entry]) => (
          <div key={group} className="onb-library-group">
            <span className="onb-library-group-label">{entry.label}</span>
            <span className="onb-library-packages">
              {entry.items.map((pkg) => (
                <span
                  key={pkg.id}
                  className={`onb-library-package onb-library-package--${pkg.status}`}
                  title={pkg.error ?? pkg.pip}
                >
                  <PackageStatusIcon status={pkg.status} />
                  {pkg.label}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {failed.length > 0 && (
        <div className="onb-library-error">
          <TriangleAlert size={13} strokeWidth={2.2} />
          <span className="onb-library-error-text">
            {failed.length} librar{failed.length === 1 ? 'y' : 'ies'} failed to
            install.
            <span className="onb-library-error-detail">
              {failed[0]?.error ?? 'Check your connection and try again.'}
            </span>
          </span>
          <button
            type="button"
            className="onb-library-retry"
            onClick={onRetry}
            disabled={retrying || packages.installing}
          >
            <RefreshCw
              size={12}
              strokeWidth={2.5}
              className={retrying ? 'onb-backend-spinner' : undefined}
            />
            Retry
          </button>
        </div>
      )}
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
  const [selection, setSelection] = useState<RuntimeSelection>('managed');
  const [downloadDir, setDownloadDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [dlStatus, setDlStatus] = useState<Record<string, DownloadStatus>>({});
  const [packages, setPackages] = useState<PythonPackagesSnapshot | null>(null);
  const [retryingPackages, setRetryingPackages] = useState(false);
  const [pendingUninstall, setPendingUninstall] =
    useState<BackendDownload | null>(null);
  const autoStartedRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [python, settings, packageStatus] = await Promise.all([
          window.electronAPI.getPythonInfo(),
          window.electronAPI.loadSettings(),
          window.electronAPI.getPythonPackagesStatus(),
        ]);
        if (!mounted) return;
        setInfo(python);
        setSelection(python.selected);
        setDownloadDir(settings.pythonDirectory || python.defaultInstallDir);
        setPackages(packageStatus);
        setDlStatus(() => {
          const next: Record<string, DownloadStatus> = {};
          if (
            python.recommended &&
            (python.managed.available || settings.pythonInstall)
          ) {
            next[python.recommended.id] = 'completed';
            markBinaryInstalled(
              'python',
              python.recommended.id,
              python.recommended.label,
              python.recommended.folder,
            );
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

  useEffect(() => {
    const unsubscribe = window.electronAPI.onPythonPackagesProgress(
      (snapshot: PythonPackagesSnapshot) => setPackages(snapshot),
    );
    return unsubscribe;
  }, []);

  const recommended = info?.recommended ?? null;
  const managedReady =
    dlStatus[recommended?.id ?? ''] === 'completed' ||
    !!info?.managed.available;
  const systemReady = !!info?.system.available;
  const runtimeReady = selection === 'managed' ? managedReady : systemReady;
  const activeBinary =
    selection === 'managed' ? info?.managed.binary : info?.system.binary;

  // Kick off the shared library install as soon as the selected runtime can
  // run pip. Failures are retryable here and on the final setup page.
  useEffect(() => {
    if (!info || !runtimeReady || !activeBinary || !packages) return;
    if (packages.installing) return;
    if (packages.runtime !== selection) return;
    if (packages.total > 0 && packages.completed === packages.total) return;

    const key = `${selection}:${activeBinary}`;
    if (autoStartedRef.current === key) return;
    autoStartedRef.current = key;
    startPythonPackagesInstall().catch(() => undefined);
  }, [info, runtimeReady, activeBinary, packages, selection]);

  const persistRuntime = async (next: RuntimeSelection, dir = downloadDir) => {
    const settings = await window.electronAPI.loadSettings();
    await window.electronAPI.saveSettingsSilent({
      ...settings,
      pythonRuntime: next,
      ...(next === 'managed' ? { pythonDirectory: dir } : {}),
    });
  };

  const handleBrowse = async () => {
    try {
      const dir = await window.electronAPI.pickDirectory();
      if (dir) setDownloadDir(dir);
    } catch {
      // Silently fail
    }
  };

  const handleSelect = async (next: RuntimeSelection) => {
    if (next === selection) return;
    setSelection(next);
    autoStartedRef.current = null;
    setPackages(null);
    try {
      await persistRuntime(next);
      const status = await window.electronAPI.getPythonPackagesStatus();
      setPackages(status);
    } catch {
      // Main process will re-probe on the next status call
    }
  };

  const handleDownload = async (download: BackendDownload) => {
    if (!download.url) return;
    if (dlStatus[download.id] === 'completed') return;
    setDlStatus((prev) => ({ ...prev, [download.id]: 'downloading' }));
    setSelection('managed');
    try {
      await persistRuntime('managed');
      await startBinaryInstall('python', download, downloadDir);
      setDlStatus((prev) => ({ ...prev, [download.id]: 'completed' }));
      const refreshed = await window.electronAPI.getPythonInfo();
      setInfo(refreshed);
      const status = await window.electronAPI.getPythonPackagesStatus(true);
      setPackages(status);
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
      removeBinaryInstall('python', target.id);
      setDlStatus((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      autoStartedRef.current = null;
      const refreshed = await window.electronAPI.getPythonInfo();
      setInfo(refreshed);
      if (
        selection === 'managed' &&
        !refreshed.managed.available &&
        refreshed.system.available
      ) {
        await handleSelect('system');
      } else {
        const status = await window.electronAPI.getPythonPackagesStatus(true);
        setPackages(status);
      }
    }
  };

  const handleRetryPackages = async () => {
    if (retryingPackages || packages?.installing) return;
    setRetryingPackages(true);
    try {
      const failedIds = packages?.packages
        .filter((pkg) => pkg.status !== 'installed')
        .map((pkg) => pkg.id);
      await startPythonPackagesInstall(failedIds);
      const status = await refreshPythonPackagesStatus(true);
      if (status) setPackages(status);
    } catch {
      // The shared snapshot carries the error and retry state
    } finally {
      setRetryingPackages(false);
    }
  };

  const handleUninstallCancel = () => setPendingUninstall(null);

  const handleContinue = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await persistRuntime(selection);
      if (runtimeReady) {
        startPythonPackagesInstall().catch(() => undefined);
      }
    } catch {
      // Silently fail — selection is still applied in memory
    }
    onContinue();
  };

  const canContinue = !!info && runtimeReady;
  const continueReason = (() => {
    if (!info) return 'Detecting Python — please wait…';
    if (saving) return 'Saving configuration…';
    if (selection === 'managed' && !managedReady) {
      return 'Download the managed Python runtime or select System Python to continue.';
    }
    if (selection === 'system' && !systemReady) {
      return 'System Python was not found. Select the managed runtime to continue.';
    }
    return null;
  })();
  const isContinueDisabled = !canContinue || saving;
  const packagesInstalling = !!packages?.installing;

  let librariesContent: ReactNode;
  if (!runtimeReady) {
    librariesContent = (
      <p className="onb-backend-path-hint">
        Libraries install automatically once the selected runtime is ready.
      </p>
    );
  } else if (packages) {
    librariesContent = (
      <LibrariesPanel
        packages={packages}
        retrying={retryingPackages}
        onRetry={handleRetryPackages}
      />
    );
  } else {
    librariesContent = (
      <p className="onb-professions-hint">Checking libraries…</p>
    );
  }

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
            Python powers document conversion, web search, and code execution in
            Synapse. Synapse can install and manage a private copy for you — it
            is kept next to your other files and never touches your system
            Python.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            Downloads continue in the background after you continue.
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

          {selection === 'system' && systemReady && (
            <div className="onb-backend-warning-box onb-rise onb-delay-3">
              <TriangleAlert size={16} strokeWidth={2.2} />
              <span>
                Synapse cannot manage libraries for system Python. Some systems
                block pip installs (PEP 668); switch to the managed runtime if
                library installation fails.
              </span>
            </div>
          )}
        </div>

        <div className="onb-backend-right">
          {!info ? (
            <p className="onb-professions-hint onb-rise onb-delay-1">
              Detecting Python…
            </p>
          ) : (
            <>
              {selection === 'managed' && (
                <div className="onb-backend-section onb-rise onb-delay-1">
                  <p className="onb-professions-hint">Install location</p>
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
              )}

              <div className="onb-backend-section onb-rise onb-delay-2">
                <p className="onb-professions-hint">Python runtime</p>
                <div className="onb-backend-cards">
                  <RuntimeCard
                    title={
                      recommended?.label ??
                      (info.managed.available
                        ? 'Managed by Synapse'
                        : 'Managed by Synapse')
                    }
                    subtitle={
                      info.managed.available
                        ? `${info.managed.version ?? 'Installed'}${
                            info.managed.binary
                              ? ` — ${info.managed.binary}`
                              : ''
                          }`
                        : 'Not installed — download a private runtime managed by Synapse'
                    }
                    selected={selection === 'managed'}
                    available
                    recommended
                    onSelect={() => handleSelect('managed')}
                    action={
                      recommended ? (
                        <button
                          type="button"
                          className={`onb-backend-download ${
                            managedReady
                              ? 'onb-backend-download--uninstall'
                              : ''
                          }`}
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
                            dlStatus[recommended.id] === 'downloading' ||
                            saving ||
                            packagesInstalling
                          }
                        >
                          <DownloadIcon status={dlStatus[recommended.id]} />
                        </button>
                      ) : undefined
                    }
                  />

                  <RuntimeCard
                    title="System Python"
                    subtitle={
                      info.system.available
                        ? `${info.system.version ?? 'Detected'}${
                            info.system.binary ? ` — ${info.system.binary}` : ''
                          }`
                        : 'Not found on PATH — install Python or use the managed runtime'
                    }
                    selected={selection === 'system'}
                    available={info.system.available}
                    recommended={false}
                    onSelect={() => handleSelect('system')}
                    action={undefined}
                  />
                </div>
              </div>

              <div className="onb-backend-section onb-rise onb-delay-3">
                <div className="onb-library-heading">
                  <p className="onb-professions-hint">Tool libraries</p>
                  {packages && (
                    <span className="onb-library-size">
                      ~
                      {Math.max(
                        1,
                        Math.round(packages.totalApproxBytes / 1048576),
                      )}{' '}
                      MB
                    </span>
                  )}
                </div>
                {librariesContent}
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
        {!isContinueDisabled && packagesInstalling && (
          <p className="onb-backend-path-hint" role="status">
            Libraries continue installing in the background.
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
          message={`This will delete ${pendingUninstall.label} from ${
            downloadDir || 'the install folder'
          }. You can re-download it later, or fall back to a system Python.`}
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
