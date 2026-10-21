import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Cpu,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import type { DownloadProgress, LocalModel } from '../preload.d';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatGB } from '../utils/formatters';
import {
  findInstalledDownload,
  getDownloadGroups,
  getDownloadKey,
  getUniqueDownloads,
  type DownloadGroup,
  type DownloadTarget,
} from './profileCatalog';

type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'installed'
  | 'failed'
  | 'cancelled';

interface RowState {
  status: DownloadStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

interface SectionTotals {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

const EMPTY_ROW_STATE: RowState = {
  status: 'queued',
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
};

const startedDownloads = new Set<string>();
const downloadSnapshots = new Map<string, RowState>();
const activeDownloadTasks = new Map<string, Promise<unknown>>();

const STATUS_LABELS: Record<DownloadStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  merging: 'Finishing up',
  completed: 'Ready',
  installed: 'Installed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function getFillClass(status: DownloadStatus): string {
  if (status === 'completed' || status === 'installed') {
    return 'onb-download-fill onb-download-fill--complete';
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'onb-download-fill onb-download-fill--failed';
  }
  return 'onb-download-fill';
}

function getGroupTargets(group: DownloadGroup): DownloadTarget[] {
  return group.projector ? [group.model, group.projector] : [group.model];
}

function getSectionStatus(
  targets: DownloadTarget[],
  rows: Record<string, RowState>,
): DownloadStatus {
  if (targets.length === 0) return 'queued';
  const statuses = targets.map(
    (target) => rows[getDownloadKey(target)]?.status ?? 'queued',
  );
  if (statuses.every((status) => status === 'installed')) return 'installed';
  if (
    statuses.every((status) => status === 'completed' || status === 'installed')
  ) {
    return 'completed';
  }
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.some((status) => status === 'merging')) return 'merging';
  if (statuses.some((status) => status === 'downloading')) return 'downloading';
  return 'queued';
}

function getSectionTotals(
  targets: DownloadTarget[],
  rows: Record<string, RowState>,
): SectionTotals {
  let downloadedBytes = 0;
  let totalBytes = 0;
  let percentSum = 0;

  targets.forEach((target) => {
    const row = rows[getDownloadKey(target)] ?? EMPTY_ROW_STATE;
    const isReady = row.status === 'completed' || row.status === 'installed';
    const targetTotal =
      row.totalBytes > 0 ? row.totalBytes : (target.sizeBytes ?? 0);
    totalBytes += targetTotal;
    downloadedBytes += isReady
      ? targetTotal
      : Math.min(row.downloadedBytes, targetTotal || row.downloadedBytes);
    percentSum += isReady ? 100 : Math.min(100, Math.max(0, row.percent));
  });

  let percent = 0;
  if (totalBytes > 0) {
    percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
  } else if (targets.length > 0) {
    percent = Math.round(percentSum / targets.length);
  }

  return {
    downloadedBytes,
    totalBytes,
    percent,
  };
}

function getSectionMeta(status: DownloadStatus, totals: SectionTotals): string {
  if (status === 'queued') return 'Waiting to start';
  if (status === 'installed') {
    return totals.totalBytes > 0
      ? `Installed - ${formatGB(totals.totalBytes)}`
      : 'Installed';
  }
  if (status === 'completed') return 'Ready to use';
  if (status === 'failed') return 'Download failed';
  if (status === 'cancelled') return 'Download cancelled';
  if (status === 'merging') return 'Finishing up the download';
  const total =
    totals.totalBytes > 0 ? formatGB(totals.totalBytes) : 'Calculating size';
  return `${formatGB(totals.downloadedBytes)} / ${total}`;
}

interface ModelDownloadPageProps {
  optionIds: string[];
  onBack: () => void;
  onContinue: () => void;
  onDiscardProfiles: (optionIds: string[]) => void;
}

export default function ModelDownloadPage({
  optionIds,
  onBack,
  onContinue,
  onDiscardProfiles,
}: ModelDownloadPageProps) {
  const downloads = useMemo(() => getUniqueDownloads(optionIds), [optionIds]);
  const sections = useMemo(() => getDownloadGroups(optionIds), [optionIds]);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [pendingDiscard, setPendingDiscard] = useState<DownloadGroup | null>(
    null,
  );
  const mountedRef = useRef(false);

  const updateRow = useCallback(
    (
      key: string,
      update: Partial<RowState> | ((previous: RowState) => RowState),
    ) => {
      const previous = downloadSnapshots.get(key) ?? EMPTY_ROW_STATE;
      const next =
        typeof update === 'function'
          ? update(previous)
          : { ...previous, ...update };
      downloadSnapshots.set(key, next);
      if (mountedRef.current) {
        setRows((current) => ({ ...current, [key]: next }));
      }
    },
    [],
  );

  const syncInstalled = useCallback(async () => {
    let localModels: LocalModel[];
    try {
      localModels = await window.electronAPI.listLocalModels();
    } catch {
      return;
    }
    downloads.forEach((target) => {
      const key = getDownloadKey(target);
      const installed = findInstalledDownload(target, localModels);
      if (!installed) return;
      startedDownloads.delete(key);
      updateRow(key, {
        status: 'installed',
        percent: 100,
        downloadedBytes: installed.sizeBytes,
        totalBytes: installed.sizeBytes,
      });
    });
  }, [downloads, updateRow]);

  const startDownload = useCallback(
    (target: DownloadTarget, resume = false) => {
      const key = getDownloadKey(target);
      if (startedDownloads.has(key)) return;
      startedDownloads.add(key);
      updateRow(key, (previous) =>
        previous.status === 'installed'
          ? previous
          : { ...previous, status: 'downloading' },
      );

      const request = resume
        ? window.electronAPI.resumeDownload(target.repoId, target.filename)
        : window.electronAPI.downloadModel(target.repoId, target.filename);
      const task = request
        .then((result) => {
          if (result === 'CANCELLED') {
            startedDownloads.delete(key);
            updateRow(key, (previous) =>
              previous.status === 'installed'
                ? previous
                : { ...previous, status: 'cancelled' },
            );
            return undefined;
          }
          updateRow(key, (previous) =>
            previous.status === 'installed'
              ? previous
              : {
                  ...previous,
                  status: 'completed',
                  percent: 100,
                  downloadedBytes:
                    previous.totalBytes > 0
                      ? previous.totalBytes
                      : previous.downloadedBytes,
                },
          );
          return syncInstalled();
        })
        .catch(() => {
          startedDownloads.delete(key);
          updateRow(key, (previous) =>
            previous.status === 'installed'
              ? previous
              : { ...previous, status: 'failed' },
          );
        });

      activeDownloadTasks.set(key, task);
      task
        .then(
          () => activeDownloadTasks.delete(key),
          () => activeDownloadTasks.delete(key),
        )
        .catch(() => undefined);
    },
    [syncInstalled, updateRow],
  );

  const handleProgress = useCallback(
    (progress: DownloadProgress) => {
      const key = `${progress.modelId}:${progress.filename}`;
      if (!downloads.some((target) => getDownloadKey(target) === key)) {
        return;
      }

      if (progress.status === 'failed' || progress.status === 'cancelled') {
        const failureStatus = progress.status;
        startedDownloads.delete(key);
        updateRow(key, (previous) =>
          previous.status === 'installed'
            ? previous
            : { ...previous, status: failureStatus },
        );
        return;
      }

      if (progress.status === 'completed') {
        updateRow(key, (previous) =>
          previous.status === 'installed'
            ? previous
            : {
                ...previous,
                status: 'completed',
                percent: 100,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
              },
        );
        syncInstalled().catch(() => undefined);
        return;
      }

      if (progress.status === 'merging') {
        updateRow(key, (previous) =>
          previous.status === 'installed'
            ? previous
            : {
                ...previous,
                status: 'merging',
                percent: 100,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
              },
        );
        return;
      }

      updateRow(key, (previous) => {
        if (
          previous.status === 'installed' ||
          previous.status === 'completed' ||
          previous.status === 'failed' ||
          previous.status === 'cancelled'
        ) {
          return previous;
        }
        return {
          ...previous,
          status: 'downloading',
          percent: progress.percent,
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
        };
      });
    },
    [downloads, syncInstalled, updateRow],
  );

  useEffect(() => {
    mountedRef.current = true;
    const initialRows: Record<string, RowState> = {};
    downloads.forEach((target) => {
      const key = getDownloadKey(target);
      initialRows[key] = downloadSnapshots.get(key) ?? EMPTY_ROW_STATE;
    });
    setRows(initialRows);

    const unsubscribe = window.electronAPI.onDownloadProgress(handleProgress);

    let active = true;
    const initializeDownloads = async () => {
      let localModels: LocalModel[];
      try {
        localModels = await window.electronAPI.listLocalModels();
      } catch {
        localModels = [];
      }
      if (!active) return;

      downloads.forEach((target) => {
        const key = getDownloadKey(target);
        const installed = findInstalledDownload(target, localModels);
        if (installed) {
          startedDownloads.delete(key);
          updateRow(key, {
            status: 'installed',
            percent: 100,
            downloadedBytes: installed.sizeBytes,
            totalBytes: installed.sizeBytes,
          });
          return;
        }

        const snapshot = downloadSnapshots.get(key);
        if (snapshot?.status === 'failed' || snapshot?.status === 'cancelled') {
          return;
        }
        if (
          snapshot?.status === 'installed' ||
          snapshot?.status === 'completed'
        ) {
          if (activeDownloadTasks.has(key)) return;
          startedDownloads.delete(key);
          if (snapshot.status === 'installed') {
            updateRow(key, {
              status: 'queued',
              percent: 0,
              downloadedBytes: 0,
              totalBytes: 0,
            });
          }
        }
        startDownload(target);
      });
    };

    initializeDownloads().catch(() => undefined);

    return () => {
      active = false;
      mountedRef.current = false;
      unsubscribe();
    };
  }, [downloads, handleProgress, startDownload, updateRow]);

  const handleRetry = useCallback(
    (section: DownloadGroup) => {
      getGroupTargets(section).forEach((target) => {
        const key = getDownloadKey(target);
        const status =
          downloadSnapshots.get(key)?.status ?? rows[key]?.status ?? 'queued';
        if (status !== 'failed' && status !== 'cancelled') return;
        startedDownloads.delete(key);
        updateRow(key, {
          status: 'queued',
          percent: 0,
          downloadedBytes: 0,
          totalBytes: 0,
        });
        startDownload(target);
      });
    },
    [rows, startDownload, updateRow],
  );

  const handleResume = useCallback(
    (section: DownloadGroup) => {
      getGroupTargets(section).forEach((target) => {
        const key = getDownloadKey(target);
        const status =
          downloadSnapshots.get(key)?.status ?? rows[key]?.status ?? 'queued';
        if (status !== 'failed') return;
        startedDownloads.delete(key);
        startDownload(target, true);
      });
    },
    [rows, startDownload],
  );

  const cancelGroupDownloads = useCallback(
    async (section: DownloadGroup) => {
      await Promise.all(
        getGroupTargets(section).map(async (target) => {
          const key = getDownloadKey(target);
          const status =
            downloadSnapshots.get(key)?.status ?? rows[key]?.status ?? 'queued';
          startedDownloads.delete(key);

          if (status === 'merging') {
            await window.electronAPI
              .cancelMerge(target.repoId, target.filename)
              .catch(() => undefined);
          } else if (status === 'downloading' || status === 'queued') {
            await window.electronAPI
              .cancelDownload(target.repoId, target.filename)
              .catch(() => undefined);
          }

          const task = activeDownloadTasks.get(key);
          if (task) {
            await task.catch(() => undefined);
          }

          const finalStatus = downloadSnapshots.get(key)?.status ?? status;
          downloadSnapshots.delete(key);

          if (finalStatus !== 'installed' && finalStatus !== 'completed') {
            await window.electronAPI
              .deletePartFile(target.repoId, target.filename)
              .catch(() => undefined);
          }
        }),
      );
    },
    [rows],
  );

  const handleConfirmDiscard = useCallback(() => {
    if (!pendingDiscard) return;
    const section = pendingDiscard;
    setPendingDiscard(null);
    onDiscardProfiles(section.options.map((option) => option.optionId));
    cancelGroupDownloads(section).catch(() => undefined);
  }, [cancelGroupDownloads, onDiscardProfiles, pendingDiscard]);

  const sectionStatuses = sections.map((section) =>
    getSectionStatus(getGroupTargets(section), rows),
  );
  const readyCount = sectionStatuses.filter(
    (status) => status === 'completed' || status === 'installed',
  ).length;
  const allReady = sections.length > 0 && readyCount === sections.length;
  const hasFailed = sectionStatuses.some(
    (status) => status === 'failed' || status === 'cancelled',
  );

  let footerNote = 'Downloads continue in the background.';
  if (downloads.length === 0) {
    footerNote = 'Go back and select at least one option.';
  } else if (allReady) {
    footerNote = 'All selected assistants are ready.';
  } else if (hasFailed) {
    footerNote =
      'Some downloads need attention. Retry them here or from the download manager.';
  } else {
    footerNote =
      'Downloads continue in the background while you keep setting up Synapse.';
  }

  return (
    <div className="onb-page onb-download-page">
      <button
        type="button"
        aria-label="Back to category selection"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-download">
        <header className="onb-download-header onb-rise">
          <h1 className="onb-download-title">Downloading your assistants</h1>
          <p className="onb-download-text">
            We are getting the resources for your selected categories ready.
            Watch progress here, or continue and let Synapse finish in the
            background.
          </p>
        </header>

        <div className="onb-download-notice onb-rise onb-delay-1">
          <CircleAlert size={16} strokeWidth={2} />
          <span>
            Depending on your connection, this can take a while. You can safely
            continue using Synapse while everything downloads.
          </span>
        </div>

        {downloads.length === 0 ? (
          <div className="onb-download-empty onb-rise onb-delay-3">
            <CircleAlert size={30} strokeWidth={1.75} />
            <span className="onb-download-empty-title">
              No categories selected
            </span>
            <span className="onb-download-empty-text">
              Go back and choose at least one option to download.
            </span>
          </div>
        ) : (
          <div className="onb-download-list onb-rise onb-delay-3">
            {sections.map((section) => {
              const targets = getGroupTargets(section);
              const status = getSectionStatus(targets, rows);
              const totals = getSectionTotals(targets, rows);
              const isReady = status === 'completed' || status === 'installed';
              const isRetryable = status === 'failed' || status === 'cancelled';
              const percent =
                isReady || status === 'merging' ? 100 : totals.percent;
              const categoryNames = section.categories
                .map((category) => category.categoryName)
                .join(' + ');

              return (
                <section key={section.id} className="onb-download-group">
                  <div className="onb-download-group-header">
                    <span className="onb-download-group-icon">
                      <Cpu size={20} strokeWidth={2} />
                    </span>
                    <div className="onb-download-group-heading">
                      <h2 className="onb-download-group-title">
                        {section.modelName}
                      </h2>
                      <span className="onb-download-group-option">
                        {categoryNames}
                      </span>
                    </div>
                    <div className="onb-download-group-actions">
                      <span
                        className={`onb-download-badge onb-download-badge--${status}`}
                      >
                        {STATUS_LABELS[status]}
                      </span>
                      {isRetryable && (
                        <button
                          type="button"
                          className="onb-download-icon-btn"
                          onClick={() => handleRetry(section)}
                          title="Retry Download"
                          aria-label="Retry Download"
                        >
                          <RefreshCw size={13} strokeWidth={2.25} />
                        </button>
                      )}
                      {status === 'failed' && (
                        <button
                          type="button"
                          className="onb-download-icon-btn onb-download-icon-btn--resume"
                          onClick={() => handleResume(section)}
                          title="Resume Download"
                          aria-label="Resume Download"
                        >
                          <Play size={13} strokeWidth={2.25} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="onb-download-icon-btn onb-download-icon-btn--cancel"
                        onClick={() => setPendingDiscard(section)}
                        title={
                          isReady || isRetryable
                            ? 'Discard Profiles'
                            : 'Cancel Download'
                        }
                        aria-label={
                          isReady || isRetryable
                            ? 'Discard Profiles'
                            : 'Cancel Download'
                        }
                      >
                        <X size={14} strokeWidth={2.25} />
                      </button>
                    </div>
                  </div>

                  <div className="onb-download-bar">
                    <div
                      className={getFillClass(status)}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="onb-download-meta">
                    <span>{getSectionMeta(status, totals)}</span>
                    <span>{percent}%</span>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="onb-download-footer onb-rise onb-delay-4">
          <button
            type="button"
            className="onb-continue"
            onClick={onContinue}
            disabled={downloads.length === 0}
          >
            Continue
            <ArrowRight size={20} strokeWidth={2} />
          </button>
          <p className="onb-download-footer-note">{footerNote}</p>
        </div>
      </div>

      {pendingDiscard &&
        createPortal(
          <ConfirmDialog
            title="Delete Profiles?"
            message={`The following Profiles will be discarded: ${pendingDiscard.options
              .map((option) => `${option.categoryName} - ${option.optionName}`)
              .join(', ')}. Are you sure you want to delete these Profiles?`}
            confirmText="Delete Profiles"
            cancelText="Cancel"
            danger
            onConfirm={handleConfirmDiscard}
            onCancel={() => setPendingDiscard(null)}
          />,
          document.body,
        )}
    </div>
  );
}
