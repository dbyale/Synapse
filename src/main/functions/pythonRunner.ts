import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX_CONFIG = {
  timeoutMs: 15_000,
  maxOutputBytes: 100_000,
  maxCodeLength: 50_000,
  memoryLimitMb: 256,
  recursionLimit: 200,
  allowedModules: new Set([
    // Web search
    'ddgs',
    // Numeric / scientific
    'numpy',
    'pandas',
    'scipy',
    'sklearn',
    'statsmodels',
    'sympy',
    // Plotting
    'matplotlib',
    'matplotlib.pyplot',
    'matplotlib.figure',
    'matplotlib.axes',
    // Image
    'PIL',
    'PIL.Image',
    'PIL.ImageDraw',
    'PIL.ImageFilter',
    // HTTP (read-only use — network is not blocked at OS level in Electron,
    //        so only allow if your use-case requires it; remove if not)
    'requests',
    'httpx',
    // Standard library — safe subset
    'math',
    'cmath',
    'random',
    'statistics',
    'decimal',
    'fractions',
    'datetime',
    'time',
    'calendar',
    'zoneinfo',
    'collections',
    'collections.abc',
    'itertools',
    'functools',
    'operator',
    'json',
    're',
    'string',
    'textwrap',
    'unicodedata',
    'difflib',
    'typing',
    'types',
    'dataclasses',
    'enum',
    'abc',
    'copy',
    'pprint',
    'struct',
    'io',
    'base64',
    'hashlib',
    'hmac',
    'secrets',
    'heapq',
    'bisect',
    'array',
    'queue',
    'contextlib',
    'warnings',
    'traceback',
    'inspect',
    // sklearn submodules
    'sklearn.linear_model',
    'sklearn.ensemble',
    'sklearn.tree',
    'sklearn.preprocessing',
    'sklearn.model_selection',
    'sklearn.metrics',
    'sklearn.cluster',
    'sklearn.decomposition',
    'sklearn.pipeline',
    'sklearn.svm',
    'sklearn.neighbors',
    'sklearn.naive_bayes',
  ]),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 2. TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PythonRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  runId: string;
  executionTimeMs: number;
  timedOut: boolean;
  error?: string;
}

export interface PythonEnvironmentInfo {
  available: boolean;
  binary: string | null;
  version: string | null;
  error?: string;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. STATIC ANALYSIS — runs BEFORE any process is spawned
// ─────────────────────────────────────────────────────────────────────────────

// Each entry: [regex, human-readable reason]
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  // Blocked built-in calls
  [/\beval\s*\(/, 'eval() is not allowed'],
  [/\bexec\s*\(/, 'exec() is not allowed'],
  [/\bcompile\s*\(/, 'compile() is not allowed'],
  [/\b__import__\s*\(/, '__import__() is not allowed'],
  [/\bopen\s*\(/, 'open() is not allowed — no filesystem access'],
  [/\binput\s*\(/, 'input() is not allowed — no stdin interaction'],
  [/\bbreakpoint\s*\(/, 'breakpoint() is not allowed'],
  [/\bmemoryview\s*\(/, 'memoryview() is not allowed'],
  [/\bgetattr\s*\(/, 'getattr() is not allowed'],
  [/\bsetattr\s*\(/, 'setattr() is not allowed'],

  // Dangerous attribute access (sandbox escape chains)
  [/__class__/, '__class__ attribute access is not allowed'],
  [/__bases__/, '__bases__ attribute access is not allowed'],
  [/__subclasses__/, '__subclasses__ attribute access is not allowed'],
  [/__mro__/, '__mro__ attribute access is not allowed'],
  [/__globals__/, '__globals__ attribute access is not allowed'],
  [/__builtins__/, '__builtins__ attribute access is not allowed'],
  [/__code__/, '__code__ attribute access is not allowed'],
  [/\bgetattr\s*\(/, 'getattr() is not allowed'],
  [/\bsetattr\s*\(/, 'setattr() is not allowed'],
  [/\bdelattr\s*\(/, 'delattr() is not allowed'],
  [/\bvars\s*\(/, 'vars() is not allowed'],
  [/\bdir\s*\(/, 'dir() is not allowed'],
  [/\bglobals\s*\(/, 'globals() is not allowed'],
  [/\blocals\s*\(/, 'locals() is not allowed'],

  // Blocked modules — the second defence (import hook in preamble is first)
  [/\bimport\s+os\b/, 'os module is not allowed'],
  [/\bimport\s+sys\b/, 'sys module is not allowed'],
  [/\bimport\s+subprocess\b/, 'subprocess module is not allowed'],
  [/\bimport\s+socket\b/, 'socket module is not allowed'],
  [/\bimport\s+shutil\b/, 'shutil module is not allowed'],
  [/\bimport\s+pathlib\b/, 'pathlib module is not allowed'],
  [/\bimport\s+ctypes\b/, 'ctypes module is not allowed'],
  [/\bimport\s+mmap\b/, 'mmap module is not allowed'],
  [/\bimport\s+signal\b/, 'signal module is not allowed'],
  [/\bimport\s+threading\b/, 'threading module is not allowed'],
  [/\bimport\s+multiprocessing\b/, 'multiprocessing module is not allowed'],
  [/\bimport\s+concurrent\b/, 'concurrent module is not allowed'],
  [/\bimport\s+asyncio\b/, 'asyncio module is not allowed'],
  [/\bimport\s+pickle\b/, 'pickle module is not allowed'],
  [/\bimport\s+marshal\b/, 'marshal module is not allowed'],
  [/\bimport\s+shelve\b/, 'shelve module is not allowed'],
  [/\bimport\s+importlib\b/, 'importlib module is not allowed'],
  [/\bimport\s+pkgutil\b/, 'pkgutil module is not allowed'],
  [/\bimport\s+builtins\b/, 'builtins module is not allowed'],
  [/\bimport\s+pty\b/, 'pty module is not allowed'],
  [/\bimport\s+resource\b/, 'resource module is not allowed'],
  [/\bfrom\s+os\b/, 'os module is not allowed'],
  [/\bfrom\s+sys\b/, 'sys module is not allowed'],
  [/\bfrom\s+subprocess\b/, 'subprocess module is not allowed'],
  [/\bfrom\s+pathlib\b/, 'pathlib module is not allowed'],
  [/\bfrom\s+ctypes\b/, 'ctypes module is not allowed'],
  [/\bfrom\s+importlib\b/, 'importlib module is not allowed'],
  [/\bfrom\s+builtins\b/, 'builtins module is not allowed'],
  [/\bfrom\s+pickle\b/, 'pickle module is not allowed'],
  [/\bfrom\s+multiprocessing\b/, 'multiprocessing module is not allowed'],
];

function validatePythonCode(code: string): void {
  if (typeof code !== 'string') {
    throw new Error('Code must be a string.');
  }
  if (code.trim().length === 0) {
    throw new Error('Code must not be empty.');
  }
  if (code.length > SANDBOX_CONFIG.maxCodeLength) {
    throw new Error(
      `Code exceeds the maximum allowed length of ${SANDBOX_CONFIG.maxCodeLength} characters.`,
    );
  }
  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(`Security violation — ${reason}.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PYTHON BINARY RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

let resolvedBinary: string | null = null;

async function resolvePythonBinary(): Promise<string> {
  if (resolvedBinary !== null) return resolvedBinary;

  const candidates = ['python3', 'python', 'py'];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version']);
      resolvedBinary = bin;
      return bin;
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    'No Python binary found on this system. ' +
      'Please install Python 3 and ensure it is in your PATH.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SECURITY PREAMBLE
//    Injected at the TOP of every temp file — runs before any user code.
//    This is OUR trusted code, not the AI's code.
// ─────────────────────────────────────────────────────────────────────────────

function buildPreamble(allowedModules: Set<string>): string {
  const allowedList = JSON.stringify([...allowedModules]);

  return `
import sys as _sys

# ── Recursion limit ──────────────────────────────────────────────
_sys.setrecursionlimit(${SANDBOX_CONFIG.recursionLimit})

# ── Setup Safe Import Hook ───────────────────────────────────────
if isinstance(__builtins__, dict):
    _builtins_dict = __builtins__
else:
    _builtins_dict = vars(__builtins__)

_original_import = _builtins_dict['__import__']
_ALLOWED = set(${allowedList})

def _safe_import(name, globals=None, locals=None, fromlist=(), level=0, _allowed=_ALLOWED, _real_import=_original_import):
    # Determine who is calling the import
    caller_name = globals.get('__name__') if globals else None

    # If the caller is '__main__', it's the user's code.
    # We apply the strict allowlist.
    if caller_name == '__main__':
        top_level = name.split('.')[0]
        # Allow if in allowlist or if it's a private sub-dependency
        if top_level not in _allowed and name not in _allowed and not top_level.startswith('_'):
            raise ImportError(f"Sandbox: import of '{name}' is not permitted.")

    # If caller_name is NOT '__main__', it's likely a library (like numpy)
    # importing its own dependencies. We allow these to pass.
    return _real_import(name, globals, locals, fromlist, level)

_builtins_dict['__import__'] = _safe_import

# ── Clean up ─────────────────────────────────────────────────────
# We keep 'exec', 'open', 'compile' because libraries need them to load.
# Static analysis (regex) prevents the user from calling them.
_REMOVE = ['breakpoint']
for _name in _REMOVE:
    _builtins_dict.pop(_name, None)

del _sys, _builtins_dict, _REMOVE, _name, _ALLOWED, _original_import

# ════════════════════════════════════════════════════════════════
# USER CODE STARTS BELOW
# ════════════════════════════════════════════════════════════════
`.trimStart();
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TEMP FILE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function writeTempCodeFile(code: string, runId: string): Promise<string> {
  const dir = join(tmpdir(), `py-sandbox-${runId}`);
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, 'code.py');
  const preamble = buildPreamble(SANDBOX_CONFIG.allowedModules);
  await writeFile(filePath, preamble + code, 'utf8');

  return filePath;
}

async function cleanupTempDir(runId: string): Promise<void> {
  const dir = join(tmpdir(), `py-sandbox-${runId}`);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort — don't let cleanup failure surface to the caller
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. PROCESS RUNNER WITH HARD TIMEOUT
// ─────────────────────────────────────────────────────────────────────────────

function truncate(str: string, maxBytes: number): string {
  if (str.length <= maxBytes) return str;
  return `${str.slice(0, maxBytes)}\n... [OUTPUT TRUNCATED]`;
}

function spawnWithTimeout(
  binary: string,
  codePath: string,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = execFile(binary, [codePath], {
      // Prevent shell injection — execFile never invokes a shell
      shell: false,
      // Cap the internal Node.js buffer as a secondary safeguard
      maxBuffer: SANDBOX_CONFIG.maxOutputBytes * 2,
      // Force UTF-8 decoding to handle Unicode/emoji in output (e.g. DDGS book results)
      encoding: 'utf8',
      // Force Python to use UTF-8 for stdout/stderr (fixes 'charmap' codec errors on Windows)
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        // Process may have already exited — safe to ignore
      }
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout: truncate(stdout, SANDBOX_CONFIG.maxOutputBytes),
        stderr: truncate(stderr, SANDBOX_CONFIG.maxOutputBytes),
        exitCode,
        timedOut,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: null,
        timedOut: false,
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a string of AI-generated Python code in a sandboxed subprocess.
 *
 * Security layers applied in order:
 *   1. Node.js-side static analysis (regex blocklist)
 *   2. Python-side preamble (builtin deletion + import allowlist hook)
 *   3. Hard timeout → SIGKILL
 *   4. Output truncation
 *   5. Ephemeral temp file deleted in finally
 */
export async function runPython(code: string): Promise<PythonRunResult> {
  const runId = randomUUID();
  const startTime = Date.now();
  let codePath: string | null = null;

  try {
    // ── Step 1: Static validation ──────────────────────────────
    validatePythonCode(code);

    // ── Step 2: Resolve Python binary ─────────────────────────
    const binary = await resolvePythonBinary();

    // ── Step 3: Write preamble + user code to temp file ───────
    codePath = await writeTempCodeFile(code, runId);

    // ── Step 4: Spawn with timeout ─────────────────────────────
    const raw = await spawnWithTimeout(
      binary,
      codePath,
      SANDBOX_CONFIG.timeoutMs,
    );
    const executionTimeMs = Date.now() - startTime;

    if (raw.timedOut) {
      return {
        success: false,
        stdout: raw.stdout,
        stderr: raw.stderr,
        runId,
        executionTimeMs,
        timedOut: true,
        error: `Execution timed out after ${SANDBOX_CONFIG.timeoutMs}ms.`,
      };
    }

    const success = raw.exitCode === 0;
    return {
      success,
      stdout: raw.stdout,
      stderr: raw.stderr,
      runId,
      executionTimeMs,
      timedOut: false,
      ...(success
        ? {}
        : { error: `Process exited with code ${raw.exitCode}.` }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      stdout: '',
      stderr: '',
      runId,
      executionTimeMs: Date.now() - startTime,
      timedOut: false,
      error: errorMessage,
    };
  } finally {
    // ── Always clean up — never skipped ───────────────────────
    await cleanupTempDir(runId);
  }
}

/**
 * Ensure a Python pip package is installed. Checks for the package first,
 * and runs `pip install --quiet` if it is not found.
 */
export async function ensurePackage(
  packageName: string,
  importName?: string,
): Promise<{ success: boolean; error?: string }> {
  const checkName = importName ?? packageName.replace(/-/g, '_');
  try {
    const binary = await resolvePythonBinary();
    await execFileAsync(binary, ['-c', `import ${checkName}`]);
    return { success: true };
  } catch {
    try {
      const binary = await resolvePythonBinary();
      await execFileAsync(binary, ['-m', 'pip', 'install', packageName, '--quiet'], {
        timeout: 120_000,
      });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to install ${packageName}: ${msg}` };
    }
  }
}

/**
 * Diagnostic tool — lets the AI check whether Python is installed
 * and which version is available before attempting to run code.
 */
export async function getPythonEnvironmentInfo(): Promise<PythonEnvironmentInfo> {
  try {
    const binary = await resolvePythonBinary();
    const { stdout } = await execFileAsync(binary, [
      '-c',
      'import sys; print(sys.version)',
    ]);
    return {
      available: true,
      binary,
      version: stdout.trim(),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      binary: null,
      version: null,
      error: errorMessage,
    };
  }
}
