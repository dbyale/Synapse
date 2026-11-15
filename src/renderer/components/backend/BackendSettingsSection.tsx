import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  PackageOpen,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import InfoTooltip from '../InfoTooltip';
import { DirectoryField } from '../settingsShared/DirectoryField';
import BackendCard, { groupBackends } from './backendCard';
import type { BackendCardActions } from './backendCard';
import { useBackendInstalls } from './useBackendInstalls';
import type { BackendDownload, InstalledBackend } from '../../preload.d';
import {
  BACKEND_DIR_TOOLTIP,
  BACKEND_INSTALLED_TOOLTIP,
  BACKEND_LIST_TOOLTIP,
  BACKEND_VERSION_TOOLTIP,
} from '../../utils/tooltipContent';

// Settings ▸ Backend. Same cards, badges and actions as the onboarding picker:
// both read the backend inventory from the main process, so the two surfaces
// cannot report different things about the same folder.

interface Props {
  backendDirectory: string;
  customBinaryPaths: string[];
  onPickDirectory: () => void;
  onChangeCustomBinaries: (paths: string[]) => void;
}

export default function BackendSettingsSection({
  backendDirectory,
  customBinaryPaths,
  onPickDirectory,
  onChangeCustomBinaries,
}: Props) {
  const [othersOpen, setOthersOpen] = useState(false);
  const [pendingUninstall, setPendingUninstall] = useState<{
    download: BackendDownload;
    installed?: InstalledBackend;
  } | null>(null);

  const {
    info,
    pinnedVersion,
    installedViews,
    updatesAvailable,
    actionError,
    clearActionError,
    cardView,
    cardActions,
    uninstall,
    refresh,
  } = useBackendInstalls(backendDirectory);

  // Deleting a backend is destructive and has no undo, so the card's uninstall
  // button goes through a confirmation first.
  const actions: BackendCardActions = {
    ...cardActions,
    onUninstall: (download, installed) =>
      setPendingUninstall({ download, installed }),
  };

  const handleUninstallConfirm = async () => {
    const target = pendingUninstall;
    setPendingUninstall(null);
    if (!target) return;
    await uninstall(target.installed ?? target.download);
  };

  const recommended = info?.recommended ?? [];
  const optional = info?.optional ?? [];
  const custom = optional.find((download) => download.id === 'custom');
  const others = optional.filter((download) => download.id !== 'custom');
  const groups = groupBackends(info?.others ?? []);
  const allBackends = [
    ...groups.compatible,
    ...groups['gpu-missing'],
    ...groups['wrong-system'],
    ...groups.other,
  ];

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
      const next = [...customBinaryPaths];
      paths.forEach((p) => {
        if (!next.includes(p)) next.push(p);
      });
      onChangeCustomBinaries(next);
    } catch {
      // Silently fail
    }
  };

  return (
    <>
      <div className="settings-card">
        <InfoTooltip
          content={BACKEND_INSTALLED_TOOLTIP}
          side="right"
          hideIcon
          title="Installed Backends"
          className="mem-title-tooltip"
        >
          <h2 className="settings-card-title">Installed Backends</h2>
        </InfoTooltip>

        <div className="settings-field">
          <div className="settings-backend-head">
            <InfoTooltip
              content={BACKEND_VERSION_TOOLTIP}
              side="bottom"
              className="backend-version-tooltip"
              title="llama.cpp version"
            >
              <span className="settings-label">llama.cpp version</span>
            </InfoTooltip>
            <button
              type="button"
              className="settings-action-btn settings-backend-recheck"
              onClick={() => refresh().catch(() => undefined)}
              title="Re-read the backend folder"
            >
              <RefreshCw size={15} />
              Recheck
            </button>
          </div>
          <p className="settings-alloc-hint">
            This build of Synapse installs and expects{' '}
            <strong>llama.cpp {pinnedVersion || 'unknown'}</strong>. A backend
            older than that is updated from its own card; Synapse never asks
            GitHub for newer releases.
          </p>

          {updatesAvailable.length > 0 && (
            <p className="settings-backend-warning">
              <TriangleAlert size={14} />
              {updatesAvailable.length} installed backend
              {updatesAvailable.length > 1 ? 's are' : ' is'} older than{' '}
              {pinnedVersion}: {updatesAvailable[0].llamaVersion} →{' '}
              {pinnedVersion}.
            </p>
          )}

          {actionError && (
            <p className="settings-backend-error" role="alert">
              {actionError}
              <button
                type="button"
                className="settings-backend-error-dismiss"
                aria-label="Dismiss"
                onClick={clearActionError}
              >
                <X size={13} />
              </button>
            </p>
          )}
        </div>

        <div className="settings-field">
          <DirectoryField
            label="Backend Directory"
            tooltip={BACKEND_DIR_TOOLTIP}
            value={backendDirectory}
            onPick={onPickDirectory}
          />
          <p className="settings-alloc-hint settings-backend-hint">
            Every folder here that holds a llama-server counts as installed —
            including backends an older Synapse version downloaded or you copied
            in yourself.
          </p>
        </div>

        <div className="settings-field">
          <span className="settings-label">
            {installedViews.length > 0
              ? `${installedViews.length} installed`
              : 'Nothing installed'}
          </span>
          {installedViews.length > 0 ? (
            <div className="onb-backend-cards">
              {installedViews.map((view) => (
                <BackendCard
                  key={view.download.folder}
                  view={view}
                  actions={actions}
                />
              ))}
            </div>
          ) : (
            <p className="settings-alloc-hint">
              No backend binaries in this folder. Download one below before
              loading a model.
            </p>
          )}
        </div>
      </div>

      <div className="settings-card">
        <InfoTooltip
          content={BACKEND_LIST_TOOLTIP}
          side="right"
          hideIcon
          title="Download Backends"
          className="mem-title-tooltip"
        >
          <h2 className="settings-card-title">Download Backends</h2>
        </InfoTooltip>

        {!info ? (
          <p className="settings-alloc-hint">Detecting hardware…</p>
        ) : (
          <>
            {recommended.length > 0 && (
              <div className="settings-field">
                <span className="settings-label">Recommended</span>
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
            )}

            {others.length > 0 && (
              <div className="settings-field">
                <span className="settings-label">Optional</span>
                <div className="onb-backend-cards">
                  {others.map((download) => (
                    <BackendCard
                      key={download.id}
                      view={cardView(download)}
                      actions={actions}
                    />
                  ))}
                </div>
              </div>
            )}

            {allBackends.length > 0 && (
              <div className="settings-field">
                <button
                  type="button"
                  className="settings-backend-expand"
                  onClick={() => setOthersOpen((open) => !open)}
                  aria-expanded={othersOpen}
                >
                  {othersOpen ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  <PackageOpen size={16} />
                  All backends
                  <span className="settings-backend-expand-count">
                    {allBackends.length}
                  </span>
                </button>
                {othersOpen && (
                  <div className="settings-backend-groups">
                    {groups.compatible.length > 0 && (
                      <div className="settings-backend-group">
                        <p className="settings-label">Available</p>
                        <div className="onb-backend-cards">
                          {groups.compatible.map((download) => (
                            <BackendCard
                              key={download.id}
                              view={cardView(download)}
                              actions={actions}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {groups['gpu-missing'].length > 0 && (
                      <div className="settings-backend-group">
                        <p className="settings-label">
                          Compatible GPU not found
                        </p>
                        <div className="onb-backend-cards">
                          {groups['gpu-missing'].map((download) => (
                            <BackendCard
                              key={download.id}
                              view={cardView(download)}
                              actions={actions}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {groups['wrong-system'].length > 0 && (
                      <div className="settings-backend-group">
                        <p className="settings-label">
                          Compatible architecture
                        </p>
                        <div className="onb-backend-cards">
                          {groups['wrong-system'].map((download) => (
                            <BackendCard
                              key={download.id}
                              view={cardView(download)}
                              actions={actions}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {groups.other.length > 0 && (
                      <div className="settings-backend-group">
                        <p className="settings-label">Other</p>
                        <div className="onb-backend-cards">
                          {groups.other.map((download) => (
                            <BackendCard
                              key={download.id}
                              view={cardView(download)}
                              actions={actions}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {custom && (
        <div className="settings-card">
          <InfoTooltip
            content="Point Synapse at llama-server builds you installed yourself. They appear in the backend menu next to the managed ones."
            side="right"
            hideIcon
            title="Custom Binaries"
            className="mem-title-tooltip"
          >
            <h2 className="settings-card-title">Custom Binaries</h2>
          </InfoTooltip>

          <div className="settings-field">
            {customBinaryPaths.length > 0 ? (
              <div className="onb-custom-list">
                {customBinaryPaths.map((binary) => (
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
                      onClick={() =>
                        onChangeCustomBinaries(
                          customBinaryPaths.filter((p) => p !== binary),
                        )
                      }
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-alloc-hint">
                No custom binaries — Synapse uses only the backends above.
              </p>
            )}
            <button
              type="button"
              className="settings-action-btn settings-backend-add"
              onClick={handleAddBinaries}
            >
              <Plus size={15} />
              Add Binary
            </button>
          </div>
        </div>
      )}

      {pendingUninstall && (
        <ConfirmDialog
          title={`Uninstall ${pendingUninstall.download.label}?`}
          message={`This deletes ${
            pendingUninstall.installed?.folder ??
            pendingUninstall.download.folder
          } from ${
            backendDirectory || 'the backend directory'
          }. A profile using it falls back to another backend until you pick one.`}
          confirmText="Uninstall"
          cancelText="Cancel"
          danger
          onConfirm={handleUninstallConfirm}
          onCancel={() => setPendingUninstall(null)}
        />
      )}
    </>
  );
}
