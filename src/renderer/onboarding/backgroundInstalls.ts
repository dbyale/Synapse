import type {
  BackendDownload,
  BackendDownloadRecord,
  BinaryKind,
  DownloadProgress,
  PythonPackagesSnapshot,
  PythonPackagesInstallResult,
} from '../preload.d';

export type BinaryInstallStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BinaryInstallSnapshot {
  kind: BinaryKind;
  id: string;
  label: string;
  status: BinaryInstallStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
  download?: BackendDownload;
  folder?: string;
}

export interface BinaryRecords {
  backends: BackendDownloadRecord[];
  customBackendPaths: string[];
  python: BackendDownloadRecord | null;
}

interface BackgroundOptions {
  backend: boolean;
  python: boolean;
}

const installSnapshots = new Map<string, BinaryInstallSnapshot>();
const progressKeys = new Map<string, string>();
const activeInstalls = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const autoStarted = new Set<BinaryKind>();
const setupErrors = new Map<BinaryKind, string>();

let unsubscribeProgress: (() => void) | null = null;
let unsubscribePackages: (() => void) | null = null;
let packagesSnapshot: PythonPackagesSnapshot | null = null;
let packagesPromise: Promise<PythonPackagesInstallResult> | null = null;

function installKey(kind: BinaryKind, id: string): string {
  return `${kind}:${id}`;
}

function progressKey(download: BackendDownload): string {
  return `${download.id}:${download.label}`;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(
  key: string,
  update: Partial<BinaryInstallSnapshot>,
): void {
  const previous = installSnapshots.get(key);
  if (!previous) return;
  installSnapshots.set(key, { ...previous, ...update });
}

function ensureProgressListener() {
  if (!unsubscribeProgress && window.electronAPI?.onDownloadProgress) {
    unsubscribeProgress = window.electronAPI.onDownloadProgress(
      (progress: DownloadProgress) => {
        const key = progressKeys.get(
          `${progress.modelId}:${progress.filename}`,
        );
        if (!key) return;
        const previous = installSnapshots.get(key);
        if (!previous) return;

        if (progress.status === 'failed' || progress.status === 'cancelled') {
          setSnapshot(key, {
            status: progress.status,
            error: progress.status === 'failed' ? progress.error : undefined,
          });
          notify();
          return;
        }

        if (progress.status === 'completed') {
          setSnapshot(key, {
            status: 'completed',
            percent: 100,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            error: undefined,
          });
          notify();
          return;
        }

        setSnapshot(key, {
          status: 'downloading',
          percent: progress.percent,
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          error: undefined,
        });
        notify();
      },
    );
  }

  if (!unsubscribePackages && window.electronAPI?.onPythonPackagesProgress) {
    unsubscribePackages = window.electronAPI.onPythonPackagesProgress(
      (snapshot: PythonPackagesSnapshot) => {
        packagesSnapshot = snapshot;
        notify();
      },
    );
  }
}

export function subscribeBinaryInstalls(listener: () => void): () => void {
  ensureProgressListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBinaryInstallSnapshot(
  kind: BinaryKind,
  id: string,
): BinaryInstallSnapshot | undefined {
  return installSnapshots.get(installKey(kind, id));
}

export function getBackgroundSetupError(kind: BinaryKind): string | undefined {
  return setupErrors.get(kind);
}

export function getPythonPackagesSnapshot(): PythonPackagesSnapshot | null {
  return packagesSnapshot;
}

export async function refreshPythonPackagesStatus(
  force = false,
): Promise<PythonPackagesSnapshot | null> {
  ensureProgressListener();
  try {
    const next = await window.electronAPI.getPythonPackagesStatus(force);
    // Progress events own the cache while an install is running. A slower
    // status reply must not roll the counter back (e.g. to a reset 0 of N).
    const previous = packagesSnapshot;
    const installActive = !!previous?.installing;
    if (!installActive || next.completed >= (previous?.completed ?? 0)) {
      packagesSnapshot = next;
    }
    notify();
  } catch {
    // Keep the last known snapshot on transient probe failures.
  }
  return packagesSnapshot;
}

export async function startPythonPackagesInstall(
  ids?: string[],
): Promise<PythonPackagesInstallResult> {
  ensureProgressListener();
  // The main process joins an in-flight run for the ids it already covers and
  // splices the rest into its queue, so a second request can start right away.
  const task = window.electronAPI
    .installPythonPackages(ids)
    .then(async (result) => {
      packagesSnapshot = await window.electronAPI.getPythonPackagesStatus(true);
      notify();
      return result;
    })
    .catch((error): PythonPackagesInstallResult => {
      const message =
        error instanceof Error
          ? error.message
          : 'Python library installation failed';
      if (packagesSnapshot) {
        packagesSnapshot = {
          ...packagesSnapshot,
          installing: false,
          error: message,
        };
      }
      notify();
      return { success: false, installed: [], failed: [], error: message };
    });

  packagesPromise = task;
  task
    .finally(() => {
      if (packagesPromise === task) packagesPromise = null;
    })
    .catch(() => undefined);
  return task;
}

export function markBinaryInstalled(
  kind: BinaryKind,
  id: string,
  label: string,
  folder?: string,
): void {
  ensureProgressListener();
  const key = installKey(kind, id);
  const previous = installSnapshots.get(key);
  installSnapshots.set(key, {
    ...(previous ?? {
      kind,
      id,
      label,
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    }),
    status: 'completed',
    percent: 100,
    error: undefined,
    folder: folder ?? previous?.folder,
  });
  notify();
}

export function removeBinaryInstall(kind: BinaryKind, id: string): void {
  installSnapshots.delete(installKey(kind, id));
  notify();
}

export async function startBinaryInstall(
  kind: BinaryKind,
  download: BackendDownload,
  dir: string,
): Promise<void> {
  ensureProgressListener();
  const key = installKey(kind, download.id);
  const active = activeInstalls.get(key);
  if (active) return active;
  if (installSnapshots.get(key)?.status === 'completed') return undefined;

  installSnapshots.set(key, {
    kind,
    id: download.id,
    label: download.label,
    status: 'downloading',
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    folder: download.folder,
    download,
  });
  progressKeys.set(progressKey(download), key);
  setupErrors.delete(kind);
  notify();

  window.dispatchEvent(
    new CustomEvent('open-download-manager', {
      detail: { modelId: download.id, filename: download.label },
    }),
  );

  const task = window.electronAPI
    .downloadBinary(kind, download, dir)
    .then(() => {
      setSnapshot(key, {
        status: 'completed',
        percent: 100,
        error: undefined,
      });
      notify();
      return undefined;
    })
    .catch((error: unknown) => {
      const cancelled = installSnapshots.get(key)?.status === 'cancelled';
      if (!cancelled) {
        setSnapshot(key, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to download',
        });
        notify();
      }
      throw error;
    })
    .finally(() => {
      activeInstalls.delete(key);
    });

  activeInstalls.set(key, task);
  return task;
}

export async function syncBinaryRecords(): Promise<BinaryRecords> {
  ensureProgressListener();
  const records = await window.electronAPI.getBinaryDownloads();
  records.backends.forEach((record) => {
    markBinaryInstalled('backend', record.id, record.label, record.folder);
  });
  if (records.python) {
    markBinaryInstalled(
      'python',
      records.python.id,
      records.python.label,
      records.python.folder,
    );
  }
  return records;
}

async function installRecommendedBackend(): Promise<void> {
  const [info, settings, records] = await Promise.all([
    window.electronAPI.getBackendInfo(),
    window.electronAPI.loadSettings(),
    window.electronAPI.getBinaryDownloads(),
  ]);
  const recommended = info.recommended[0];
  if (!recommended) {
    throw new Error('No compatible backend was found for this system.');
  }
  const installed = records.backends.some(
    (record) =>
      record.id === recommended.id || record.folder === recommended.folder,
  );
  if (installed) {
    markBinaryInstalled(
      'backend',
      recommended.id,
      recommended.label,
      recommended.folder,
    );
    return;
  }
  await startBinaryInstall(
    'backend',
    recommended,
    settings.backendDirectory || info.defaultDownloadDir,
  );
}

function kickOffPythonLibraries(): void {
  startPythonPackagesInstall().catch(() => undefined);
}

async function installRecommendedPython(): Promise<void> {
  const [info, settings] = await Promise.all([
    window.electronAPI.getPythonInfo(),
    window.electronAPI.loadSettings(),
  ]);
  const selection = settings.pythonRuntime === 'system' ? 'system' : 'managed';

  // The user explicitly chose system Python: never download the managed one.
  if (selection === 'system' && info.system.available) {
    kickOffPythonLibraries();
    return;
  }

  // Managed runtime already installed — make sure its tool libraries follow.
  if (info.managed.available) {
    if (info.recommended) {
      markBinaryInstalled(
        'python',
        info.recommended.id,
        info.recommended.label,
        info.recommended.folder,
      );
    }
    kickOffPythonLibraries();
    return;
  }

  // Default path: install the private runtime even when a system Python is
  // present, so pip always targets a writable, app-owned environment.
  if (info.recommended) {
    await startBinaryInstall(
      'python',
      info.recommended,
      settings.pythonDirectory || info.defaultInstallDir,
    );
    markBinaryInstalled(
      'python',
      info.recommended.id,
      info.recommended.label,
      info.recommended.folder,
    );
    if (settings.pythonRuntime === 'system') {
      await window.electronAPI.saveSettingsSilent({
        ...settings,
        pythonRuntime: 'managed',
      });
    }
    kickOffPythonLibraries();
    return;
  }

  // No managed build for this platform — fall back to the system runtime.
  if (info.system.available) {
    if (settings.pythonRuntime !== 'system') {
      await window.electronAPI.saveSettingsSilent({
        ...settings,
        pythonRuntime: 'system',
      });
    }
    kickOffPythonLibraries();
    return;
  }

  throw new Error(
    'No Python runtime is available. Install Python manually or choose a supported platform.',
  );
}

async function runAutoInstall(
  kind: BinaryKind,
  install: () => Promise<void>,
): Promise<void> {
  if (autoStarted.has(kind)) return;
  autoStarted.add(kind);
  try {
    await install();
  } catch (error) {
    autoStarted.delete(kind);
    setupErrors.set(
      kind,
      error instanceof Error ? error.message : 'Installation failed',
    );
    notify();
  }
}

export async function startBackgroundInstalls(
  options: BackgroundOptions,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (options.backend) {
    tasks.push(runAutoInstall('backend', installRecommendedBackend));
  }
  if (options.python) {
    tasks.push(runAutoInstall('python', installRecommendedPython));
  }
  await Promise.all(tasks);
}

function findCudaRecord(
  records: BackendDownloadRecord[],
): BackendDownloadRecord | undefined {
  return records.find((record) =>
    /cuda/i.test(`${record.id} ${record.label} ${record.folder}`),
  );
}

export async function retryBinaryInstall(kind: BinaryKind): Promise<void> {
  setupErrors.delete(kind);
  if (kind === 'python') {
    await installRecommendedPython();
    return;
  }

  const [info, settings, records] = await Promise.all([
    window.electronAPI.getBackendInfo(),
    window.electronAPI.loadSettings(),
    window.electronAPI.getBinaryDownloads(),
  ]);
  const recommended = info.recommended[0];
  if (!recommended) {
    throw new Error('No compatible backend was found for this system.');
  }

  const staleCuda = /cuda/i.test(recommended.id)
    ? findCudaRecord(records.backends)
    : undefined;
  if (staleCuda && staleCuda.id !== recommended.id) {
    const descriptor: BackendDownload = [
      ...info.recommended,
      ...info.optional,
      ...info.others,
    ].find(
      (download) =>
        download.id === staleCuda.id || download.folder === staleCuda.folder,
    ) ?? {
      id: staleCuda.id,
      label: staleCuda.label,
      icon: 'cuda',
      url: '',
      folder: staleCuda.folder,
      files: [],
      recommended: false,
    };
    const directory = settings.backendDirectory || info.defaultDownloadDir;
    const result = await window.electronAPI.uninstallBinary(
      'backend',
      descriptor,
      directory,
    );
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to remove the old CUDA backend.');
    }
    removeBinaryInstall('backend', staleCuda.id);
    const latest = await window.electronAPI.loadSettings();
    if (latest.selectedBackend === staleCuda.id) {
      await window.electronAPI.saveSettingsSilent({
        ...latest,
        selectedBackend: 'Default',
      });
    }
  }

  await startBinaryInstall(
    'backend',
    recommended,
    settings.backendDirectory || info.defaultDownloadDir,
  );
}
