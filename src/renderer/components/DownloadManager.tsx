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
  lastBytes: number; // Used to anchor the speed math correctly
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

        setDownloads((prev) => {
          const existing = prev[progress.filename];
          let speed = existing ? existing.speed : 0;
          let lastTimestamp = existing ? existing.lastTimestamp : now;
          let lastBytes = existing
            ? existing.lastBytes
            : progress.downloadedBytes;

          if (existing) {
            const timeDiff = (now - existing.lastTimestamp) / 1000; // in seconds

            if (timeDiff >= 0.5) {
              // Calculate instantaneous speed for this exact 0.5s window
              const bytesDiff = progress.downloadedBytes - existing.lastBytes;
              const instantSpeed = bytesDiff / timeDiff;

              // Exponential Moving Average (EMA) to smooth out the speed/ETA
              // 0.1 = Very smooth (slow to react to changes)
              // 0.3 = Balanced
              // 0.8 = Very jumpy (fast to react to changes)
              const SMOOTHING_FACTOR = 0.1;

              if (speed === 0 || timeDiff > 5) {
                speed = instantSpeed;
              } else {
                speed =
                  instantSpeed * SMOOTHING_FACTOR +
                  speed * (1 - SMOOTHING_FACTOR);
              }

              // Reset anchors for the next 0.5s window
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
            },
          };
        });
        // Downloads remain in list until manually cleared
      },
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // ── Handle Clear / Cancel ──
  const handleCancel = async (filename: string) => {
    // Immediately remove from UI
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });

    // Call backend to abort HTTP request if it's still running
    if (window.electronAPI.cancelDownload) {
      await window.electronAPI.cancelDownload(filename);
    }
  };

  const activeCount = Object.values(downloads).filter(
    (d) => d.percent < 100,
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
                const bytesRemaining = dl.totalBytes - dl.downloadedBytes;
                const etaSeconds =
                  dl.speed > 0 && !isComplete ? bytesRemaining / dl.speed : 0;

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
                        title={isComplete ? 'Clear' : 'Cancel Download'}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="dl-manager__progress-bar">
                      <div
                        className="dl-manager__progress-fill"
                        style={{
                          width: `${dl.percent}%`,
                          background: isComplete
                            ? 'var(--success, #a6e3a1)'
                            : 'var(--accent)',
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
                      <span>
                        {isComplete
                          ? 'Completed'
                          : `${formatSpeed(dl.speed)} ${etaSeconds > 0 ? `- ETA ${formatETA(etaSeconds)}` : ''}`}
                      </span>
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
