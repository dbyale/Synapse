import { BrowserWindow } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
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
const COMPILE_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60 * 1000;
const PROBE_CACHE_MS = 15 * 1000;

export type PythonPackageInstallStatus =
  | 'installed'
  | 'missing'
  | 'queued'
  | 'installing'
  | 'failed';

/** Sub-state of an in-flight package, surfaced so setup can show real progress. */
export type PythonPackagePhase =
  | 'resolving'
  | 'downloading'
  | 'installing'
  | 'compiling';

export interface PythonPackageInfo {
  id: string;
  pip: string;
  importName: string;
  label: string;
  group: PythonPackageGroup;
  groupLabel: string;
  status: PythonPackageInstallStatus;
  /** Current stage while `status` is `installing`. */
  phase?: PythonPackagePhase;
  /** Bytes fetched for this package so far (download phase). */
  downloadedBytes?: number;
  /** Number of .py files compiled for this package so far. */
  compiledFiles?: number;
  /** Total .py files pip will precompile for this package. */
  totalFiles?: number;
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
  /** Ids still waiting in this run, in the order they will be installed. */
  queue: string[];
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
    queue: [],
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

// ── Install queue ───────────────────────────────────────────────────────────
// Every id covered by the run that is currently in flight. A tool that needs a
// package already in this set must wait for that package instead of starting a
// second pip invocation (or waiting for the whole background install).
let runTargets = new Set<string>();
// Ids requested while a run was in flight but not covered by it yet. They are
// spliced in after the package that is currently installing.
let lateRequests: string[] = [];
// Per-package outcome of the run in flight, used to resolve waiters.
let runResults = new Map<string, { ok: boolean; error?: string }>();
const packageWaiters = new Map<string, Array<(ok: boolean) => void>>();

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

function forgetAvailability(binary: string, importName: string): void {
  availabilityCache.delete(availabilityKey(binary, importName));
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

/**
 * Terminate a child and everything it spawned (the precompile helper fans out
 * into a process pool; killing only the parent would leak the workers).
 */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    }).on('error', () => undefined);
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Process may already be gone.
  }
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

// `--progress-bar raw` emits rate-limited "Progress <bytes> of <total>" lines.
const PIP_PROGRESS_LINE = /^Progress (\d+) of (\d+)$/;

function cloneSnapshot(): PythonPackagesSnapshot {
  return {
    ...snapshot,
    queue: [...snapshot.queue],
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

function setPackageProgress(
  packageId: string,
  patch: Partial<PythonPackageInfo>,
): void {
  snapshot = {
    ...snapshot,
    packages: snapshot.packages.map((pkg) =>
      pkg.id === packageId ? { ...pkg, ...patch } : pkg,
    ),
  };
}

function clearPackageProgress(packageId: string): void {
  setPackageProgress(packageId, {
    phase: undefined,
    downloadedBytes: undefined,
    compiledFiles: undefined,
    totalFiles: undefined,
  });
}

function recomputeCompleted(): void {
  snapshot = {
    ...snapshot,
    completed: snapshot.packages.filter((pkg) => pkg.status === 'installed')
      .length,
  };
}

function packageInfo(id: string): PythonPackageInfo | undefined {
  return snapshot.packages.find((pkg) => pkg.id === id);
}

function isInstalled(id: string): boolean {
  return packageInfo(id)?.status === 'installed';
}

function settlePackage(id: string, ok: boolean, error?: string): void {
  runResults.set(id, { ok, ...(error ? { error } : {}) });
  const waiters = packageWaiters.get(id);
  if (!waiters) return;
  packageWaiters.delete(id);
  waiters.forEach((resolve) => resolve(ok));
}

function waitForPackage(id: string): Promise<boolean> {
  const settled = runResults.get(id);
  if (settled) return Promise.resolve(settled.ok);
  if (isInstalled(id)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const waiters = packageWaiters.get(id) ?? [];
    waiters.push(resolve);
    packageWaiters.set(id, waiters);
  });
}

/**
 * True when the package is part of the install that is currently running and
 * has not settled yet. Callers use this to join the queue instead of spawning a
 * second pip install for a package that is already on its way.
 */
export function isPythonPackagePending(id: string): boolean {
  return !!installPromise && runTargets.has(id) && !runResults.has(id);
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
    queue: [],
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
    queue: [],
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

interface PipInstallHooks {
  onDownload?: (downloadedBytes: number) => void;
  onInstalling?: () => void;
}

interface PipInstallResult {
  /** Distributions pip reported installing (used to scope precompilation). */
  dists: string[];
}

/**
 * Install one requirement. Downloads stream through `--progress-bar raw` so the
 * setup page can show real byte counts, and bytecode compilation is deferred to
 * `compileDistributions()` where it can use every core instead of pip's
 * single-threaded compileall.
 */
function pipInstall(
  binary: string,
  requirement: string,
  hooks: PipInstallHooks = {},
): Promise<PipInstallResult> {
  const queuedAt = Date.now();
  return withPipLock(
    () =>
      new Promise<PipInstallResult>((resolve, reject) => {
        const waited = Date.now() - queuedAt;
        if (waited >= 1000) {
          log(
            `Starting ${requirement} after waiting ${(waited / 1000).toFixed(1)}s for another pip install.`,
          );
        }
        const reportPath = join(
          tmpdir(),
          `synapse-pip-report-${randomUUID()}.json`,
        );
        const args = [
          '-m',
          'pip',
          'install',
          requirement,
          '--no-input',
          '--disable-pip-version-check',
          '--progress-bar',
          'raw',
          '--no-compile',
          '--no-warn-script-location',
          '--report',
          reportPath,
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
        let completedBytes = 0;
        let currentBytes = 0;
        let currentTotal = 0;
        let sawActivity = false;

        const readReport = async (): Promise<string[]> => {
          try {
            const raw = await readFile(reportPath, 'utf8');
            const parsed = JSON.parse(raw) as {
              install?: Array<{ metadata?: { name?: string } }>;
            };
            return (parsed.install ?? [])
              .map((entry) => String(entry?.metadata?.name ?? '').trim())
              .filter(Boolean);
          } catch {
            return [];
          } finally {
            await rm(reportPath, { force: true }).catch(() => undefined);
          }
        };

        const emitLogLines = (flush: boolean) => {
          const parts = lineBuffer.split(/\r\n|\r|\n/);
          lineBuffer = flush ? '' : (parts.pop() ?? '');
          parts.forEach((raw) => {
            const line = stripAnsi(raw).trim();
            if (!line) return;
            const progress = PIP_PROGRESS_LINE.exec(line);
            if (progress) {
              const current = Number(progress[1]);
              const total = Number(progress[2]);
              if (
                currentTotal > 0 &&
                (total !== currentTotal || current < currentBytes)
              ) {
                completedBytes += currentTotal;
              }
              currentTotal = total;
              currentBytes = current;
              hooks.onDownload?.(completedBytes + currentBytes);
              return;
            }
            if (PIP_LOG_LINE.test(line)) {
              log(`  ${line}`);
              if (
                !sawActivity &&
                /^(Collecting|Downloading|Using cached)/.test(line)
              ) {
                sawActivity = true;
                hooks.onDownload?.(0);
              }
              if (line.startsWith('Installing collected packages')) {
                hooks.onInstalling?.();
              }
            }
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
          killProcessTree(child);
          readReport().catch(() => undefined);
          reject(new Error(compactPipError(output, requirement)));
        }, PIP_TIMEOUT_MS);

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          readReport().catch(() => undefined);
          reject(new Error(`Failed to start pip: ${err.message}`));
        });

        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          emitLogLines(true);
          if (code === 0) {
            readReport()
              .then((dists) => resolve({ dists }))
              .catch(() => resolve({ dists: [] }));
            return;
          }
          readReport().catch(() => undefined);
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

// ── Parallel bytecode precompilation ────────────────────────────────────────
// pip compiles .py files one at a time after installing (~5 minutes for the
// full tool set on a typical machine). This helper compiles the same files with
// a process pool and reports real per-file progress instead.

const COMPILE_SCRIPT = [
  'import os',
  'import sys',
  'import time',
  'from concurrent.futures import ProcessPoolExecutor',
  'from importlib import metadata',
  'from pathlib import Path',
  'import py_compile',
  '',
  '',
  'def _norm(name):',
  "    return name.lower().replace('_', '-').replace('.', '-')",
  '',
  '',
  'def _collect(names):',
  '    wanted = {_norm(n) for n in names}',
  '    seen = set()',
  '    files = []',
  '    for dist in metadata.distributions():',
  "        name = dist.metadata.get('Name') or ''",
  '        if _norm(name) not in wanted:',
  '            continue',
  "        root = str(dist.locate_file(''))",
  '        if root in seen:',
  '            continue',
  '        seen.add(root)',
  '        for entry in (dist.files or []):',
  "            if not str(entry).endswith('.py'):",
  '                continue',
  '            path = Path(dist.locate_file(entry))',
  '            if path.is_file():',
  '                files.append(str(path))',
  '    return files',
  '',
  '',
  'def _compile_one(path):',
  '    try:',
  '        py_compile.compile(path, doraise=False)',
  '    except Exception:',
  '        pass',
  '',
  '',
  'def _report(done, total, last):',
  '    now = time.monotonic()',
  '    if done != total and now - last < 0.15:',
  '        return last',
  "    print('Progress %d of %d' % (done, total), flush=True)",
  '    return now',
  '',
  '',
  'def main():',
  '    files = _collect(sys.argv[1:])',
  '    total = len(files)',
  "    print('Total %d' % total, flush=True)",
  '    if total == 0:',
  '        return',
  '    done = 0',
  '    last = 0.0',
  '    if total <= 64:',
  '        for path in files:',
  '            _compile_one(path)',
  '            done += 1',
  '            last = _report(done, total, last)',
  '        return',
  '    workers = max(1, min(os.cpu_count() or 1, 32))',
  '    with ProcessPoolExecutor(max_workers=workers) as pool:',
  '        for _ in pool.map(_compile_one, files, chunksize=8):',
  '            done += 1',
  '            last = _report(done, total, last)',
  '',
  '',
  "if __name__ == '__main__':",
  '    try:',
  '        main()',
  '    except BrokenPipeError:',
  '        pass',
].join('\n');

let compileScriptPath: Promise<string> | null = null;

function getCompileScript(): Promise<string> {
  if (!compileScriptPath) {
    const target = join(tmpdir(), 'synapse-precompile.py');
    compileScriptPath = writeFile(target, COMPILE_SCRIPT, 'utf8')
      .then(() => target)
      .catch((err) => {
        compileScriptPath = null;
        throw err;
      });
  }
  return compileScriptPath;
}

/**
 * Precompile every .py file belonging to the given distributions.
 *
 * Compilation is a cache warm-up, never a correctness requirement, so failures
 * are logged and swallowed: Python will compile a module on first import.
 */
async function compileDistributions(
  binary: string,
  dists: string[],
  onProgress: (compiled: number, total: number) => void,
): Promise<void> {
  if (dists.length === 0) return;
  let script: string;
  try {
    script = await getCompileScript();
  } catch (err) {
    log('Could not prepare the precompile helper:', err);
    return;
  }

  await new Promise<void>((resolve) => {
    const child = spawn(binary, [script, ...dists], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let lineBuffer = '';
    let settled = false;
    let total = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const emit = (flush: boolean) => {
      const parts = lineBuffer.split(/\r\n|\r|\n/);
      lineBuffer = flush ? '' : (parts.pop() ?? '');
      parts.forEach((raw) => {
        const line = raw.trim();
        if (!line) return;
        const totalMatch = /^Total (\d+)$/.exec(line);
        if (totalMatch) {
          total = Number(totalMatch[1]);
          onProgress(0, total);
          return;
        }
        const progress = PIP_PROGRESS_LINE.exec(line);
        if (progress) {
          onProgress(Number(progress[1]), Number(progress[2]));
          return;
        }
        if (line.startsWith('Traceback') || line.includes('Error')) {
          log(`  [precompile] ${line}`);
        }
      });
    };

    const finish = (reason?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      emit(true);
      if (reason) log(`Precompile helper: ${reason}`);
      if (total > 0) onProgress(total, total);
      resolve();
    };

    timer = setTimeout(() => {
      killProcessTree(child);
      finish('timed out');
    }, COMPILE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      emit(false);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      emit(false);
    });
    child.on('error', (err) => finish(err.message));
    child.on('close', (code) =>
      finish(code === 0 ? undefined : `exited with code ${code}`),
    );
  });
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
    runTargets.forEach((id) => settlePackage(id, false));
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
  const pending: (typeof PYTHON_PACKAGES)[number][] = PYTHON_PACKAGES.filter(
    (pkg) => {
      const info = current.packages.find((entry) => entry.id === pkg.id);
      if (!info || info.status === 'installed') return false;
      return !requested || requested.has(pkg.id);
    },
  );
  const seen = new Set(pending.map((pkg) => pkg.id));

  // Anything that was already installed while callers were waiting on this run
  // must settle now, otherwise their waiters would hang until the run ends.
  runTargets.forEach((id) => {
    if (!seen.has(id) && isInstalled(id)) settlePackage(id, true);
  });

  // Requests that arrived while we were probing still belong to this run.
  const drainLateRequests = (): void => {
    if (lateRequests.length === 0) return;
    const late = lateRequests;
    lateRequests = [];
    late.forEach((id) => {
      if (seen.has(id)) return;
      const spec = PYTHON_PACKAGES.find((pkg) => pkg.id === id);
      if (!spec) return;
      seen.add(id);
      pending.push(spec);
      setPackageState(id, 'queued');
    });
    snapshot = { ...snapshot, queue: pending.map((pkg) => pkg.id) };
  };
  drainLateRequests();

  if (pending.length === 0) {
    log('All requested Python libraries are already installed.');
    runTargets.forEach((id) => {
      if (isInstalled(id)) settlePackage(id, true);
    });
    return { success: true, installed: [], failed: [] };
  }

  const noun = pending.length === 1 ? 'library' : 'libraries';
  const alreadyInstalled = PYTHON_PACKAGES.length - pending.length;
  if (runtime.fallback) {
    log(
      `Selected ${runtime.selection} Python is unavailable; using ${runtime.source} Python instead.`,
    );
  }
  log(
    `Installing ${pending.length} ${noun} into ${runtime.source} Python (${runtime.binary}).`,
  );
  if (alreadyInstalled > 0) {
    log(
      `${alreadyInstalled} libraries are already installed and will be skipped.`,
    );
  }
  log(
    `Approximate download size: ${formatMB(
      pending.reduce((sum, pkg) => sum + pkg.approxBytes, 0),
    )}.`,
  );

  snapshot = {
    ...snapshot,
    installing: true,
    error: undefined,
    queue: pending.map((pkg) => pkg.id),
  };
  pending.forEach((pkg) => {
    failedErrors.delete(failureKey(runtime, pkg.id));
    // Everything in this run is visibly queued until its turn starts.
    setPackageState(pkg.id, 'queued');
    clearPackageProgress(pkg.id);
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
  while (pending.length > 0 || lateRequests.length > 0) {
    drainLateRequests();
    if (pending.length === 0) break;
    const pkg = pending.shift() as (typeof PYTHON_PACKAGES)[number];
    position += 1;
    const prefix = `[${position}] ${pkg.label} (${pkg.pip})`;

    // Re-check right before downloading: another tool (or a previous run
    // whose state was reset) may already have installed it.
    const alreadyPresent = await isModuleAvailable(
      runtime.binary,
      pkg.importName,
    );
    if (alreadyPresent) {
      failedErrors.delete(failureKey(runtime, pkg.id));
      setPackageState(pkg.id, 'installed');
      clearPackageProgress(pkg.id);
      installed.push(pkg.id);
      settlePackage(pkg.id, true);
      log(`${prefix} — already installed; skipping`);
    } else {
      forgetAvailability(runtime.binary, pkg.importName);
      snapshot = {
        ...snapshot,
        currentId: pkg.id,
        queue: pending.map((entry) => entry.id),
      };
      setPackageProgress(pkg.id, {
        phase: 'resolving',
        downloadedBytes: 0,
        compiledFiles: 0,
        totalFiles: 0,
      });
      setPackageState(pkg.id, 'installing');
      publish();

      log(`${prefix} — installing…`);
      const startedAt = Date.now();

      try {
        const { dists } = await pipInstall(runtime.binary, pkg.pip, {
          onDownload: (bytes) => {
            setPackageProgress(pkg.id, {
              phase: 'downloading',
              downloadedBytes: bytes,
            });
            publish();
          },
          onInstalling: () => {
            setPackageProgress(pkg.id, { phase: 'installing' });
            publish();
          },
        });

        setPackageProgress(pkg.id, { phase: 'compiling' });
        publish();
        // Fall back to the requirement name when pip's JSON report is missing.
        const compileTargets =
          dists.length > 0
            ? dists
            : [pkg.pip.replace(/[[<>=!~].*$/, '').trim()];
        await compileDistributions(
          runtime.binary,
          compileTargets,
          (done, total) => {
            setPackageProgress(pkg.id, {
              phase: 'compiling',
              compiledFiles: done,
              totalFiles: total,
            });
            publish();
          },
        );

        await verifyImport(runtime.binary, pkg.importName, pkg.pip);
        failedErrors.delete(failureKey(runtime, pkg.id));
        setPackageState(pkg.id, 'installed');
        clearPackageProgress(pkg.id);
        installed.push(pkg.id);
        settlePackage(pkg.id, true);
        log(
          `${prefix} — ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failedErrors.set(failureKey(runtime, pkg.id), message);
        setPackageState(pkg.id, 'failed', message);
        clearPackageProgress(pkg.id);
        failed.push({ id: pkg.id, label: pkg.label, error: message });
        settlePackage(pkg.id, false, message);
        log(
          `${prefix} — failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
        log(message);
      }
    }

    recomputeCompleted();
    snapshot = { ...snapshot, queue: pending.map((entry) => entry.id) };
    publish();
  }
  /* eslint-enable no-restricted-syntax, no-await-in-loop */

  snapshot = {
    ...snapshot,
    installing: false,
    currentId: undefined,
    queue: [],
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

  // Settle anything still outstanding so no caller can wait forever.
  runTargets.forEach((id) => {
    if (!runResults.has(id)) settlePackage(id, isInstalled(id));
  });

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
  const wanted = (
    ids && ids.length > 0 ? ids : PYTHON_PACKAGES.map((p) => p.id)
  )
    .filter((id) => PYTHON_PACKAGES.some((pkg) => pkg.id === id))
    .filter((id, index, all) => all.indexOf(id) === index);

  // A run is already in flight. Join it for packages it covers, and append the
  // rest to its queue instead of starting a competing second pip install.
  if (installPromise) {
    const task = installPromise;
    wanted.forEach((id) => {
      if (runTargets.has(id)) return;
      runTargets.add(id);
      if (!runResults.has(id) && !lateRequests.includes(id)) {
        lateRequests.push(id);
      }
    });
    const outcomes = await Promise.all(
      wanted.map(async (id) => {
        const ok = await Promise.race([
          waitForPackage(id),
          task.then(() => isInstalled(id)),
        ]);
        return { id, ok };
      }),
    );
    const installed = outcomes.filter((e) => e.ok).map((e) => e.id);
    const failed = outcomes
      .filter((e) => !e.ok)
      .map((e) => ({
        id: e.id,
        label: packageInfo(e.id)?.label ?? e.id,
        error: runResults.get(e.id)?.error ?? packageInfo(e.id)?.error,
      }));
    return {
      success: failed.length === 0,
      installed,
      failed,
      ...(failed.length > 0
        ? { error: `${failed.length} library installation(s) failed.` }
        : {}),
    };
  }

  runResults = new Map();
  runTargets = new Set(wanted);
  lateRequests = [];

  const task = runInstall(wanted)
    .then((result) => {
      runTargets.forEach((id) => {
        if (!runResults.has(id)) settlePackage(id, isInstalled(id));
      });
      return result;
    })
    .catch((err): PythonPackagesInstallResult => {
      const message = err instanceof Error ? err.message : String(err);
      snapshot = {
        ...snapshot,
        installing: false,
        queue: [],
        error: message,
      };
      runTargets.forEach((id) => {
        if (!runResults.has(id)) settlePackage(id, false, message);
      });
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

  const managed = spec
    ? PYTHON_PACKAGES.some((pkg) => pkg.id === spec.id)
    : false;

  // The package may already be queued by onboarding or another tool call.
  // Wait for that install instead of starting a duplicate pip invocation.
  if (spec && managed && isPythonPackagePending(spec.id)) {
    log(`Waiting for queued install of ${moduleName}.`);
    const ok = await waitForPackage(spec.id);
    if (ok && (await isModuleAvailable(runtime.binary, moduleName))) {
      rememberAvailability(runtime.binary, moduleName, true);
      return { success: true };
    }
  }

  if (await isModuleAvailable(runtime.binary, moduleName)) {
    rememberAvailability(runtime.binary, moduleName, true);
    return { success: true };
  }

  log(
    `Missing ${moduleName}; installing ${requirement} for the selected runtime.`,
  );

  if (spec && managed) {
    forgetAvailability(runtime.binary, moduleName);
    const result = await installPythonPackages([spec.id]);
    if (await isModuleAvailable(runtime.binary, moduleName)) {
      rememberAvailability(runtime.binary, moduleName, true);
      return { success: true };
    }
    const failure = result.failed.find((entry) => entry.id === spec.id);
    return {
      success: false,
      error: failure?.error ?? `Failed to install ${requirement}.`,
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
