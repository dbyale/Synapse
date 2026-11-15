import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  HardDrive,
  List,
  PackageOpen,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import BackendCard, { groupBackends } from '../components/backend/backendCard';
import type { BackendCardActions } from '../components/backend/backendCard';
import { useBackendInstalls } from '../components/backend/useBackendInstalls';
import type {
  BackendDownload,
  BackendInfo,
  InstalledBackend,
} from '../preload.d';

// The card UI, the install/update/uninstall actions and the "what is installed"
// answer all live in components/backend, shared with Settings ▸ Backend. This
// page is the onboarding shell around them.

export default function BackendSetupPage({
  onBack,
  onContinue,
  preloaded,
  preloadedLoading,
}: {
  onBack: () => void;
  onContinue: () => void;
  preloaded: BackendInfo | null;
  preloadedLoading: boolean;
}) {
  const [downloadDir, setDownloadDir] = useState('');
  const [customBinaries, setCustomBinaries] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [pendingUninstall, setPendingUninstall] = useState<{
    download: BackendDownload;
    installed?: InstalledBackend;
  } | null>(null);

  const {
    info,
    installed,
    installedViews,
    downloadFor,
    cardView,
    cardActions,
    uninstall,
    updatesAvailable,
    actionError,
    clearActionError,
    stateFor,
  } = useBackendInstalls(downloadDir, { preloaded, preloadedLoading });

  // If preloaded arrives after mount (background fetch finishes), adopt it
  // without issuing a second IPC — the hook does this, the directory default
  // is the part that still belongs here.
  useEffect(() => {
    if (downloadDir || !preloaded) return;
    window.electronAPI
      .loadSettings()
      .then((settings) =>
        setDownloadDir(
          settings.backendDirectory || preloaded.defaultDownloadDir,
        ),
      )
      .catch(() => undefined);
  }, [preloaded, downloadDir]);

  useEffect(() => {
    let mounted = true;
    window.electronAPI
      .loadSettings()
      .then((settings) => {
        if (!mounted) return false;
        setCustomBinaries(settings.customBinaryPaths ?? []);
        setDownloadDir((prev) => prev || settings.backendDirectory || '');
        return true;
      })
      .catch(() => undefined);
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

  const requestUninstall = (
    download: BackendDownload,
    installedEntry?: InstalledBackend,
  ) => setPendingUninstall({ download, installed: installedEntry });

  const handleUninstallConfirm = async () => {
    const target = pendingUninstall;
    setPendingUninstall(null);
    if (!target) return;
    await uninstall(target.installed ?? target.download);
  };

  const optional = info?.optional ?? [];
  const custom = optional.find((d) => d.id === 'custom');
  const others = optional.filter((d) => d.id !== 'custom');
  const recommended = info?.recommended ?? [];
  const groups = groupBackends(info?.others ?? []);
  const allBackends = [
    ...groups.compatible,
    ...groups['gpu-missing'],
    ...groups['wrong-system'],
    ...groups.other,
  ];

  // An install this build has no download entry for (an older target name, or a
  // build that was copied in) would otherwise be invisible here, and so
  // impossible to remove during onboarding. Offered installs already show up
  // below with their installed state.
  const unmanagedInstalls = installedViews.filter(
    (view) => !downloadFor(view.download.folder),
  );

  // Installed is decided by the backend directory, so a backend left over from
  // an older Synapse version counts here even when this build never recorded a
  // download for it.
  const startedAny =
    installed.some((entry) => entry.exists && entry.hasServer) ||
    [...recommended, ...others].some(
      (download) => !!stateFor(download.id).status,
    );
  const canContinue = !!info && (startedAny || customBinaries.length > 0);
  const continueReason = (() => {
    if (!info) return 'Detecting system hardware — please wait…';
    if (saving) return 'Saving configuration…';
    if (!startedAny && customBinaries.length === 0)
      return 'Download at least one backend or add a custom binary to continue.';
    return null;
  })();
  const isContinueDisabled = !canContinue || saving;

  // Uninstall deletes files with no undo, so the card's button asks first.
  const actions: BackendCardActions = {
    ...cardActions,
    onUninstall: requestUninstall,
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
    setSaving(false);
    onContinue();
  };

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

          {updatesAvailable.length > 0 && (
            <div className="onb-backend-warning-box onb-rise onb-delay-3">
              <TriangleAlert size={16} strokeWidth={2.2} />
              <span>
                {updatesAvailable.length} installed backend
                {updatesAvailable.length > 1 ? 's are' : ' is'} older than the
                llama.cpp build this Synapse uses (
                {updatesAvailable[0].llamaVersion} → {info?.pinnedLlamaVersion})
                . Update it from the card.
              </span>
            </div>
          )}
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

              {unmanagedInstalls.length > 0 && (
                <div className="onb-backend-section onb-rise onb-delay-1">
                  <p className="onb-professions-hint">
                    Installed on this machine
                  </p>
                  <div className="onb-backend-cards">
                    {unmanagedInstalls.map((view) => (
                      <BackendCard
                        key={view.download.folder}
                        view={view}
                        actions={actions}
                      />
                    ))}
                  </div>
                  <p className="onb-backend-path-hint">
                    Builds this Synapse does not offer — an older target, or one
                    you copied in yourself. Reinstall or remove them here.
                  </p>
                </div>
              )}

              <div className="onb-backend-section onb-rise onb-delay-2">
                <p className="onb-professions-hint">Recommended</p>
                <div className="onb-backend-cards">
                  {recommended.map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
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
                        view={cardView(download)}
                        actions={actions}
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
                              Every prebuilt binary
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
        {actionError && (
          <p className="onb-backend-error" role="alert">
            <TriangleAlert size={14} strokeWidth={2.2} />
            {actionError}
            <button
              type="button"
              className="onb-backend-error-dismiss"
              aria-label="Dismiss"
              onClick={clearActionError}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </p>
        )}
        {isContinueDisabled && continueReason && (
          <p
            id="backend-continue-reason"
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
              ? 'backend-continue-reason'
              : undefined
          }
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
              {recommended.length > 0 && (
                <div className="onb-backend-overlay-group">
                  <p className="onb-professions-hint">Recommended</p>
                  {recommended.map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              )}
              {others.length > 0 && (
                <div className="onb-backend-overlay-group">
                  <p className="onb-professions-hint">Optional</p>
                  {others.map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              )}
              {groups.compatible.length > 0 && (
                <div className="onb-backend-overlay-group">
                  <p className="onb-professions-hint">Available</p>
                  {groups.compatible.map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              )}
              {groups['gpu-missing'].length > 0 && (
                <div className="onb-backend-overlay-group">
                  <p className="onb-professions-hint">
                    Compatible GPU Not Found
                  </p>
                  {groups['gpu-missing'].map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              )}
              {groups['wrong-system'].length > 0 && (
                <div className="onb-backend-overlay-group">
                  <p className="onb-professions-hint">
                    Compatible Architecture
                  </p>
                  {groups['wrong-system'].map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              )}
              {groups.other.length > 0 && (
                <div className="onb-backend-overlay-group">
                  <p className="onb-professions-hint">Other</p>
                  {groups.other.map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingUninstall && (
        <ConfirmDialog
          title={`Uninstall ${pendingUninstall.download.label}?`}
          message={`This will delete ${
            pendingUninstall.installed?.folder ??
            pendingUninstall.download.folder
          } from ${downloadDir || 'the install folder'} and remove it from your setup. You can re-download it later.`}
          confirmText="Uninstall"
          cancelText="Cancel"
          danger
          onConfirm={handleUninstallConfirm}
          onCancel={() => setPendingUninstall(null)}
        />
      )}
    </div>
  );
}
