import React, { useEffect, useState, useRef } from 'react';
import { Download, X } from 'lucide-react';
import type { DownloadProgress } from '../preload.d';
import { formatGB, formatSpeed, formatETA } from '../utils/formatters';
import '../styles/DownloadManager.css';

interface ActiveDL {
  filename: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  lastTimestamp: number;
  lastBytes: number;
  status: 'downloading' | 'cancelled' | 'failed';
}

export default function DownloadManager() {
  const [open, setOpen] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, ActiveDL>>({});
  const ref = useRef<HTMLDivElement>(null);

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
      if (customEvent.detail?.filename) {
        setDownloads((prev) => ({
          ...prev,
          [customEvent.detail.filename]: {
            filename: customEvent.detail.filename,
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
      (progress: DownloadProgress & { status?: 'cancelled' | 'failed' }) => {
        const now = Date.now();

        setDownloads((prev) => {
          const existing = prev[progress.filename];

          // If the backend explicitly broadcasts a cancel/fail event, apply it
          if (progress.status === 'cancelled' || progress.status === 'failed') {
            return {
              ...prev,
              [progress.filename]: {
                ...(existing || {
                  filename: progress.filename,
                  percent: 0,
                  downloadedBytes: 0,
                  totalBytes: 0,
                  speed: 0,
                  lastTimestamp: now,
                  lastBytes: 0,
                }),
                status: progress.status,
              },
            };
          }

          // Ignore regular progress events if we've marked it as stopped
          if (existing?.status === 'cancelled' || existing?.status === 'failed')
            return prev;

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
            [progress.filename]: {
              filename: progress.filename,
              percent: progress.percent,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              speed,
              lastTimestamp,
              lastBytes,
              status: 'downloading',
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
  const handleCancel = async (filename: string) => {
    const dl = downloads[filename];
    if (!dl) return;

    const isComplete = dl.percent >= 100;

    // Clear it if it's already done or stopped
    if (isComplete || dl.status === 'cancelled' || dl.status === 'failed') {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      return;
    }

    // Call backend to abort HTTP request. (This will trigger the broadcast above)
    if (window.electronAPI.cancelDownload) {
      await window.electronAPI.cancelDownload(filename);
    }
  };

  const activeCount = Object.values(downloads).filter(
    (d) => d.percent < 100 && d.status !== 'cancelled' && d.status !== 'failed',
  ).length;
  const dlList = Object.values(downloads);

  return (
    <div className="dl-manager" ref={ref}>
      <button
        type="button"
        className={`dl-manager__btn ${open ? 'dl-manager__btn--active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Downloads"
      >
        <Download size={18} />
        {activeCount > 0 && (
          <span className="dl-manager__badge">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="dl-manager__popup">
          <div className="dl-manager__header">Downloads</div>

          <div className="dl-manager__list">
            {dlList.length === 0 ? (
              <div className="dl-manager__empty">No active downloads</div>
            ) : (
              dlList.map((dl) => {
                const isComplete = dl.percent >= 100;
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
                  statusText = 'Failed';
                } else if (isComplete) {
                  statusText = 'Completed';
                } else {
                  const etaText =
                    etaSeconds > 0 ? `- ETA ${formatETA(etaSeconds)}` : '';
                  statusText = `${formatSpeed(dl.speed)} ${etaText}`;
                }

                return (
                  <div key={dl.filename} className="dl-manager__item">
                    <div className="dl-manager__item-header">
                      <div
                        className="dl-manager__item-title"
                        title={dl.filename}
                      >
                        {dl.filename}
                      </div>
                      <button
                        type="button"
                        className="dl-manager__cancel-btn"
                        onClick={() => handleCancel(dl.filename)}
                        title={
                          isComplete || isCancelled || isFailed
                            ? 'Clear'
                            : 'Cancel Download'
                        }
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
