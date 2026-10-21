/* eslint-disable import/prefer-default-export */
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { loadSettings } from './settings';
import type { AppSettings } from './settings';
import type {
  BackendDownload,
  PythonInfo,
  PythonRuntime,
} from '../renderer/preload.d';

const execFileAsync = promisify(execFile);

// Pinned python-build-standalone release + CPython version. Both are fixed so
// installs are reproducible; the archive checksums below belong to this exact
// release (release `20261013`, CPython 3.15.0).
export const PYTHON_RELEASE = '20261013';
export const PYTHON_VERSION = '3.15.0';
// Folder the install_only archive is extracted into under the install dir.
// The runtime root is therefore <pythonDirectory>/python.
export const PYTHON_FOLDER = 'python';

const PYTHON_BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}`;

interface PythonAsset {
  triple: string;
  sha256: string;
}

// Keyed by `${process.platform}-${process.arch}`.
const PYTHON_ASSETS: Record<string, PythonAsset> = {
  'win32-x64': {
    triple: 'x86_64-pc-windows-msvc',
    sha256: '0d9950ba8c6399203e60ed6a2452fc4e8def35c83fb6da00ec815784b7887483',
  },
  'win32-arm64': {
    triple: 'aarch64-pc-windows-msvc',
    sha256: '588a4d0817d74fd632c235868a8218f63baee4ce40126ebe16b5e1826a1b86ba',
  },
  'darwin-x64': {
    triple: 'x86_64-apple-darwin',
    sha256: 'c4adbda246262a55920ec0804f5a6a9a3a1e5948f3423da71926320b2489e50e',
  },
  'darwin-arm64': {
    triple: 'aarch64-apple-darwin',
    sha256: 'f5d1d82e2f5660d4decae5d2b7470631850bcd7bd39595d9c3cca3c5ee54eae7',
  },
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    sha256: 'e02a368dd5dc76ffe0599e5109ad6c1ee84e597910758b0e006bab25372a8921',
  },
  'linux-arm64': {
    triple: 'aarch64-unknown-linux-gnu',
    sha256: '26a54e8fbde81bcc39ba35ad855a6a573295c023793c20fff1670a560649bcd7',
  },
};

function getPythonAsset(): PythonAsset | null {
  return PYTHON_ASSETS[`${process.platform}-${process.arch}`] ?? null;
}

/** Download descriptor for the pinned standalone CPython build, or null when
 * the current platform/arch has no prebuilt asset. */
export function getPythonDownload(): BackendDownload | null {
  const asset = getPythonAsset();
  if (!asset) return null;
  const archive = `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${asset.triple}-install_only.tar.gz`;
  return {
    id: 'python',
    label: `Python ${PYTHON_VERSION}`,
    sublabel:
      'Standalone CPython runtime with pip — installed and managed by Synapse',
    icon: 'python',
    url: `${PYTHON_BASE}/${archive}`,
    folder: PYTHON_FOLDER,
    files: [archive],
    recommended: true,
    sha256: asset.sha256,
    extractAll: true,
  };
}

export function getDefaultPythonDir(): string {
  return path.join(app.getPath('userData'), 'python');
}

/** Directory downloads land in. The runtime root sits at <dir>/python. */
export function resolvePythonDir(settings: AppSettings): string {
  return settings.pythonDirectory || getDefaultPythonDir();
}

/** Absolute path to the managed interpreter, or null when not installed. */
export function getManagedPythonBinary(settings: AppSettings): string | null {
  const root = path.join(resolvePythonDir(settings), PYTHON_FOLDER);
  const binary =
    process.platform === 'win32'
      ? path.join(root, 'python.exe')
      : path.join(root, 'bin', 'python3');
  return fs.existsSync(binary) ? binary : null;
}

/** Prefer the app-managed interpreter; returns null when unavailable. */
export async function resolveManagedPythonBinary(
  settings: AppSettings,
): Promise<string | null> {
  const binary = getManagedPythonBinary(settings);
  if (!binary) return null;
  try {
    await execFileAsync(binary, ['--version']);
    return binary;
  } catch {
    return null;
  }
}

async function probeVersion(binary: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--version']);
    const out = `${stdout} ${stderr}`.trim();
    const match =
      out.match(/Python\s+([\d.]+)/i) ?? out.match(/([\d]+\.[\d]+\.[\d]+)/);
    return match ? match[1] : out || null;
  } catch {
    return null;
  }
}

async function firstWorkingPython(
  candidates: string[],
): Promise<string | null> {
  const [head, ...rest] = candidates;
  if (!head) return null;
  const version = await probeVersion(head);
  if (version) return head;
  return firstWorkingPython(rest);
}

async function resolveSystemPython(): Promise<string | null> {
  const candidates =
    process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python'];
  return firstWorkingPython(candidates);
}

export async function getPythonInfo(): Promise<PythonInfo> {
  const recommended = getPythonDownload();
  const settings = loadSettings();

  const systemBinary = await resolveSystemPython();
  const system: PythonRuntime = systemBinary
    ? {
        available: true,
        binary: systemBinary,
        version: await probeVersion(systemBinary),
        source: 'system',
      }
    : { available: false, binary: null, version: null, source: null };

  const managedBinary = getManagedPythonBinary(settings);
  const managed: PythonRuntime = managedBinary
    ? {
        available: true,
        binary: managedBinary,
        version: await probeVersion(managedBinary),
        source: 'managed',
      }
    : { available: false, binary: null, version: null, source: null };

  const warnings: string[] = [];
  if (!recommended) {
    warnings.push(
      `Automatic Python installation isn't available for ${process.platform}/${process.arch}. ` +
        `Install Python ${PYTHON_VERSION} manually and make sure it is on your PATH.`,
    );
  }

  return {
    platform: process.platform,
    arch: process.arch,
    supported: !!recommended,
    defaultInstallDir: getDefaultPythonDir(),
    system,
    managed,
    recommended,
    warnings,
  };
}
