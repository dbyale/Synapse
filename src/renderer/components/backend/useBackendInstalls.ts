import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackendDownload,
  BackendInfo,
  InstalledBackend,
  InstalledBackends,
} from '../../preload.d';
import {
  getBinaryInstallSnapshot,
  removeBinaryInstall,
  startBinaryInstall,
  subscribeBinaryInstalls,
  syncBinaryRecords,
  type BinaryInstallSnapshot,
} from '../../onboarding/backgroundInstalls';
import type {
  BackendCardActions,
  BackendCardView,
  DownloadStatus,
} from './backendCard';
import { iconForFolder } from './backendCard';

// Shared state for both backend pickers (onboarding and Settings ▸ Backend).
//
// Two independent sources feed it: the download snapshots (progress for the
// transfer that is running now) and the backend inventory (what is actually on
// disk, reconciled in the main process). Neither one alone is enough — the
// snapshots are per-session and miss anything a previous version installed, and
// the inventory has no idea a download is halfway through.

export interface BackendCardState {
  status?: DownloadStatus;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

function syntheticDownload(backend: InstalledBackend): BackendDownload {
  // An install this build offers no download for: it still has to render as a
  // card, and it still has to be removable. No url means no install/update
  // affordance, which is the honest answer.
  return {
    id: backend.id,
    label: backend.label,
    sublabel: backend.folder,
    icon: iconForFolder(backend.folder),
    url: '',
    folder: backend.folder,
    files: [],
    recommended: false,
  };
}

export function useBackendInstalls(
  directory: string,
  options: {
    /** Hardware probe already done by the parent (onboarding prefetch). */
    preloaded?: BackendInfo | null;
    /** Parent is still probing — wait for the prop instead of a second IPC. */
    preloadedLoading?: boolean;
  } = {},
) {
  const { preloaded, preloadedLoading } = options;
  const [info, setInfo] = useState<BackendInfo | null>(preloaded ?? null);
  const [inventory, setInventory] = useState<InstalledBackends | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Installs read this at click time so a stale closure can never write a
  // backend into the wrong folder.
  const dirRef = useRef(directory);
  if (directory) dirRef.current = directory;

  const refresh = useCallback(async () => {
    try {
      setInventory(await window.electronAPI.getInstalledBackends());
    } catch {
      // Keep the previous inventory; the next change event repopulates it.
    }
  }, []);

  useEffect(() => {
    // Progress of an in-flight transfer, wherever it was started.
    const unsubscribeInstalls = subscribeBinaryInstalls(() =>
      setTick((t) => t + 1),
    );
    // A backend changed on disk (install/uninstall, including from another
    // window or the onboarding flow).
    const unsubscribeChanged = window.electronAPI.onBackendsChanged(() => {
      refresh().catch(() => undefined);
    });
    return () => {
      unsubscribeInstalls();
      unsubscribeChanged();
    };
  }, [refresh]);

  // One scan per backend directory, mount included. syncBinaryRecords seeds the
  // download snapshots from the reconciled records first, so an install from an
  // earlier session renders as installed immediately; re-running it when the
  // directory changes makes builds that were already sitting there appear.
  useEffect(() => {
    syncBinaryRecords()
      .then(() => refresh())
      .catch(() => undefined);
  }, [directory, refresh]);

  // The parent may already be probing hardware (onboarding prefetch). Adopt the
  // prop rather than issuing a second si.graphics / nvidia-smi / registry scan.
  useEffect(() => {
    if (preloaded) setInfo((prev) => prev ?? preloaded);
  }, [preloaded]);

  useEffect(() => {
    if (info || preloaded || preloadedLoading) return;
    window.electronAPI
      .getBackendInfo()
      .then((next) => setInfo((prev) => prev ?? next))
      .catch(() => undefined);
  }, [info, preloaded, preloadedLoading]);

  const installedFor = useCallback(
    (folder: string): InstalledBackend | undefined =>
      inventory?.backends.find((backend) => backend.folder === folder),
    [inventory],
  );

  const downloadFor = useCallback(
    (folder: string): BackendDownload | undefined => {
      if (!info) return undefined;
      return [...info.recommended, ...info.optional, ...info.others].find(
        (download) => download.folder === folder,
      );
    },
    [info],
  );

  const stateFor = useCallback((...ids: string[]): BackendCardState => {
    // Snapshots are keyed by the download id that started them; an install made
    // by an older Synapse may only be reachable by its marker id or folder.
    const snapshot = ids
      .map((id) => getBinaryInstallSnapshot('backend', id))
      .find((entry): entry is BinaryInstallSnapshot => !!entry);
    if (!snapshot) return {};
    return {
      status: snapshot.status === 'queued' ? 'downloading' : snapshot.status,
      percent: snapshot.percent,
      downloadedBytes: snapshot.downloadedBytes,
      totalBytes: snapshot.totalBytes,
      error: snapshot.error,
    };
  }, []);

  const install = useCallback(
    async (download: BackendDownload): Promise<boolean> => {
      setActionError(null);
      try {
        await startBinaryInstall('backend', download, dirRef.current);
        await refresh();
        return true;
      } catch {
        // startBinaryInstall already recorded the failure on the snapshot; the
        // card renders it. Refresh so the inventory matches whatever landed.
        await refresh();
        return false;
      }
    },
    [refresh],
  );

  const removeInstall = useCallback(
    async (
      target: BackendDownload | InstalledBackend,
    ): Promise<{ success: boolean; error?: string }> => {
      setActionError(null);
      const { folder } = target;
      let result: { success: boolean; error?: string };
      try {
        result = await window.electronAPI.uninstallBackendFolder(folder);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (!result.success) {
        setActionError(result.error ?? `Could not remove ${folder}`);
        return result;
      }
      // Without this the snapshot stays 'completed' and the next download
      // click is silently ignored by startBinaryInstall.
      [target.id, folder].forEach((id) => removeBinaryInstall('backend', id));
      await refresh();
      return result;
    },
    [refresh],
  );

  // An update never deletes first: the main process unpacks into a staging
  // folder and swaps it in only once the bundle verifies, so a failed download
  // leaves the working backend untouched and no older build's DLLs can be
  // loaded by mistake. The completed snapshot is cleared here because
  // startBinaryInstall treats a completed install as a no-op.
  const reinstall = useCallback(
    async (
      download: BackendDownload,
      installed?: InstalledBackend,
    ): Promise<boolean> => {
      const folder = installed?.folder ?? download.folder;
      [installed?.id, download.id, folder].forEach((id) => {
        if (id) removeBinaryInstall('backend', id);
      });
      return install(download);
    },
    [install],
  );

  const cardView = useCallback(
    (
      download: BackendDownload,
      installed?: InstalledBackend,
    ): BackendCardView => {
      const onDisk = installed ?? installedFor(download.folder);
      return {
        download,
        installed: onDisk,
        pinnedVersion:
          inventory?.pinnedLlamaVersion ?? info?.pinnedLlamaVersion,
        // Snapshots are keyed by download id, but an install recorded by an
        // older build may only be known by its marker id or folder.
        ...stateFor(download.id, onDisk?.id ?? '', download.folder),
      };
    },
    // tick: progress snapshots are read during render, so a view is only valid
    // for the moment it was built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, inventory, installedFor, downloadFor, stateFor, tick],
  );

  const installedViews = useMemo(
    () =>
      (inventory?.backends ?? []).map((backend) =>
        cardView(
          downloadFor(backend.folder) ?? syntheticDownload(backend),
          backend,
        ),
      ),
    [cardView, downloadFor, inventory],
  );

  const updatesAvailable = (inventory?.backends ?? []).filter(
    (backend) => backend.exists && backend.updateState === 'update-available',
  );

  // One actions object serves a whole list: the card hands back the backend it
  // was rendered with, so nothing is bound per card. Swap onUninstall for a
  // confirmation step when the surface wants one.
  const cardActions = useMemo<BackendCardActions>(
    () => ({
      onDownload: (download) => {
        install(download).catch(() => false);
      },
      onUninstall: (download, installed) => {
        removeInstall(installed ?? download).catch(() => undefined);
      },
      onReinstall: (download, installed) => {
        reinstall(download, installed).catch(() => false);
      },
    }),
    [install, removeInstall, reinstall],
  );

  return {
    info,
    directory: inventory?.directory ?? dirRef.current,
    pinnedVersion:
      inventory?.pinnedLlamaVersion ?? info?.pinnedLlamaVersion ?? '',
    installed: inventory?.backends ?? [],
    installedViews,
    updatesAvailable,
    actionError,
    clearActionError: () => setActionError(null),
    installedFor,
    downloadFor,
    stateFor,
    cardView,
    cardActions,
    install,
    uninstall: removeInstall,
    reinstall,
    refresh,
  };
}
