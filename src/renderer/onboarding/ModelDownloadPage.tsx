import { useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert } from 'lucide-react';
import { getDownloadGroups, getUniqueDownloads } from './profileCatalog';
import { useDownloadRows } from './onboardingDownloads';
import { ModelDownloadList } from './ModelDownloadCard';
import { startBackgroundInstalls } from './backgroundInstalls';

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

  useEffect(() => {
    if (!autoInstallBackend && !autoInstallPython) return;
    startBackgroundInstalls({
      backend: autoInstallBackend,
      python: autoInstallPython,
    }).catch(() => undefined);
  }, [autoInstallBackend, autoInstallPython]);

  const canContinue = downloads.length > 0 || allowEmpty;

  let footerNote = 'Downloads continue in the background.';
  if (downloads.length === 0) {
    footerNote = allowEmpty
      ? 'No assistants selected. You can continue without downloading models.'
      : 'Go back and select at least one option.';
  } else {
    const allReady =
      sections.length > 0 &&
      sections.every((section) => {
        const targets = section.projector
          ? [section.model, section.projector]
          : [section.model];
        return targets.every((target) => {
          const key = `${target.repoId}:${target.filename}`;
          const row = rows[key];
          return row?.status === 'completed' || row?.status === 'installed';
        });
      });
    const hasFailed = sections.some((section) => {
      const targets = section.projector
        ? [section.model, section.projector]
        : [section.model];
      return targets.some((target) => {
        const key = `${target.repoId}:${target.filename}`;
        const row = rows[key];
        return row?.status === 'failed' || row?.status === 'cancelled';
      });
    });
    if (allReady) {
      footerNote = 'All selected assistants are ready.';
    } else if (hasFailed) {
      footerNote =
        'Some downloads need attention. Retry them here or from the download manager.';
    } else {
      footerNote =
        'Downloads continue in the background while you keep setting up Synapse.';
    }
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
          <ModelDownloadList
            sections={sections}
            rows={rows}
            onDiscardProfiles={onDiscardProfiles}
            className="onb-download-list onb-rise onb-delay-3"
          />
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
    </div>
  );
}
