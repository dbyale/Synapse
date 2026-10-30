import { BrowserWindow } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { loadSettings } from './settings';
import { resolveSelectedPython } from './pythonInfo';
import {
  PYTHON_PACKAGES,
  PYTHON_PACKAGES_APPROX_BYTES,
  PYTHON_PACKAGE_GROUP_LABELS,
  findPythonPackage,
  type PythonPackageGroup,
} from './pythonPackages';

const execFileAsync = promisify(execFile);

const PIP_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60 * 1000;
const PROBE_CACHE_MS = 15 * 1000;

export type PythonPackageInstallStatus =
  | 'installed'
  | 'missing'
  | 'installing'
  | 'failed';

export interface PythonPackageInfo {
  id: string;
  pip: string;
  importName: string;
  label: string;
  group: PythonPackageGroup;
  groupLabel: string;
  status: PythonPackageInstallStatus;
  error?: string;
}

export interface PythonPackagesSnapshot {
  runtime: 'managed' | 'system' | null;
  binary: string | null;
  selection: 'managed' | 'system';
  fallback: boolean;
  installing: boolean;
  completed: number;
  total: number;
  totalApproxBytes: number;
  currentId?: string;
  packages: PythonPackageInfo[];
  error?: string;
}

export interface PythonPackagesInstallResult {
  success: boolean;
  installed: string[];
  failed: Array<{ id: string; label: string; error?: string }>;
  error?: string;
}

interface ResolvedRuntime {
  binary: string;
  source: 'managed' | 'system';
  selection: 'managed' | 'system';
  fallback: boolean;
}

function emptySnapshot(error?: string): PythonPackagesSnapshot {
  return {
    runtime: null,
    binary: null,
    selection: 'managed',
    fallback: false,
    installing: false,
    completed: 0,
    total: PYTHON_PACKAGES.length,
    totalApproxBytes: PYTHON_PACKAGES_APPROX_BYTES,
    packages: PYTHON_PACKAGES.map(
      (pkg): PythonPackageInfo => ({
        id: pkg.id,
        pip: pkg.pip,
        importName: pkg.importName,
        label: pkg.label,
        group: pkg.group,
        groupLabel: PYTHON_PACKAGE_GROUP_LABELS[pkg.group],
        status: 'missing',
      }),
    ),
    ...(error ? { error } : {}),
  };
}

let snapshot: PythonPackagesSnapshot = emptySnapshot();
let runtimeKey: string | null = null;
let probedAt = 0;
let probePromise: Promise<void> | null = null;
let installPromise: Promise<PythonPackagesInstallResult> | null = null;
const failedErrors = new Map<string, string>();

// Import probes spawn a Python process, so remember recent answers for the
// sandbox's lazy auto-install path. Keyed by interpreter + module because the
// user can switch runtimes in Settings.
const AVAILABILITY_CACHE_MS = 30 * 1000;
const availabilityCache = new Map<
  string,
  { checkedAt: number; available: boolean }
>();

function availabilityKey(binary: string, importName: string): string {
  return `${binary}|${importName}`;
}

function rememberAvailability(
  binary: string,
  importName: string,
  available: boolean,
): void {
  availabilityCache.set(availabilityKey(binary, importName), {
    checkedAt: Date.now(),
    available,
  });
}

// Serializes every pip invocation, including lazy auto-installs from parallel
// tool calls, so two installers never write to site-packages at once.
let pipQueue: Promise<unknown> = Promise.resolve();

function withPipLock<T>(task: () => Promise<T>): Promise<T> {
  const next = pipQueue.then(task, task);
  pipQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[python:packages]', ...args);
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripAnsi(value: string): string {
  // Strip ANSI colour codes pip may emit for warnings/progress.
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

// pip prints one line per dependency. Surface only the useful milestones so the
// log stays readable while still showing download sizes, versions, and errors.
const PIP_LOG_LINE =
  /^(Collecting |Downloading |Using cached |Requirement already satisfied|Installing collected packages|Successfully installed|Building wheel |Created wheel |Attempting uninstall|ERROR:|WARNING:)/;

function cloneSnapshot(): PythonPackagesSnapshot {
  return {
    ...snapshot,
    packages: snapshot.packages.map((pkg) => ({ ...pkg })),
  };
}

function publish(): void {
  const payload = cloneSnapshot();
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('python:packages-progress', payload);
    }
  });
}

function runtimeCacheKey(runtime: ResolvedRuntime | null): string {
  return runtime ? `${runtime.source}:${runtime.binary}` : 'none';
}

function failureKey(runtime: ResolvedRuntime, packageId: string): string {
  return `${runtimeCacheKey(runtime)}:${packageId}`;
}

function setPackageState(
  packageId: string,
  status: PythonPackageInstallStatus,
  error?: string,
): void {
  snapshot = {
    ...snapshot,
    packages: snapshot.packages.map((pkg) =>
      pkg.id === packageId
        ? { ...pkg, status, ...(error ? { error } : { error: undefined }) }
        : pkg,
    ),
  };
}

function recomputeCompleted(): void {
  snapshot = {
    ...snapshot,
    completed: snapshot.packages.filter((pkg) => pkg.status === 'installed')
      .length,
  };
}

async function findMissingImports(
  binary: string,
  importNames: string[],
): Promise<Set<string>> {
  const script = [
    'import importlib.util, json',
    `mods = ${JSON.stringify(importNames)}`,
    'missing = []',
    'for m in mods:',
    '    try:',
    '        if importlib.util.find_spec(m) is None:',
    '            missing.append(m)',
    '    except Exception:',
    '        missing.append(m)',
    'print(json.dumps(missing))',
  ].join('\n');

  const { stdout } = await execFileAsync(binary, ['-c', script], {
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const line = stdout.trim().split(/\r?\n/).pop() ?? '[]';
  const parsed = JSON.parse(line);
  return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
}

async function isModuleAvailable(
  binary: string,
  importName: string,
): Promise<boolean> {
  try {
    const missing = await findMissingImports(binary, [importName]);
    return !missing.has(importName);
  } catch {
    return false;
  }
}

async function isModuleAvailableCached(
  binary: string,
  importName: string,
): Promise<boolean> {
  const key = availabilityKey(binary, importName);
  const cached = availabilityCache.get(key);
  if (cached && Date.now() - cached.checkedAt < AVAILABILITY_CACHE_MS) {
    return cached.available;
  }
  const available = await isModuleAvailable(binary, importName);
  rememberAvailability(binary, importName, available);
  return available;
}

async function resolveRuntime(): Promise<ResolvedRuntime | null> {
  return resolveSelectedPython(loadSettings());
}

async function probeRuntime(
  runtime: ResolvedRuntime,
): Promise<PythonPackagesSnapshot> {
  const importNames = PYTHON_PACKAGES.map((pkg) => pkg.importName);
  let missing: Set<string>;
  let probeError: string | undefined;
  try {
    missing = await findMissingImports(runtime.binary, importNames);
  } catch (err) {
    missing = new Set(importNames);
    probeError =
      err instanceof Error ? err.message : 'Failed to inspect Python packages';
  }

  snapshot = {
    runtime: runtime.source,
    binary: runtime.binary,
    selection: runtime.selection,
    fallback: runtime.fallback,
    installing: false,
    completed: 0,
    total: PYTHON_PACKAGES.length,
    totalApproxBytes: PYTHON_PACKAGES_APPROX_BYTES,
    packages: PYTHON_PACKAGES.map((pkg): PythonPackageInfo => {
      const installed = !missing.has(pkg.importName);
      const previousError = failedErrors.get(failureKey(runtime, pkg.id));
      let status: PythonPackageInstallStatus = 'missing';
      if (installed) {
        status = 'installed';
      } else if (previousError) {
        status = 'failed';
      }
      return {
        id: pkg.id,
        pip: pkg.pip,
        importName: pkg.importName,
        label: pkg.label,
        group: pkg.group,
        groupLabel: PYTHON_PACKAGE_GROUP_LABELS[pkg.group],
        status,
        ...(installed || !previousError ? {} : { error: previousError }),
      };
    }),
    ...(probeError
      ? { error: `Could not inspect libraries: ${probeError}` }
      : {}),
  };
  recomputeCompleted();
  probedAt = Date.now();
  return cloneSnapshot();
}

function syncRuntime(runtime: ResolvedRuntime | null): void {
  const key = runtimeCacheKey(runtime);
  if (key === runtimeKey) return;

  // Never wipe live install progress. Force a fresh sync once the run ends so
  // the next status call re-probes the runtime that is actually in effect.
  if (installPromise) {
    runtimeKey = null;
    probedAt = 0;
    return;
  }

  runtimeKey = key;
  probedAt = 0;

  if (!runtime) {
    snapshot = emptySnapshot(
      'No Python runtime is available. Install Python first.',
    );
    return;
  }

  // Keep the last known library states on screen and let the re-probe replace
  // them atomically. Publishing an empty "0 of N" snapshot here caused the
  // setup page to flash back to "Queued" right after an install finished.
  snapshot = {
    ...snapshot,
    runtime: runtime.source,
    binary: runtime.binary,
    selection: runtime.selection,
    fallback: runtime.fallback,
    installing: false,
    currentId: undefined,
    error: undefined,
  };
}

export async function getPythonPackagesStatus(
  force = false,
): Promise<PythonPackagesSnapshot> {
  // Status polling must never disturb an install that is already running.
  if (installPromise) {
    const live = cloneSnapshot();
    // The install may be between its probe and its first publish; never let
    // the UI fall back to a stale "Queued" badge during that window.
    return live.installing ? live : { ...live, installing: true };
  }

  const runtime = await resolveRuntime();
  // An install may have started while the runtime was resolving.
  if (installPromise) {
    const live = cloneSnapshot();
    return live.installing ? live : { ...live, installing: true };
  }
  syncRuntime(runtime);

  if (!runtime) {
    snapshot = { ...snapshot, installing: false };
    return cloneSnapshot();
  }

  if (probePromise) {
    await probePromise;
    return cloneSnapshot();
  }
  if (!force && probedAt > 0 && Date.now() - probedAt < PROBE_CACHE_MS) {
    return cloneSnapshot();
  }

  probePromise = probeRuntime(runtime)
    .then(() => undefined)
    .finally(() => {
      probePromise = null;
    });
  await probePromise;
  return cloneSnapshot();
}

function compactPipError(raw: string, requirement: string): string {
  const cleaned = stripAnsi(raw)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-12)
    .join('\n');
  const detail = cleaned || 'pip exited without reporting an error.';
  return `Failed to install ${requirement}:\n${detail}`;
}

function pipInstall(binary: string, requirement: string): Promise<void> {
  const queuedAt = Date.now();
  return withPipLock(
    () =>
      new Promise<void>((resolve, reject) => {
        const waited = Date.now() - queuedAt;
        if (waited >= 1000) {
          log(
            `Starting ${requirement} after waiting ${(waited / 1000).toFixed(1)}s for another pip install.`,
          );
        }
        const args = [
          '-m',
          'pip',
          'install',
          requirement,
          '--no-input',
          '--disable-pip-version-check',
          '--progress-bar',
          'off',
          '--no-warn-script-location',
        ];
        const child = spawn(binary, args, {
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PIP_DISABLE_PIP_VERSION_CHECK: '1',
          },
        });

        let output = '';
        let lineBuffer = '';
        let settled = false;

        const emitLogLines = (flush: boolean) => {
          const parts = lineBuffer.split(/\r\n|\r|\n/);
          lineBuffer = flush ? '' : (parts.pop() ?? '');
          parts.forEach((raw) => {
            const line = stripAnsi(raw).trim();
            if (line && PIP_LOG_LINE.test(line)) log(`  ${line}`);
          });
        };

        const append = (chunk: Buffer | string) => {
          const text = chunk.toString();
          output = `${output}${text}`.slice(-12_000);
          lineBuffer += text;
          emitLogLines(false);
        };
        child.stdout?.on('data', append);
        child.stderr?.on('data', append);

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          emitLogLines(true);
          output = `${output}\npip install ${requirement} timed out after ${Math.round(
            PIP_TIMEOUT_MS / 60_000,
          )} minutes.`;
          try {
            child.kill();
          } catch {
            // Process may already be gone.
          }
          reject(new Error(compactPipError(output, requirement)));
        }, PIP_TIMEOUT_MS);

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Failed to start pip: ${err.message}`));
        });

        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          emitLogLines(true);
          if (code === 0) {
            resolve();
            return;
          }
          reject(
            new Error(
              compactPipError(
                `${output}\npip exited with code ${code}.`,
                requirement,
              ),
            ),
          );
        });
      }),
  );
}

async function verifyImport(
  binary: string,
  importName: string,
  requirement: string,
): Promise<void> {
  try {
    await execFileAsync(binary, ['-c', `import ${importName}`], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    rememberAvailability(binary, importName, true);
  } catch (err) {
    rememberAvailability(binary, importName, false);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Installed ${requirement} but could not import ${importName}.\n${detail}`,
    );
  }
}

function getRuntimeFailure(
  runtime: ResolvedRuntime | null,
): PythonPackagesInstallResult {
  return {
    success: false,
    installed: [],
    failed: [],
    error: runtime
      ? undefined
      : 'No Python runtime is available. Install Python before installing libraries.',
  };
}

async function runInstall(
  requestedIds?: string[],
): Promise<PythonPackagesInstallResult> {
  const runtime = await resolveRuntime();
  if (!runtime) {
    log('No Python runtime is available; skipping tool-library installation.');
    return getRuntimeFailure(runtime);
  }

  // Claim the runtime before probing so a concurrent status poll cannot reset
  // the snapshot out from under this install.
  runtimeKey = runtimeCacheKey(runtime);

  // Let a status probe that started just before this install finish first, then
  // probe again so the install snapshot is authoritative.
  if (probePromise) await probePromise;

  // Probe before marking `installing` so we only touch missing packages.
  const current = await probeRuntime(runtime);
  const requested = requestedIds ? new Set(requestedIds) : null;
  const targets = PYTHON_PACKAGES.filter((pkg) => {
    const info = current.packages.find((entry) => entry.id === pkg.id);
    if (!info || info.status === 'installed') return false;
    return !requested || requested.has(pkg.id);
  });

  if (targets.length === 0) {
    log('All requested Python libraries are already installed.');
    return { success: true, installed: [], failed: [] };
  }

  const noun = targets.length === 1 ? 'library' : 'libraries';
  const alreadyInstalled = PYTHON_PACKAGES.length - targets.length;
  if (runtime.fallback) {
    log(
      `Selected ${runtime.selection} Python is unavailable; using ${runtime.source} Python instead.`,
    );
  }
  log(
    `Installing ${targets.length} ${noun} into ${runtime.source} Python (${runtime.binary}).`,
  );
  if (alreadyInstalled > 0) {
    log(
      `${alreadyInstalled} libraries are already installed and will be skipped.`,
    );
  }
  log(
    `Approximate download size: ${formatMB(
      targets.reduce((sum, pkg) => sum + pkg.approxBytes, 0),
    )}.`,
  );

  snapshot = {
    ...snapshot,
    installing: true,
    error: undefined,
  };
  targets.forEach((pkg) => {
    failedErrors.delete(failureKey(runtime, pkg.id));
    setPackageState(pkg.id, 'missing');
  });
  // Carry the already-installed count into the very first progress frame.
  recomputeCompleted();
  publish();

  const installed: string[] = [];
  const failed: Array<{ id: string; label: string; error?: string }> = [];

  // Packages install sequentially so pip never writes to site-packages in
  // parallel and progress stays in dependency order.
  let position = 0;
  /* eslint-disable no-restricted-syntax, no-await-in-loop */
  for (const pkg of targets) {
    position += 1;
    const prefix = `[${position}/${targets.length}] ${pkg.label} (${pkg.pip})`;

    // Re-check right before downloading: another tool (or a previous run
    // whose state was reset) may already have installed it.
    const alreadyPresent = await isModuleAvailable(
      runtime.binary,
      pkg.importName,
    );
    if (alreadyPresent) {
      failedErrors.delete(failureKey(runtime, pkg.id));
      setPackageState(pkg.id, 'installed');
      installed.push(pkg.id);
      log(`${prefix} — already installed; skipping`);
    } else {
      snapshot = { ...snapshot, currentId: pkg.id };
      setPackageState(pkg.id, 'installing');
      publish();

      log(`${prefix} — installing…`);
      const startedAt = Date.now();

      try {
        await pipInstall(runtime.binary, pkg.pip);
        await verifyImport(runtime.binary, pkg.importName, pkg.pip);
        failedErrors.delete(failureKey(runtime, pkg.id));
        setPackageState(pkg.id, 'installed');
        installed.push(pkg.id);
        log(
          `${prefix} — ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failedErrors.set(failureKey(runtime, pkg.id), message);
        setPackageState(pkg.id, 'failed', message);
        failed.push({ id: pkg.id, label: pkg.label, error: message });
        log(
          `${prefix} — failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
        log(message);
      }
    }

    recomputeCompleted();
    publish();
  }
  /* eslint-enable no-restricted-syntax, no-await-in-loop */

  snapshot = {
    ...snapshot,
    installing: false,
    currentId: undefined,
    error:
      failed.length > 0
        ? `${failed.length} Python librar${failed.length === 1 ? 'y' : 'ies'} failed to install.`
        : undefined,
  };
  recomputeCompleted();
  publish();

  log(
    `Finished: ${installed.length} installed, ${failed.length} failed — ${snapshot.completed}/${snapshot.total} libraries available.`,
  );

  return {
    success: failed.length === 0,
    installed,
    failed,
    ...(failed.length > 0
      ? { error: `${failed.length} library installation(s) failed.` }
      : {}),
  };
}

export async function installPythonPackages(
  ids?: string[],
): Promise<PythonPackagesInstallResult> {
  // An in-flight run may only cover a subset (e.g. one lazy package). Wait for
  // it, then start a fresh queued run so no requested id is silently skipped.
  while (installPromise) {
    // eslint-disable-next-line no-await-in-loop
    await installPromise.catch(() => undefined);
  }

  const task = runInstall(ids).catch((err): PythonPackagesInstallResult => {
    const message = err instanceof Error ? err.message : String(err);
    snapshot = {
      ...snapshot,
      installing: false,
      error: message,
    };
    publish();
    return { success: false, installed: [], failed: [], error: message };
  });

  installPromise = task;
  task
    .finally(() => {
      if (installPromise === task) installPromise = null;
    })
    .catch(() => undefined);

  return task;
}

/**
 * Ensure one pip package is importable by the selected runtime. Used by the
 * Python sandbox and document conversion so a missing dependency never
 * surfaces as a bare ModuleNotFoundError.
 */
export async function ensurePythonPackage(
  packageName: string,
  importName?: string,
): Promise<{ success: boolean; error?: string }> {
  const spec = findPythonPackage(packageName, importName);
  const moduleName =
    importName ?? spec?.importName ?? packageName.replace(/-/g, '_');
  const requirement = spec?.pip ?? packageName;

  const runtime = await resolveRuntime();
  if (!runtime) {
    return {
      success: false,
      error:
        'No Python runtime is available. Install Python from setup or select a system Python in Settings.',
    };
  }

  if (await isModuleAvailableCached(runtime.binary, moduleName)) {
    return { success: true };
  }

  log(
    `Missing ${moduleName}; installing ${requirement} for the selected runtime.`,
  );

  if (spec && PYTHON_PACKAGES.some((pkg) => pkg.id === spec.id)) {
    // Another tool may be installing right now; wait, then retry once so the
    // queue cannot silently skip our package.
    /* eslint-disable no-await-in-loop */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await installPythonPackages([spec.id]);
      if (await isModuleAvailable(runtime.binary, moduleName)) {
        return { success: true };
      }
      const failure = result.failed.find((entry) => entry.id === spec.id);
      if (failure) {
        return {
          success: false,
          error: failure.error ?? `Failed to install ${requirement}.`,
        };
      }
    }
    /* eslint-enable no-await-in-loop */
    return {
      success: false,
      error: `Failed to install ${requirement}.`,
    };
  }

  // Not in the manifest (future/ad-hoc package): install directly.
  if (installPromise) await installPromise.catch(() => undefined);
  log(`Installing ${requirement} directly (not part of the shared manifest).`);
  try {
    await pipInstall(runtime.binary, requirement);
    await verifyImport(runtime.binary, moduleName, requirement);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Reset cached probe state after the runtime or its install location changes. */
export function invalidatePythonPackageState(): void {
  runtimeKey = null;
  probedAt = 0;
  probePromise = null;
  availabilityCache.clear();
}
