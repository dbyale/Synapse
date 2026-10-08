import { app } from 'electron';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import util from 'util';
import { graphics } from 'systeminformation';
import { getModelsDirectory } from './settings';
import type { AppSettings } from './settings';

const execAsync = util.promisify(exec);

async function getNvidiaDriverVersion(): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
      { timeout: 5000 },
    );
    const v = stdout.trim().split('\n')[0]?.trim();
    if (v) {
      const major = parseInt(v.split('.')[0], 10);
      if (!Number.isNaN(major)) return major;
    }
  } catch {
    // nvidia-smi unavailable — fall through to systeminformation
  }

  try {
    const gpu = await graphics();
    const ctrl = gpu.controllers.find(
      (c) => c.vendor.toLowerCase().includes('nvidia') && c.driverVersion,
    );
    if (ctrl?.driverVersion) {
      const parts = ctrl.driverVersion.split('.');
      if (parts.length === 4) {
        const last = parseInt(parts[3], 10);
        if (!Number.isNaN(last)) return Math.floor(last / 100);
      } else {
        const major = parseInt(parts[0], 10);
        if (!Number.isNaN(major)) return major;
      }
    }
  } catch {
    // graphics enumeration unavailable — no driver info
  }

  return null;
}

export function getAssetPath(...paths: string[]): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');
  return path.join(base, ...paths);
}

export async function detectBackend(): Promise<string> {
  const { platform, arch } = process;

  if (platform === 'darwin') return `macos-${arch}`;

  if (platform === 'linux') {
    return arch === 'arm64' ? 'ubuntu-vulkan-arm64' : 'ubuntu-vulkan-x64';
  }

  if (platform === 'win32') {
    if (arch === 'arm64') return 'win-adreno-arm64';

    try {
      const gpu = await graphics();
      const isNvidia = gpu.controllers.some((c) =>
        c.vendor.toLowerCase().includes('nvidia'),
      );

      if (isNvidia) {
        const driverMajor = await getNvidiaDriverVersion();
        if (driverMajor !== null && driverMajor >= 610) {
          return 'win-cuda-13.4-x64';
        }
        return 'win-cuda-12.4-x64';
      }

      return 'win-vulkan-x64';
    } catch {
      return 'win-vulkan-x64';
    }
  }

  return 'win-cpu-x64';
}

export function getServerBinName(): string {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

export function getFitParamsBinName(): string {
  return process.platform === 'win32'
    ? 'llama-fit-params.exe'
    : 'llama-fit-params';
}

function getBackendDir(settings: AppSettings): string {
  return (
    settings.backendDirectory ||
    path.join(path.dirname(getModelsDirectory()), 'llama')
  );
}

// Resolves which llama-server binary to launch. Explicit selection wins, then
// the "Default" backend (first recommended download, preferring CUDA, then
// OpenCL/Adreno, then Vulkan), then the first download, then bundled assets.
export async function resolveBackend(
  settings: AppSettings,
): Promise<{ backendFolder: string; serverPath: string }> {
  const serverBin = getServerBinName();
  const downloads = settings.backendDownloads ?? [];
  const backendDir = getBackendDir(settings);
  const customPaths = settings.customBinaryPaths ?? [];
  const pathFor = (folder: string) => path.join(backendDir, folder, serverBin);

  const selected = settings.selectedBackend;
  if (selected && selected !== 'Default') {
    if (customPaths.includes(selected) && fs.existsSync(selected)) {
      return { backendFolder: selected, serverPath: selected };
    }
    const match = downloads.find((d) => d.folder === selected);
    if (match && fs.existsSync(pathFor(match.folder))) {
      return { backendFolder: match.folder, serverPath: pathFor(match.folder) };
    }
  }

  const patterns = [/cuda/i, /opencl|adreno/i, /vulkan/i];
  const hit = patterns
    .map((pattern) =>
      downloads.find(
        (d) => pattern.test(d.folder) && fs.existsSync(pathFor(d.folder)),
      ),
    )
    .find(Boolean);
  if (hit) {
    return { backendFolder: hit.folder, serverPath: pathFor(hit.folder) };
  }

  const first = downloads.find((d) => fs.existsSync(pathFor(d.folder)));
  if (first)
    return { backendFolder: first.folder, serverPath: pathFor(first.folder) };

  const folder = await detectBackend();
  return {
    backendFolder: folder,
    serverPath: getAssetPath('bin', folder, serverBin),
  };
}

// Resolves the llama-fit-params estimator binary from the SAME backend folder
// as the server, so estimate-time placement matches launch-time placement
// (Vulkan vs CUDA vs CPU build + version parity). Mirrors resolveBackend's
// selection order; a custom path pointing directly at a server executable
// resolves to the fit binary sitting next to it.
export async function resolveFitBinary(
  settings: AppSettings,
): Promise<{ backendFolder: string; fitParamsPath: string }> {
  const fitBin = getFitParamsBinName();
  const downloads = settings.backendDownloads ?? [];
  const backendDir = getBackendDir(settings);
  const customPaths = settings.customBinaryPaths ?? [];
  const fitPathFor = (folder: string) => path.join(backendDir, folder, fitBin);

  const selected = settings.selectedBackend;
  if (selected && selected !== 'Default') {
    if (customPaths.includes(selected) && fs.existsSync(selected)) {
      // Custom selection may point at the server exe itself; the fit binary
      // lives next to it. If it points at a fit binary directly, use it.
      const base = path.basename(selected).toLowerCase();
      if (base.includes('fit-params')) {
        return { backendFolder: selected, fitParamsPath: selected };
      }
      const sibling = path.join(path.dirname(selected), fitBin);
      if (fs.existsSync(sibling)) {
        return { backendFolder: selected, fitParamsPath: sibling };
      }
      // Fall through to the standard search when the sibling is absent.
    } else {
      const match = downloads.find((d) => d.folder === selected);
      if (match && fs.existsSync(fitPathFor(match.folder))) {
        return {
          backendFolder: match.folder,
          fitParamsPath: fitPathFor(match.folder),
        };
      }
    }
  }

  const patterns = [/cuda/i, /opencl|adreno/i, /vulkan/i];
  const hit = patterns
    .map((pattern) =>
      downloads.find(
        (d) => pattern.test(d.folder) && fs.existsSync(fitPathFor(d.folder)),
      ),
    )
    .find(Boolean);
  if (hit) {
    return { backendFolder: hit.folder, fitParamsPath: fitPathFor(hit.folder) };
  }

  const firstFit = downloads.find((d) => fs.existsSync(fitPathFor(d.folder)));
  if (firstFit) {
    return {
      backendFolder: firstFit.folder,
      fitParamsPath: fitPathFor(firstFit.folder),
    };
  }

  // A backend folder may predate fit-params shipping (only server present).
  // Fall back to the server's own folder so at least the build matches;
  // the caller surfaces a clear error when the file is still absent.
  const { backendFolder, serverPath } = await resolveBackend(settings);
  if (customPaths.includes(backendFolder) && fs.existsSync(backendFolder)) {
    return {
      backendFolder,
      fitParamsPath: path.join(path.dirname(serverPath), fitBin),
    };
  }
  return {
    backendFolder,
    fitParamsPath: path.join(backendDir, backendFolder, fitBin),
  };
}
