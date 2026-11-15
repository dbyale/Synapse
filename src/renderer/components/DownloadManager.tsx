import React, { useEffect, useState, useRef } from 'react';
import { Download, RefreshCw, Play, X } from 'lucide-react';
import type { BinaryKind, DownloadProgress } from '../preload.d';
import { retryBinaryDownload } from '../onboarding/backgroundInstalls';
import { formatGB, formatSpeed, formatETA } from '../utils/formatters';
import InfoTooltip from './InfoTooltip';
import '../styles/DownloadManager.css';

interface ActiveDL {
  modelId: string;
  filename: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  lastTimestamp: number;
  lastBytes: number;
  status:
    | 'downloading'
    | 'merging'
    | 'extracting'
    | 'completed'
    | 'cancelled'
    | 'failed';
  merge?: boolean;
  /**
   * Set when the row is a backend/python install rather than a model, straight
   * from the progress event. Every action on such a row has to go to the binary
   * installer: `modelId` is a download id and `filename` is its label, so the
   * model downloader would be handed a repo and file name that never existed.
   */
  binary?: BinaryKind;
  /**
   * The install run this row belongs to, carried on every binary progress
   * event. A retry reuses the same id and label, so this is what distinguishes
   * "still the run the user dismissed" from "a new run they started elsewhere".
   */
  runId?: number;
}

export default function DownloadManager() {
  const [open, setOpen] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, ActiveDL>>({});
  const ref = useRef<HTMLDivElement>(null);
  // Rows the user dismissed while their work could not be cancelled (see the
  // progress listener), remembered by the run that was dismissed: a new run of
  // the same install has to be allowed to show itself again.
  const hiddenRuns = useRef<Map<string, number>>(new Map());

  // ── Handle click outside to close ──
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Open automatically & set initial state ──
  useEffect(() => {
    const handleOpen = (e: Event) => {
      setOpen(true);
      const customEvent = e as CustomEvent;
      const { modelId, filename } = customEvent.detail;
      if (filename) {
        const key = `${modelId || ''}:${filename}`;
        setDownloads((prev) => ({
          ...prev,
          [key]: {
            modelId: modelId || '',
            filename,
            percent: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
            lastTimestamp: Date.now(),
            lastBytes: 0,
            status: 'downloading',
          },
        }));
      }
    };
    window.addEventListener('open-download-manager', handleOpen);
    return () =>
      window.removeEventListener('open-download-manager', handleOpen);
  }, []);

  // ── Listen to IPC for download progress ──
  useEffect(() => {
    if (!window.electronAPI) return undefined;

    const unsubscribe = window.electronAPI.onDownloadProgress(
      (progress: DownloadProgress) => {
        const now = Date.now();
        const key = `${progress.modelId || ''}:${progress.filename}`;
        const isTerminal =
          progress.status === 'completed' ||
          progress.status === 'failed' ||
          progress.status === 'cancelled';
        // A dismissed row stays out of the list until the work behind it
        // settles: unpacking keeps broadcasting events every 250 ms, so without
        // this the ✕ on an unpacking row would only hide it for a moment. Only
        // the run that was dismissed is suppressed — a new run of the same
        // install (retried from the backend card) shows up again.
        if (isTerminal) hiddenRuns.current.delete(key);
        else if (
          progress.runId !== undefined &&
          hiddenRuns.current.get(key) === progress.runId
        )
          return;

        setDownloads((prev) => {
          const existing = prev[key];

          // If the backend explicitly broadcasts a cancel/fail event, apply it
          if (progress.status === 'cancelled' || progress.status === 'failed') {
            return {
              ...prev,
              [key]: {
                ...(existing || {
                  modelId: progress.modelId || '',
                  filename: progress.filename,
                  percent: 0,
                  downloadedBytes: 0,
                  totalBytes: 0,
                  speed: 0,
                  lastTimestamp: now,
                  lastBytes: 0,
                }),
                status: progress.status,
                merge: progress.merge ?? existing?.merge,
                binary: progress.binary ?? existing?.binary,
                runId: progress.runId ?? existing?.runId,
              },
            };
          }

          if (
            progress.status === 'merging' ||
            progress.status === 'extracting' ||
            progress.status === 'completed'
          ) {
            return {
              ...prev,
              [key]: {
                ...(existing || {
                  modelId: progress.modelId || '',
                  filename: progress.filename,
                  speed: 0,
                  lastTimestamp: now,
                  lastBytes: progress.downloadedBytes,
                }),
                percent: progress.percent,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
                status: progress.status,
                merge: progress.merge ?? existing?.merge,
                binary: progress.binary ?? existing?.binary,
                runId: progress.runId ?? existing?.runId,
              },
            };
          }

          // Ignore regular progress events if we've marked it as stopped —
          // unless they belong to a different run, which is a re-download of
          // the same row (retried from the backend card rather than from here).
          // Model rows carry no runId, so they fall back to the counters
          // starting over.
          if (
            existing &&
            (existing.status === 'cancelled' || existing.status === 'failed')
          ) {
            if (progress.runId !== undefined || existing.runId !== undefined) {
              if (progress.runId === existing.runId) return prev;
            } else if (progress.downloadedBytes >= existing.downloadedBytes) {
              return prev;
            }
          }

          let speed = existing ? existing.speed : 0;
          let lastTimestamp = existing ? existing.lastTimestamp : now;
          let lastBytes = existing
            ? existing.lastBytes
            : progress.downloadedBytes;

          if (existing) {
            const timeDiff = (now - existing.lastTimestamp) / 1000;

            if (timeDiff >= 0.5) {
              const bytesDiff = progress.downloadedBytes - existing.lastBytes;
              const instantSpeed = bytesDiff / timeDiff;
              const SMOOTHING_FACTOR = 0.1;

              if (speed === 0 || timeDiff > 5) {
                speed = instantSpeed;
              } else {
                speed =
                  instantSpeed * SMOOTHING_FACTOR +
                  speed * (1 - SMOOTHING_FACTOR);
              }

              lastTimestamp = now;
              lastBytes = progress.downloadedBytes;
            }
          }

          return {
            ...prev,
            [key]: {
              modelId: existing ? existing.modelId : progress.modelId || '',
              filename: progress.filename,
              percent: progress.percent,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              speed,
              lastTimestamp,
              lastBytes,
              status: 'downloading',
              binary: progress.binary ?? existing?.binary,
              runId: progress.runId ?? existing?.runId,
            },
          };
        });
      },
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // ── Handle Clear / Cancel ──
  const handleCancel = async (modelId: string, filename: string) => {
    const key = `${modelId || ''}:${filename}`;
    const dl = downloads[key];
    if (!dl) return;

    const isComplete =
      dl.percent >= 100 &&
      dl.status !== 'merging' &&
      dl.status !== 'extracting';

    if (dl.status === 'merging') {
      if (window.electronAPI.cancelMerge) {
        await window.electronAPI.cancelMerge(modelId, filename);
      }
      return;
    }

    if (dl.status === 'extracting') {
      // Unpacking cannot be interrupted without leaving a half-written build
      // behind, so this only drops the row. The install keeps running and the
      // backend card still tracks it; a new run of the same install (a retry
      // from the card) is a different runId and shows up again.
      if (dl.runId !== undefined) hiddenRuns.current.set(key, dl.runId);
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    // Clear it if it's already done or stopped
    if (isComplete || dl.status === 'cancelled' || dl.status === 'failed') {
      // Delete the part file for failed/cancelled downloads. Model part files
      // are named after the repo and split filename; a binary install writes
      // its own `.download-<folder>.part` temps and removes them as soon as the
      // transfer ends, so there is nothing here for it to clean up.
      if (
        (dl.status === 'failed' || dl.status === 'cancelled') &&
        !dl.binary &&
        window.electronAPI.deletePartFile
      ) {
        await window.electronAPI.deletePartFile(modelId, filename);
      }
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    // Call backend to abort HTTP request. (This will trigger the broadcast above)
    if (dl.binary && window.electronAPI.cancelBinaryDownload) {
      await window.electronAPI.cancelBinaryDownload(modelId);
      return;
    }
    if (window.electronAPI.cancelDownload) {
      await window.electronAPI.cancelDownload(modelId, filename);
    }
  };

  // ── Re-run a binary (backend / python) install ──
  //
  // Binary rows carry a download id and a human-readable label, not a repo and a
  // split filename, so the model download/resume calls cannot describe what to
  // fetch. The install snapshot still has the descriptor and the directory the
  // install was started into, and going through it also re-registers the
  // progress mapping — so the backend card picks the transfer back up too.
  // There is no partial transfer to continue from (the archive temps are removed
  // when a download stops), so this always re-downloads.
  const restartBinaryDownload = async (dl: ActiveDL): Promise<void> => {
    const key = `${dl.modelId || ''}:${dl.filename}`;
    // The row is redrawn from scratch: a binary install re-downloads, and the
    // progress events that follow carry the new totals.
    const markRunning = () => {
      hiddenRuns.current.delete(key);
      setDownloads((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          percent: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          speed: 0,
          lastTimestamp: Date.now(),
          lastBytes: 0,
          status: 'downloading',
        },
      }));
    };

    if (retryBinaryDownload(dl.modelId)) {
      markRunning();
      return;
    }

    // No snapshot for it (started from somewhere else this session): the main
    // process still recognises the id and routes it back to the installer.
    markRunning();
    if (window.electronAPI.downloadModel) {
      try {
        await window.electronAPI.downloadModel(dl.modelId, dl.filename);
      } catch {
        // Progress events report the outcome.
      }
    }
  };

  // ── Handle Resume ──
  const handleResume = async (modelId: string, filename: string) => {
    const key = `${modelId || ''}:${filename}`;
    const dl = downloads[key];
    if (dl?.binary) {
      await restartBinaryDownload(dl);
      return;
    }

    setDownloads((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        percent: 0,
        downloadedBytes: 0,
        speed: 0,
        lastTimestamp: Date.now(),
        lastBytes: 0,
        status: 'downloading',
      },
    }));

    if (window.electronAPI.resumeDownload) {
      try {
        await window.electronAPI.resumeDownload(modelId, filename);
      } catch {
        // IPC events will update the status; no extra handling needed
      }
    }
  };

  // ── Handle Retry ──
  const handleRetry = async (modelId: string, filename: string) => {
    const key = `${modelId || ''}:${filename}`;
    const dl = downloads[key];
    if (dl?.binary) {
      await restartBinaryDownload(dl);
      return;
    }

    const isMergeRetry = !!dl?.merge;
    setDownloads((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        lastTimestamp: Date.now(),
        lastBytes: 0,
        status: 'downloading',
      },
    }));

    try {
      if (isMergeRetry && window.electronAPI.mergeSplit) {
        await window.electronAPI.mergeSplit(modelId, filename);
      } else if (window.electronAPI.downloadModel) {
        await window.electronAPI.downloadModel(modelId, filename);
      }
    } catch {
      // IPC events will update the status; no extra handling needed
    }
  };

  const activeCount = Object.values(downloads).filter(
    (d) =>
      (d.percent < 100 ||
        d.status === 'merging' ||
        d.status === 'extracting') &&
      d.status !== 'cancelled' &&
      d.status !== 'failed',
  ).length;
  const dlList = Object.values(downloads);

  return (
    <div className="dl-manager" ref={ref}>
      <InfoTooltip
        content="Downloads"
        hideIcon
        portal={!open}
        className={`info-tooltip-wrapper--dl-manager${open ? ' info-tooltip-wrapper--open' : ''}`}
      >
        <button
          type="button"
          className={`dl-manager__btn ${open ? 'dl-manager__btn--active' : ''}`}
          onClick={() => setOpen(!open)}
        >
          <Download size={18} />
          {activeCount > 0 && (
            <span className="dl-manager__badge">{activeCount}</span>
          )}
        </button>
      </InfoTooltip>

      {open && (
        <div className="dl-manager__popup">
          <div className="dl-manager__header">Downloads</div>

          <div className="dl-manager__list">
            {dlList.length === 0 ? (
              <div className="dl-manager__empty">No active downloads</div>
            ) : (
              dlList.map((dl) => {
                const isMerging = dl.status === 'merging';
                const isExtracting = dl.status === 'extracting';
                const isComplete =
                  dl.percent >= 100 && !isMerging && !isExtracting;
                const isCancelled = dl.status === 'cancelled';
                const isFailed = dl.status === 'failed';
                const bytesRemaining = dl.totalBytes - dl.downloadedBytes;
                const etaSeconds =
                  dl.speed > 0 && !isComplete && !isCancelled && !isFailed
                    ? bytesRemaining / dl.speed
                    : 0;

                let progressColor = 'var(--accent)';
                if (isCancelled || isFailed) {
                  progressColor = 'var(--text-secondary, #9399b2)';
                } else if (isComplete) {
                  progressColor = 'var(--success, #a6e3a1)';
                }

                let statusText = '';
                if (isCancelled) {
                  statusText = 'Cancelled';
                } else if (isFailed) {
                  statusText = dl.merge ? 'Merge failed' : 'Failed';
                } else if (isMerging) {
                  statusText = 'Merging…';
                } else if (isExtracting) {
                  statusText = 'Unzipping…';
                } else if (isComplete) {
                  statusText = 'Completed';
                } else {
                  const etaText =
                    etaSeconds > 0 ? `- ETA ${formatETA(etaSeconds)}` : '';
                  statusText = `${formatSpeed(dl.speed)} ${etaText}`;
                }

                let cancelTitle = 'Cancel Download';
                if (isComplete || isCancelled || isFailed) {
                  cancelTitle = 'Clear';
                } else if (isExtracting) {
                  cancelTitle = 'Hide (unpacking cannot be cancelled)';
                }

                return (
                  <div
                    key={`${dl.modelId}:${dl.filename}`}
                    className="dl-manager__item"
                  >
                    <div className="dl-manager__item-header">
                      <div className="dl-manager__item-title">
                        <div
                          className="dl-manager__item-title-text"
                          title={`${dl.modelId}`}
                        >
                          {dl.modelId || dl.filename}
                        </div>
                        <div
                          className="dl-manager__item-filename"
                          title={dl.filename}
                        >
                          {dl.filename}
                        </div>
                      </div>
                      {(isFailed || isCancelled) && dl.modelId && (
                        <button
                          type="button"
                          className="dl-manager__retry-btn"
                          onClick={() => handleRetry(dl.modelId, dl.filename)}
                          title={dl.binary ? 'Re-download' : 'Retry Download'}
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      {isFailed && dl.modelId && !dl.binary && (
                        // Binary installs restart from scratch — there is no
                        // part-file to continue — so only Retry is offered.
                        <button
                          type="button"
                          className="dl-manager__resume-btn"
                          onClick={() => handleResume(dl.modelId, dl.filename)}
                          title="Resume Download"
                        >
                          <Play size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="dl-manager__cancel-btn"
                        onClick={() => handleCancel(dl.modelId, dl.filename)}
                        title={cancelTitle}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="dl-manager__progress-bar">
                      <div
                        className="dl-manager__progress-fill"
                        style={{
                          width: `${dl.percent}%`,
                          background: progressColor,
                        }}
                      />
                    </div>

                    <div className="dl-manager__item-meta">
                      <span>
                        {dl.percent}% - {formatGB(dl.downloadedBytes)} /{' '}
                        {dl.totalBytes > 0
                          ? formatGB(dl.totalBytes)
                          : 'Starting...'}
                      </span>
                      <span>{statusText}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
