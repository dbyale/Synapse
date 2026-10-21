import { useCallback, useEffect, useMemo, useState } from 'react';
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
import ConfirmDialog from '../components/ConfirmDialog';
import {
  getDownloadGroups,
  getDownloadKey,
  getUniqueDownloads,
  type DownloadGroup,
} from './profileCatalog';
import {
  cancelDownloadTargets,
  getGroupTargets,
  getSectionMeta,
  getSectionStatus,
  getSectionTotals,
  retryDownloadTargets,
  STATUS_LABELS,
  useDownloadRows,
  type DownloadStatus,
} from './onboardingDownloads';
import { startBackgroundInstalls } from './backgroundInstalls';

function getFillClass(status: DownloadStatus): string {
  if (status === 'completed' || status === 'installed') {
    return 'onb-download-fill onb-download-fill--complete';
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'onb-download-fill onb-download-fill--failed';
  }
  return 'onb-download-fill';
}

interface ModelDownloadPageProps {
  optionIds: string[];
  autoInstallBackend: boolean;
  autoInstallPython: boolean;
  allowEmpty: boolean;
  onBack: () => void;
  onContinue: () => void;
  onDiscardProfiles: (optionIds: string[]) => void;
}

export default function ModelDownloadPage({
  optionIds,
  autoInstallBackend,
  autoInstallPython,
  allowEmpty,
  onBack,
  onContinue,
  onDiscardProfiles,
}: ModelDownloadPageProps) {
  const downloads = useMemo(() => getUniqueDownloads(optionIds), [optionIds]);
  const sections = useMemo(() => getDownloadGroups(optionIds), [optionIds]);
  const rows = useDownloadRows(downloads);

  const [pendingDiscard, setPendingDiscard] = useState<DownloadGroup | null>(
    null,
  );

  useEffect(() => {
    if (!autoInstallBackend && !autoInstallPython) return;
    startBackgroundInstalls({
      backend: autoInstallBackend,
      python: autoInstallPython,
    }).catch(() => undefined);
  }, [autoInstallBackend, autoInstallPython]);

  const handleRetry = useCallback((section: DownloadGroup) => {
    retryDownloadTargets(getGroupTargets(section));
  }, []);

  const handleResume = useCallback((section: DownloadGroup) => {
    retryDownloadTargets(getGroupTargets(section), true);
  }, []);

  const handleConfirmDiscard = useCallback(() => {
    if (!pendingDiscard) return;
    const section = pendingDiscard;
    setPendingDiscard(null);
    onDiscardProfiles(section.options.map((option) => option.optionId));
    cancelDownloadTargets(getGroupTargets(section)).catch(() => undefined);
  }, [onDiscardProfiles, pendingDiscard]);

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
  const canContinue = downloads.length > 0 || allowEmpty;

  let footerNote = 'Downloads continue in the background.';
  if (downloads.length === 0) {
    footerNote = allowEmpty
      ? 'No assistants selected. You can continue without downloading models.'
      : 'Go back and select at least one option.';
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
              No assistants selected
            </span>
            <span className="onb-download-empty-text">
              {allowEmpty
                ? 'You can continue without downloading an assistant, or go back to choose one.'
                : 'Go back and choose at least one option to download.'}
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
              const error = targets
                .map((target) => rows[getDownloadKey(target)]?.error)
                .find((message): message is string => !!message);

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
                  {error && <div className="onb-download-error">{error}</div>}
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
            disabled={!canContinue}
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
