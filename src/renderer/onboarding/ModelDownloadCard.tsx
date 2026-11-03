import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, Play, RefreshCw, X, Zap } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import type { DownloadGroup } from './profileCatalog';
import {
  cancelDownloadTargets,
  getGroupTargets,
  getGroupSubcategory,
  getSectionMeta,
  getSectionStatus,
  getSectionTotals,
  isGroupPrioritized,
  prioritizeDownloadTargets,
  unprioritizeDownloadTargets,
  retryDownloadTargets,
  STATUS_LABELS,
  type DownloadRowState,
  type DownloadStatus,
} from './onboardingDownloads';
import { getDownloadKey } from './profileCatalog';

/* ── status-to-bar-fill mapping ─────────────────────────────────── */

function getFillClass(status: DownloadStatus): string {
  if (status === 'completed' || status === 'installed')
    return 'onb-download-fill onb-download-fill--complete';
  if (status === 'failed' || status === 'cancelled')
    return 'onb-download-fill onb-download-fill--failed';
  if (status === 'paused') return 'onb-download-fill onb-download-fill--paused';
  return 'onb-download-fill';
}

/* ── card ───────────────────────────────────────────────────────── */

export interface ModelDownloadCardProps {
  section: DownloadGroup;
  rows: Record<string, DownloadRowState>;
  prioritized: boolean;
  onCancel: (section: DownloadGroup) => void;
  onRetry: (section: DownloadGroup) => void;
  onResume: (section: DownloadGroup) => void;
  onPrioritize: (section: DownloadGroup) => void;
  onUnprioritize: () => void;
}

export function ModelDownloadCard({
  section,
  rows,
  prioritized,
  onCancel,
  onRetry,
  onResume,
  onPrioritize,
  onUnprioritize,
}: ModelDownloadCardProps) {
  const targets = useMemo(() => getGroupTargets(section), [section]);
  const status = useMemo(
    () => getSectionStatus(targets, rows),
    [targets, rows],
  );
  const totals = useMemo(
    () => getSectionTotals(targets, rows),
    [targets, rows],
  );

  const isReady = status === 'completed' || status === 'installed';
  const isRetryable = status === 'failed' || status === 'cancelled';
  const isPaused = status === 'paused';
  const isDownloading = status === 'downloading' || status === 'merging';

  const percent = isReady || status === 'merging' ? 100 : totals.percent;

  const error = useMemo(() => {
    return targets
      .map((target) => rows[getDownloadKey(target)]?.error)
      .find((message): message is string => !!message);
  }, [targets, rows]);

  const subcategory = useMemo(() => getGroupSubcategory(section), [section]);

  // Badge text: override to "Prioritized" when the download is actively
  // prioritized by the user, otherwise use the standard status label.
  const badgeLabel =
    prioritized && isDownloading ? 'Prioritized' : STATUS_LABELS[status];
  const badgeClass =
    prioritized && isDownloading
      ? 'onb-download-badge--prioritized'
      : `onb-download-badge--${status}`;

  return (
    <section className="onb-download-group">
      <div className="onb-download-group-header">
        <span className="onb-download-group-icon">
          <Cpu size={20} strokeWidth={2} />
        </span>
        <div className="onb-download-group-heading">
          <h2 className="onb-download-group-title">{section.modelName}</h2>
          <span className="onb-download-group-option">{subcategory}</span>
        </div>
        <div className="onb-download-group-actions">
          <span className={`onb-download-badge ${badgeClass}`}>
            {badgeLabel}
          </span>

          {isRetryable && (
            <button
              type="button"
              className="onb-download-icon-btn"
              onClick={() => onRetry(section)}
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
              onClick={() => onResume(section)}
              title="Resume Download"
              aria-label="Resume Download"
            >
              <Play size={13} strokeWidth={2.25} />
            </button>
          )}

          {(isDownloading || isPaused) && (
            <button
              type="button"
              className={`onb-download-icon-btn${prioritized ? ' onb-download-icon-btn--priority-active' : ''}`}
              onClick={() =>
                prioritized ? onUnprioritize() : onPrioritize(section)
              }
              title={
                prioritized
                  ? 'Un-prioritize this download'
                  : 'Prioritize download'
              }
              aria-label={
                prioritized
                  ? 'Un-prioritize this download'
                  : 'Prioritize download'
              }
              aria-pressed={prioritized}
            >
              <Zap size={13} strokeWidth={2.25} />
            </button>
          )}

          <button
            type="button"
            className="onb-download-icon-btn onb-download-icon-btn--cancel"
            onClick={() => onCancel(section)}
            title={
              isReady || isRetryable ? 'Discard Profiles' : 'Cancel Download'
            }
            aria-label={
              isReady || isRetryable ? 'Discard Profiles' : 'Cancel Download'
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
      {error && <div className="onb-download-error">{error}</div>}
    </section>
  );
}

/* ── list ───────────────────────────────────────────────────────── */

export interface ModelDownloadListProps {
  sections: DownloadGroup[];
  rows: Record<string, DownloadRowState>;
  onDiscardProfiles: (optionIds: string[]) => void;
  className: string;
}

export function ModelDownloadList({
  sections,
  rows,
  onDiscardProfiles,
  className = 'onb-download-list',
}: ModelDownloadListProps) {
  const [pendingDiscard, setPendingDiscard] = useState<DownloadGroup | null>(
    null,
  );

  const handleRetry = useCallback(
    (section: DownloadGroup) => retryDownloadTargets(getGroupTargets(section)),
    [],
  );

  const handleResume = useCallback(
    (section: DownloadGroup) =>
      retryDownloadTargets(getGroupTargets(section), true),
    [],
  );

  const handleCancel = useCallback(
    (section: DownloadGroup) => setPendingDiscard(section),
    [],
  );

  const handlePrioritize = useCallback(
    (section: DownloadGroup) =>
      prioritizeDownloadTargets(getGroupTargets(section)),
    [],
  );

  const handleUnprioritize = useCallback(
    () => unprioritizeDownloadTargets(),
    [],
  );

  const handleConfirmDiscard = useCallback(() => {
    if (!pendingDiscard) return;
    const section = pendingDiscard;
    setPendingDiscard(null);
    onDiscardProfiles(section.options.map((o) => o.optionId));
    cancelDownloadTargets(getGroupTargets(section)).catch(() => undefined);
  }, [onDiscardProfiles, pendingDiscard]);

  return (
    <>
      <div className={className}>
        {sections.map((section) => (
          <ModelDownloadCard
            key={section.id}
            section={section}
            rows={rows}
            prioritized={isGroupPrioritized(section)}
            onCancel={handleCancel}
            onRetry={handleRetry}
            onResume={handleResume}
            onPrioritize={handlePrioritize}
            onUnprioritize={handleUnprioritize}
          />
        ))}
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
    </>
  );
}
