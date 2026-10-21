import { useEffect, useState } from 'react';
import type { LocalModel } from '../preload.d';
import { formatGB } from '../utils/formatters';
import {
  findInstalledDownload,
  getDownloadKey,
  type DownloadGroup,
  type DownloadTarget,
} from './profileCatalog';

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'installed'
  | 'failed'
  | 'cancelled';

export interface DownloadRowState {
  status: DownloadStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface SectionTotals {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export const EMPTY_ROW_STATE: DownloadRowState = {
  status: 'queued',
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
};

export const STATUS_LABELS: Record<DownloadStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  merging: 'Finishing up',
  completed: 'Ready',
  installed: 'Installed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const registeredTargets = new Map<string, DownloadTarget>();
const startedDownloads = new Set<string>();
const downloadSnapshots = new Map<string, DownloadRowState>();
const activeDownloadTasks = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

let unsubscribeProgress: (() => void) | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function updateSnapshot(key: string, next: Partial<DownloadRowState>) {
  const previous = downloadSnapshots.get(key) ?? EMPTY_ROW_STATE;
  downloadSnapshots.set(key, { ...previous, ...next });
}

function applyLocalModels(localModels: readonly LocalModel[]): boolean {
  let changed = false;
  registeredTargets.forEach((target) => {
    const key = getDownloadKey(target);
    const installed = findInstalledDownload(target, localModels);
    if (!installed) return;
    startedDownloads.delete(key);
    updateSnapshot(key, {
      status: 'installed',
      percent: 100,
      downloadedBytes: installed.sizeBytes,
      totalBytes: installed.sizeBytes,
      error: undefined,
    });
    changed = true;
  });
  return changed;
}

export async function syncInstalledDownloads(): Promise<void> {
  if (registeredTargets.size === 0) return;
  let localModels: LocalModel[];
  try {
    localModels = await window.electronAPI.listLocalModels();
  } catch {
    return;
  }
  if (applyLocalModels(localModels)) notify();
}

function ensureProgressListener() {
  if (unsubscribeProgress || !window.electronAPI?.onDownloadProgress) return;
  unsubscribeProgress = window.electronAPI.onDownloadProgress((progress) => {
    const key = `${progress.modelId}:${progress.filename}`;
    if (!registeredTargets.has(key)) return;

    if (progress.status === 'failed' || progress.status === 'cancelled') {
      startedDownloads.delete(key);
      updateSnapshot(key, {
        status: progress.status,
        error: progress.status === 'failed' ? progress.error : undefined,
      });
      notify();
      return;
    }

    if (progress.status === 'completed') {
      updateSnapshot(key, {
        status: 'completed',
        percent: 100,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        error: undefined,
      });
      syncInstalledDownloads().catch(() => undefined);
      return;
    }

    if (progress.status === 'merging') {
      updateSnapshot(key, {
        status: 'merging',
        percent: 100,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        error: undefined,
      });
      notify();
      return;
    }

    const previous = downloadSnapshots.get(key) ?? EMPTY_ROW_STATE;
    if (
      previous.status === 'installed' ||
      previous.status === 'completed' ||
      previous.status === 'failed' ||
      previous.status === 'cancelled'
    ) {
      return;
    }
    updateSnapshot(key, {
      status: 'downloading',
      percent: progress.percent,
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes,
      error: undefined,
    });
    notify();
  });
}

export function registerDownloadTargets(targets: readonly DownloadTarget[]) {
  ensureProgressListener();
  targets.forEach((target) => {
    registeredTargets.set(getDownloadKey(target), target);
  });
}

export function getDownloadRow(key: string): DownloadRowState {
  return downloadSnapshots.get(key) ?? EMPTY_ROW_STATE;
}

export function subscribeDownloads(listener: () => void): () => void {
  ensureProgressListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGroupTargets(group: DownloadGroup): DownloadTarget[] {
  return group.projector ? [group.model, group.projector] : [group.model];
}

export function getSectionStatus(
  targets: readonly DownloadTarget[],
  rows: Record<string, DownloadRowState>,
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

export function getSectionTotals(
  targets: readonly DownloadTarget[],
  rows: Record<string, DownloadRowState>,
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

export function getSectionMeta(
  status: DownloadStatus,
  totals: SectionTotals,
): string {
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

export async function startDownloadTarget(
  target: DownloadTarget,
  resume = false,
): Promise<void> {
  const key = getDownloadKey(target);
  registeredTargets.set(key, target);
  ensureProgressListener();

  if (startedDownloads.has(key)) return;
  const snapshot = getDownloadRow(key);
  if (snapshot.status === 'installed' || snapshot.status === 'completed')
    return;

  startedDownloads.add(key);
  updateSnapshot(key, {
    status: 'downloading',
    error: undefined,
  });
  notify();

  const request = resume
    ? window.electronAPI.resumeDownload(target.repoId, target.filename)
    : window.electronAPI.downloadModel(target.repoId, target.filename);

  const task = request
    .then((result) => {
      if (result === 'CANCELLED') {
        startedDownloads.delete(key);
        updateSnapshot(key, { status: 'cancelled' });
        notify();
        return undefined;
      }
      updateSnapshot(key, {
        status: 'completed',
        percent: 100,
        downloadedBytes: getDownloadRow(key).totalBytes,
      });
      notify();
      return syncInstalledDownloads();
    })
    .catch((error: unknown) => {
      startedDownloads.delete(key);
      const message =
        error instanceof Error ? error.message : 'Failed to download';
      updateSnapshot(key, { status: 'failed', error: message });
      notify();
    });

  activeDownloadTasks.set(key, task);
  task
    .then(
      () => activeDownloadTasks.delete(key),
      () => activeDownloadTasks.delete(key),
    )
    .catch(() => undefined);
}

export async function initializeDownloads(
  targets: readonly DownloadTarget[],
): Promise<void> {
  registerDownloadTargets(targets);
  await syncInstalledDownloads();

  targets.forEach((target) => {
    const key = getDownloadKey(target);
    const snapshot = getDownloadRow(key);
    if (
      snapshot.status === 'installed' ||
      snapshot.status === 'failed' ||
      snapshot.status === 'cancelled'
    ) {
      return;
    }
    if (activeDownloadTasks.has(key)) return;
    if (snapshot.status === 'completed') {
      startedDownloads.delete(key);
      updateSnapshot(key, {
        status: 'queued',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
      });
    }
    startDownloadTarget(target).catch(() => undefined);
  });
}

export function retryDownloadTargets(
  targets: readonly DownloadTarget[],
  resume = false,
): void {
  targets.forEach((target) => {
    const key = getDownloadKey(target);
    const { status } = getDownloadRow(key);
    if (status !== 'failed' && status !== 'cancelled') return;
    startedDownloads.delete(key);
    updateSnapshot(key, {
      status: 'queued',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: undefined,
    });
    notify();
    startDownloadTarget(target, resume && status === 'failed').catch(
      () => undefined,
    );
  });
}

export async function cancelDownloadTargets(
  targets: readonly DownloadTarget[],
): Promise<void> {
  await Promise.all(
    targets.map(async (target) => {
      const key = getDownloadKey(target);
      const { status } = getDownloadRow(key);
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

      const finalStatus = getDownloadRow(key).status;
      downloadSnapshots.delete(key);

      if (finalStatus !== 'installed' && finalStatus !== 'completed') {
        await window.electronAPI
          .deletePartFile(target.repoId, target.filename)
          .catch(() => undefined);
      }
      notify();
    }),
  );
}

export function useDownloadRows(
  targets: readonly DownloadTarget[],
): Record<string, DownloadRowState> {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeDownloads(() =>
      setRevision((value) => value + 1),
    );
    initializeDownloads(targets).catch(() => undefined);
    return unsubscribe;
  }, [targets]);

  const rows: Record<string, DownloadRowState> = {};
  targets.forEach((target) => {
    const key = getDownloadKey(target);
    rows[key] = getDownloadRow(key);
  });
  return rows;
}
