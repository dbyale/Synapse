import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Cpu,
  FileCode,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import type {
  BackendInfo,
  BinaryKind,
  LocalModel,
  PythonInfo,
} from '../preload.d';
import type { Profile } from '../types/profile';
import { formatGB } from '../utils/formatters';
import {
  getBackgroundSetupError,
  getBinaryInstallSnapshot,
  retryBinaryInstall,
  subscribeBinaryInstalls,
  syncBinaryRecords,
  type BinaryInstallStatus,
  type BinaryRecords,
} from './backgroundInstalls';
import {
  getDownloadGroups,
  getDownloadKey,
  getUniqueDownloads,
  readOnboardingProfileSelection,
} from './profileCatalog';
import {
  getGroupTargets,
  getSectionMeta,
  getSectionStatus,
  getSectionTotals,
  retryDownloadTargets,
  STATUS_LABELS,
  useDownloadRows,
  type DownloadStatus,
} from './onboardingDownloads';
import { getCombinedProfiles } from './profileStorage';
import { isProfileReady } from './profileReadiness';

interface FinalInstallPageProps {
  optionIds: string[];
  profileType: 'simple' | 'advanced' | 'custom';
  onBack: () => void;
  onProceed: (profileId: string | null) => void;
}

interface DependencyRowProps {
  icon: 'backend' | 'python';
  title: string;
  label: string;
  status: DownloadStatus;
  percent: number;
  error: string | undefined;
  retrying: boolean;
  onRetry: () => void;
}

function getFailureLabel(error?: string): string {
  if (!error) return 'Failed to download';
  if (/ENOSPC|no space|not enough space|disk space|insufficient/i.test(error)) {
    return 'Failed to allocate space';
  }
  return 'Failed to download';
}

function getSnapshotStatus(
  status: BinaryInstallStatus | undefined,
  ready: boolean,
): DownloadStatus {
  if (ready) return 'completed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'downloading') return 'downloading';
  return 'queued';
}

function getModelFillClass(ready: boolean, retryable: boolean): string {
  if (ready) return 'onb-download-fill onb-download-fill--complete';
  if (retryable) return 'onb-download-fill onb-download-fill--failed';
  return 'onb-download-fill';
}

function DependencyRow({
  icon,
  title,
  label,
  status,
  percent,
  error,
  retrying,
  onRetry,
}: DependencyRowProps) {
  const Icon = icon === 'python' ? FileCode : Cpu;
  const failed = status === 'failed' || status === 'cancelled';
  return (
    <div className="onb-final-dependency">
      <span className="onb-final-dependency-icon">
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="onb-final-dependency-body">
        <div className="onb-final-row-heading">
          <span className="onb-final-row-title">{title}</span>
          <span className={`onb-download-badge onb-download-badge--${status}`}>
            {STATUS_LABELS[status]}
          </span>
          {failed && (
            <button
              type="button"
              className="onb-download-icon-btn"
              onClick={onRetry}
              disabled={retrying}
              aria-label={`Retry ${title}`}
              title={`Retry ${title}`}
            >
              <RefreshCw
                size={13}
                strokeWidth={2.25}
                className={retrying ? 'onb-backend-spinner' : undefined}
              />
            </button>
          )}
        </div>
        <div className="onb-final-row-meta">
          <span>{label}</span>
          {status === 'downloading' && <span>{percent}%</span>}
        </div>
        {status === 'downloading' && (
          <div className="onb-download-bar onb-final-bar">
            <div
              className="onb-download-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        {failed && error && (
          <div className="onb-final-error">
            <CircleAlert size={13} strokeWidth={2.2} />
            <span>
              {getFailureLabel(error)}
              <span className="onb-final-error-detail">{error}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileChoice({
  profile,
  selected,
  onSelect,
}: {
  profile: Profile;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`onb-final-profile${selected ? ' onb-final-profile--selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="onb-final-profile-check">
        {selected && <Check size={13} strokeWidth={2.6} />}
      </span>
      <span className="onb-final-profile-body">
        <span className="onb-final-profile-name">{profile.name}</span>
        <span className="onb-final-profile-meta">{profile.modelFilename}</span>
      </span>
    </button>
  );
}

export default function FinalInstallPage({
  optionIds,
  profileType,
  onBack,
  onProceed,
}: FinalInstallPageProps) {
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const [pythonInfo, setPythonInfo] = useState<PythonInfo | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [records, setRecords] = useState<BinaryRecords | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<BinaryKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [, setInstallRevision] = useState(0);

  const downloads = useMemo(() => getUniqueDownloads(optionIds), [optionIds]);
  const sections = useMemo(() => getDownloadGroups(optionIds), [optionIds]);
  const rows = useDownloadRows(downloads);
  const selectionKey = optionIds.join('|');
  const [onboardingProfiles, setOnboardingProfiles] = useState<Profile[]>(
    () => readOnboardingProfileSelection()?.profiles ?? [],
  );
  const candidateProfiles = useMemo(
    () => getCombinedProfiles(onboardingProfiles),
    [onboardingProfiles],
  );

  const refresh = useCallback(async () => {
    try {
      const info = await window.electronAPI.getBackendInfo();
      setBackendInfo(info);
    } catch {
      setBackendInfo(null);
    }
    try {
      const info = await window.electronAPI.getPythonInfo();
      setPythonInfo(info);
    } catch {
      setPythonInfo(null);
    }
    try {
      const models = await window.electronAPI.listLocalModels();
      setLocalModels(models);
    } catch {
      setLocalModels([]);
    }
    try {
      const binaryRecords = await syncBinaryRecords();
      setRecords(binaryRecords);
    } catch {
      setRecords(null);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    };
    initialize().catch(() => undefined);
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    setOnboardingProfiles(readOnboardingProfileSelection()?.profiles ?? []);
  }, [selectionKey]);

  useEffect(() => {
    const unsubscribe = subscribeBinaryInstalls(() =>
      setInstallRevision((value) => value + 1),
    );
    return unsubscribe;
  }, []);

  const backendReady = !!(
    records &&
    (records.backends.length > 0 || records.customBackendPaths.length > 0)
  );
  const pythonReady = !!(
    pythonInfo?.managed.available || pythonInfo?.system.available
  );
  const dependenciesReady = backendReady && pythonReady;
  const readyProfiles = useMemo(
    () =>
      candidateProfiles.filter((profile) =>
        isProfileReady(profile, localModels, dependenciesReady),
      ),
    [candidateProfiles, dependenciesReady, localModels],
  );
  const readyIds = useMemo(
    () => readyProfiles.map((profile) => profile.id),
    [readyProfiles],
  );

  useEffect(() => {
    setSelectedProfileId((previous) => {
      if (previous && readyIds.includes(previous)) return previous;
      const stored = localStorage.getItem('selectedProfileId');
      if (stored && readyIds.includes(stored)) return stored;
      return readyIds[0] ?? null;
    });
  }, [readyIds]);

  const recommendedBackend = backendInfo?.recommended[0];
  const backendSnapshot = recommendedBackend
    ? getBinaryInstallSnapshot('backend', recommendedBackend.id)
    : undefined;
  const backendSetupError = getBackgroundSetupError('backend');
  const backendStatus = getSnapshotStatus(
    backendSnapshot?.status,
    backendReady,
  );
  const backendError =
    backendSetupError ??
    backendSnapshot?.error ??
    (backendStatus === 'failed' ? 'Backend installation failed' : undefined);

  const recommendedPython = pythonInfo?.recommended;
  const pythonSnapshot = recommendedPython
    ? getBinaryInstallSnapshot('python', recommendedPython.id)
    : undefined;
  const pythonSetupError = getBackgroundSetupError('python');
  const pythonStatus = getSnapshotStatus(pythonSnapshot?.status, pythonReady);
  const pythonError =
    pythonSetupError ??
    pythonSnapshot?.error ??
    (pythonStatus === 'failed' ? 'Python installation failed' : undefined);
  let pythonLabel = recommendedPython?.label ?? 'Detecting Python';
  if (pythonInfo?.managed.available) {
    pythonLabel = 'Managed by Synapse';
  } else if (pythonInfo?.system.available) {
    pythonLabel = 'System Python';
  }

  const failedModelSections = sections.filter((section) => {
    const status = getSectionStatus(getGroupTargets(section), rows);
    return status === 'failed' || status === 'cancelled';
  });

  const warnings = [
    ...(backendInfo?.warnings ?? []),
    ...(pythonInfo?.warnings ?? []),
  ];

  const handleRetryDependency = async (kind: BinaryKind) => {
    setActionError(null);
    setRetrying(kind);
    try {
      await retryBinaryInstall(kind);
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Retry failed unexpectedly',
      );
    } finally {
      setRetrying(null);
    }
  };

  const handleProceed = () => {
    const selected =
      selectedProfileId && readyIds.includes(selectedProfileId)
        ? selectedProfileId
        : (readyIds[0] ?? null);
    onProceed(selected);
  };

  const requireReady = profileType !== 'custom';
  const canProceed = !requireReady || readyIds.length > 0;
  const proceedDisabled = loading || !canProceed;
  let footerNote = 'At least one profile must be ready before continuing.';
  if (loading) {
    footerNote = 'Checking install status…';
  } else if (canProceed) {
    footerNote =
      readyIds.length > 0
        ? `${readyIds.length} profile${readyIds.length === 1 ? '' : 's'} ready to use.`
        : 'You can continue and finish setup later.';
  }
  let profileEmptyText =
    'Profiles will appear here as their files finish installing.';
  if (loading) {
    profileEmptyText = 'Checking which profiles are ready…';
  } else if (failedModelSections.length > 0) {
    profileEmptyText = 'Downloads need attention before a profile can be used.';
  }

  return (
    <div className="onb-page onb-backend-page onb-final-page">
      <button
        type="button"
        aria-label="Back"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-backend onb-final-layout">
        <div className="onb-backend-info">
          <h1 className="onb-professions-title onb-rise onb-delay-1">
            Finishing your setup
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Synapse is installing the components your profiles need. Downloads
            keep running in the background, and completed profiles become
            available here automatically.
          </p>

          {warnings.map((warning) => (
            <div
              key={warning}
              className="onb-backend-warning-box onb-rise onb-delay-3"
            >
              <TriangleAlert size={16} strokeWidth={2.2} />
              <span>{warning}</span>
            </div>
          ))}

          {actionError && (
            <div className="onb-backend-warning-box onb-rise onb-delay-3">
              <CircleAlert size={16} strokeWidth={2.2} />
              <span>{actionError}</span>
            </div>
          )}
        </div>

        <div className="onb-backend-right onb-final-right">
          <section className="onb-backend-section onb-rise onb-delay-1">
            <p className="onb-professions-hint">Dependencies</p>
            <div className="onb-final-dependencies">
              <DependencyRow
                icon="backend"
                title="Inference backend"
                label={
                  recommendedBackend?.label ??
                  (backendReady ? 'Installed backend' : 'Detecting backend')
                }
                status={backendStatus}
                percent={backendSnapshot?.percent ?? 0}
                error={backendError}
                retrying={retrying === 'backend'}
                onRetry={() => handleRetryDependency('backend')}
              />
              <DependencyRow
                icon="python"
                title="Python runtime"
                label={pythonLabel}
                status={pythonStatus}
                percent={pythonSnapshot?.percent ?? 0}
                error={pythonError}
                retrying={retrying === 'python'}
                onRetry={() => handleRetryDependency('python')}
              />
            </div>
          </section>

          <section className="onb-backend-section onb-rise onb-delay-2">
            <p className="onb-professions-hint">Assistant downloads</p>
            {sections.length === 0 ? (
              <div className="onb-final-empty">
                No assistant downloads are required for this setup.
              </div>
            ) : (
              <div className="onb-final-models">
                {sections.map((section) => {
                  const targets = getGroupTargets(section);
                  const status = getSectionStatus(targets, rows);
                  const totals = getSectionTotals(targets, rows);
                  const ready =
                    status === 'completed' || status === 'installed';
                  const percent =
                    ready || status === 'merging' ? 100 : totals.percent;
                  const error = targets
                    .map((target) => rows[getDownloadKey(target)]?.error)
                    .find((message): message is string => !!message);
                  const retryable =
                    status === 'failed' || status === 'cancelled';
                  return (
                    <div key={section.id} className="onb-final-model">
                      <div className="onb-final-row-heading">
                        <span className="onb-final-row-title">
                          {section.modelName}
                        </span>
                        <span
                          className={`onb-download-badge onb-download-badge--${status}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                        {retryable && (
                          <button
                            type="button"
                            className="onb-download-icon-btn"
                            onClick={() =>
                              retryDownloadTargets(getGroupTargets(section))
                            }
                            aria-label={`Retry ${section.modelName}`}
                            title={`Retry ${section.modelName}`}
                          >
                            <RefreshCw size={13} strokeWidth={2.25} />
                          </button>
                        )}
                      </div>
                      <div className="onb-final-row-meta">
                        <span>{getSectionMeta(status, totals)}</span>
                        <span>
                          {totals.totalBytes > 0
                            ? formatGB(totals.totalBytes)
                            : ''}
                        </span>
                      </div>
                      <div className="onb-download-bar onb-final-bar">
                        <div
                          className={getModelFillClass(ready, retryable)}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      {error && (
                        <div className="onb-final-error">
                          <CircleAlert size={13} strokeWidth={2.2} />
                          <span>
                            {getFailureLabel(error)}
                            <span className="onb-final-error-detail">
                              {error}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="onb-backend-section onb-rise onb-delay-3">
            <p className="onb-professions-hint">Ready profiles</p>
            {readyProfiles.length === 0 ? (
              <div className="onb-final-empty">{profileEmptyText}</div>
            ) : (
              <div className="onb-final-profiles">
                {readyProfiles.map((profile) => (
                  <ProfileChoice
                    key={profile.id}
                    profile={profile}
                    selected={selectedProfileId === profile.id}
                    onSelect={() => setSelectedProfileId(profile.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="onb-professions-footer onb-rise onb-delay-4">
        {proceedDisabled && (
          <p className="onb-continue-reason" role="status" aria-live="polite">
            {footerNote}
          </p>
        )}
        <button
          type="button"
          className="onb-continue"
          onClick={handleProceed}
          disabled={proceedDisabled}
        >
          {loading ? (
            <Loader2
              size={18}
              strokeWidth={2}
              className="onb-backend-spinner"
            />
          ) : (
            <Check size={18} strokeWidth={2.3} />
          )}
          Proceed
          <ArrowRight size={20} strokeWidth={2} />
        </button>
        {!proceedDisabled && (
          <p className="onb-download-footer-note">{footerNote}</p>
        )}
      </div>
    </div>
  );
}
