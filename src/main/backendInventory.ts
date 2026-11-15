/* eslint-disable import/prefer-default-export */
import fs from 'fs';
import path from 'path';
import { loadSettings, saveSettings } from './settings';
import {
  getBackendDir,
  getFitParamsBinName,
  getServerBinName,
  getSplitBinName,
} from './backendPaths';
import {
  classifyInstalled,
  getLlamaVersion,
  readBackendMarker,
} from './backendVersions';
import { getTargetLabel } from './backendInfo';
import type {
  BackendDownloadRecord,
  InstalledBackend,
  InstalledBackends,
} from '../renderer/preload.d';

// What is actually installed is decided by the filesystem, not by
// settings.backendDownloads. The settings list is a cache of installs this app
// recorded; folders can outlive it (settings reset, an older Synapse version,
// a hand-copied build, a partial download). Anything on disk that is not in the
// cache is still a backend the user can — and should be able to — uninstall,
// and anything in the cache whose folder is gone is dead weight that has to
// stop steering backend resolution.
//
// So every read of the installed set reconciles the two, in both directions.

const IGNORED_FOLDER_PREFIXES = ['.', '~$'];

function isCandidateFolder(name: string): boolean {
  return !IGNORED_FOLDER_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// Fallback label for a folder Synapse has never offered (an older target name,
// or a build the user dropped in themselves).
function prettifyFolder(folder: string): string {
  return folder
    .split('-')
    .map((part) => (/^\d/.test(part) ? part : part.toUpperCase()))
    .join(' ');
}

function labelForFolder(folder: string): string {
  return getTargetLabel(folder) ?? prettifyFolder(folder);
}

function readFolder(
  root: string,
  folder: string,
  selectedBackend: string,
  recorded: boolean,
): Omit<InstalledBackend, 'tracked'> | null {
  const dir = path.join(root, folder);
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(dir).isDirectory();
  } catch {
    isDirectory = false;
  }
  const marker = isDirectory ? readBackendMarker(dir) : null;
  const hasServer = isDirectory
    ? fs.existsSync(path.join(dir, getServerBinName()))
    : false;
  // A folder that is neither a backend bundle nor something we recorded is just
  // a folder the user keeps next to their backends. A recorded folder without a
  // server is a partial install, and the user has to be able to clear it.
  if (!hasServer && !marker && !recorded) return null;

  const id = marker?.id || folder;
  return {
    folder,
    id,
    label: marker?.label || labelForFolder(folder),
    llamaVersion: marker?.llamaVersion ?? null,
    installedAt: marker?.installedAt || undefined,
    updateState: classifyInstalled(marker?.llamaVersion ?? null),
    hasServer,
    hasFitParams: isDirectory
      ? fs.existsSync(path.join(dir, getFitParamsBinName()))
      : false,
    hasSplit: isDirectory
      ? fs.existsSync(path.join(dir, getSplitBinName()))
      : false,
    synapseInstalled: !!marker,
    exists: isDirectory,
    selected: selectedBackend === folder || selectedBackend === id,
  };
}

function scanBackends(
  settings: ReturnType<typeof loadSettings>,
): InstalledBackend[] {
  const root = getBackendDir(settings);
  const selectedBackend = settings.selectedBackend ?? '';
  const onDisk: string[] = (() => {
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter(isCandidateFolder);
    } catch {
      return [];
    }
  })();

  // Recorded installs whose folder is missing still need to show up: that is
  // the only way the stale record can be removed from the UI.
  const recorded = (settings.backendDownloads ?? []).map((d) => d.folder);
  const folders = Array.from(new Set([...onDisk, ...recorded])).filter(Boolean);

  const backends = folders
    .map((folder) => {
      const read = readFolder(
        root,
        folder,
        selectedBackend,
        recorded.includes(folder),
      );
      if (!read) return null;
      const record = (settings.backendDownloads ?? []).find(
        (d) => d.folder === folder,
      );
      const llamaVersion = read.llamaVersion ?? record?.version ?? null;
      return {
        ...read,
        llamaVersion,
        updateState: classifyInstalled(llamaVersion),
        tracked: !!record,
      };
    })
    .filter((entry): entry is InstalledBackend => !!entry)
    .sort((a, b) => a.label.localeCompare(b.label));

  return backends;
}

// Read-only view of what is installed. Every read path uses this one: reading
// must never rewrite settings, because a renderer can be saving its own copy of
// the settings bag at the same moment and the last writer wins.
export function listInstalledBackends(): InstalledBackends {
  const settings = loadSettings();
  return {
    directory: getBackendDir(settings),
    pinnedLlamaVersion: getLlamaVersion(),
    backends: scanBackends(settings),
  };
}

// Read + persist: heals records for folders that are on disk, drops records
// whose folder is gone, and lets each folder's marker correct a stale record.
// Only called where something may just have changed on disk — an install, an
// uninstall, or the user asking for a recheck.
export function getInstalledBackends(): InstalledBackends {
  const settings = loadSettings();
  const backends = scanBackends(settings);

  const existing = settings.backendDownloads ?? [];
  const healed = backends.filter((b) => !b.tracked && b.exists && b.hasServer);
  // Only a record whose folder is gone is dead. A folder that is still there
  // but incomplete (interrupted download) stays recorded so it remains
  // visible and removable.
  const dropped = existing.filter(
    (record) => !backends.some((b) => b.folder === record.folder && b.exists),
  );
  // The folder's marker is the ground truth about what was downloaded, so the
  // cached record follows it rather than the other way round.
  const staleVersions = backends.filter((b) => {
    const record = existing.find((d) => d.folder === b.folder);
    return !!record && !!b.llamaVersion && record.version !== b.llamaVersion;
  });

  if (healed.length > 0 || dropped.length > 0 || staleVersions.length > 0) {
    const droppedFolders = new Set(dropped.map((d) => d.folder));
    const byFolder = new Map<string, BackendDownloadRecord>(
      existing
        .filter((record) => !droppedFolders.has(record.folder))
        .map((record) => [record.folder, record] as const),
    );

    backends.forEach((backend) => {
      const record = byFolder.get(backend.folder);
      if (record) {
        if (backend.llamaVersion) record.version = backend.llamaVersion;
        if (backend.installedAt) record.installedAt = backend.installedAt;
        return;
      }
      if (!backend.exists || !backend.hasServer) return;
      byFolder.set(backend.folder, {
        id: backend.id,
        label: backend.label,
        folder: backend.folder,
        version: backend.llamaVersion ?? undefined,
        installedAt: backend.installedAt,
      });
    });

    settings.backendDownloads = Array.from(byFolder.values());

    // A selection pointing at a folder that no longer exists makes
    // resolveBackend/resolveFitBinary fall through on every launch.
    const selected = settings.selectedBackend;
    if (
      selected &&
      selected !== 'Default' &&
      dropped.some((d) => d.folder === selected || d.id === selected) &&
      !(settings.customBinaryPaths ?? []).includes(selected)
    ) {
      settings.selectedBackend = 'Default';
    }

    saveSettings(settings, true);
  }

  return {
    directory: getBackendDir(settings),
    pinnedLlamaVersion: getLlamaVersion(),
    backends,
  };
}
