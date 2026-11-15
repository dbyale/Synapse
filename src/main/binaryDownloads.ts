import { BrowserWindow } from 'electron';
import https from 'https';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import * as tar from 'tar';
import * as yauzl from 'yauzl';
import type { ClientRequest } from 'http';
import { loadSettings, saveSettings } from './settings';
import {
  getDefaultPythonDir,
  getManagedPythonBinary,
  getPythonDownload,
} from './pythonInfo';
import { listInstalledBackends } from './backendInventory';
import { invalidateBackendProbeCaches } from './estimator';
import {
  getLlamaVersion,
  getSynapseVersion,
  writeBackendMarker,
} from './backendVersions';
import type {
  BackendDownload,
  BackendDownloadRecord,
  BinaryKind,
  DownloadProgress,
} from '../renderer/preload.d';

interface ActiveBinaryDownload {
  id: string;
  kind: BinaryKind;
  folder: string;
  reqs: ClientRequest[];
  tempPath: string;
  /**
   * Every scratch path this run owns (partial archives + staging folder). The
   * startup sweep deletes leftovers, so it has to be able to tell a dead
   * transfer's files from a transfer that is running right now.
   */
  scratch: string[];
  cancelled: boolean;
  /**
   * Identifies one run of one install. A retried install reuses the same id and
   * label, so the download manager cannot tell "still the run I hid" from "a new
   * run the user started from the backend card" without this.
   */
  runId: number;
}

interface LastStarted {
  kind: BinaryKind;
  download: BackendDownload;
  dir: string;
}

// Shared across all streams of one download (main binary + extra archives),
// so progress reflects the total transfer instead of just the first file.
interface AggregateProgress {
  downloadedBytes: number;
  totalBytes: number;
}

// Unpacking runs after the transfer ends and, for the CUDA bundles, regularly
// takes longer than the download did. Without its own events the UI sits at
// "100%" for minutes, so the same channel carries an `extracting` stage: the
// reporter is shared by every archive of one install, which keeps the percent
// monotonic across the main bundle and the extra runtime archives.
interface UnpackProgress {
  /** Which install these bytes belong to (carried onto every event). */
  active: ActiveBinaryDownload;
  extractedBytes: number;
  totalBytes: number;
  lastSent: number;
}

// Tools kept from every llama.cpp release bundle: the server, the optimizer's
// llama-fit-params, and llama-gguf-split for sharded models. A bundle missing
// any of them is a broken backend, not a partial success.
const LLAMA_BUNDLE_BINS = [
  'llama-server',
  'llama-fit-params',
  'llama-gguf-split',
];

const keepLlamaEntry = (name: string) =>
  LLAMA_BUNDLE_BINS.some((bin) => name.includes(bin)) ||
  name.endsWith('.dll') ||
  name.endsWith('.dylib');

// Which installs are llama.cpp bundles. The Python runtime is a full-archive
// install with no llama-server in it, so applying the bundle invariant to it
// would fail a runtime that extracted perfectly. (Exported for tests.)
export function requiresLlamaBundle(
  kind: BinaryKind,
  download: Pick<BackendDownload, 'extractAll'>,
): boolean {
  return kind === 'backend' && !download.extractAll;
}

const activeDownloads = new Map<string, ActiveBinaryDownload>();
const lastStarted = new Map<string, LastStarted>();

function log(...args: unknown[]) {
  console.log('[binary:download]', ...args);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// An install, reinstall or uninstall replaced (or removed) the binaries every
// probe measurement was taken with — including at the SAME path, which is what
// a reinstall does. Owned here rather than in the IPC layer so no install path
// can complete without it: backends are also installed through the model
// download handlers, which route binary ids back into startBinaryDownload.
function backendsChanged(): void {
  invalidateBackendProbeCaches();
  try {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('backends:changed');
    });
  } catch (error) {
    // The files are already in their new state; a window that cannot be told
    // about it re-reads the inventory the next time it asks.
    log(
      'backends:changed broadcast failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

function sendProgress(
  win: BrowserWindow | null,
  active: ActiveBinaryDownload,
  download: BackendDownload,
  progress: Partial<DownloadProgress>,
) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('download-progress', {
      modelId: download.id,
      filename: download.label,
      downloadedBytes: progress.downloadedBytes ?? 0,
      totalBytes: progress.totalBytes ?? 0,
      percent: progress.percent ?? 0,
      status: progress.status,
      // Marks the row as a binary install in the download manager; see
      // DownloadProgress.binary. Terminal events are sent after the download
      // leaves activeDownloads, so the install is passed in rather than looked
      // up.
      binary: active.kind,
      runId: active.runId,
      error: progress.error,
    } as DownloadProgress);
  }
}

// Extraction events are capped at 99%: the install is only done once the caller
// has verified the bundle, and a row that reads 100% while still unpacking
// would look finished to both the download manager and the backend card.
function sendUnpackProgress(
  win: BrowserWindow | null,
  download: BackendDownload,
  unpack: UnpackProgress,
  force = false,
) {
  const now = Date.now();
  if (!force && now - unpack.lastSent < 250) return;
  unpack.lastSent = now;
  sendProgress(win, unpack.active, download, {
    downloadedBytes: unpack.extractedBytes,
    totalBytes: unpack.totalBytes,
    percent:
      unpack.totalBytes > 0
        ? Math.min(
            99,
            Math.round((unpack.extractedBytes / unpack.totalBytes) * 100),
          )
        : 0,
    status: 'extracting',
  });
}

function recordDownload(
  kind: BinaryKind,
  download: BackendDownload,
  targetDir?: string,
) {
  const settings = loadSettings();
  if (kind === 'backend') {
    const installedAt = new Date().toISOString();
    const version = getLlamaVersion();
    const existing = settings.backendDownloads ?? [];
    // Upsert, not "skip when the folder is already known": a reinstall against
    // a new pin has to move the recorded version, otherwise the backend keeps
    // claiming to be the build it was first downloaded as.
    const others = existing.filter((d) => d.folder !== download.folder);
    settings.backendDownloads = [
      ...others,
      {
        id: download.id,
        label: download.label,
        folder: download.folder,
        version,
        installedAt,
      },
    ];
    // The settings record can be lost (reset, corrupt, a different machine);
    // the marker inside the folder is what makes an install self-describing.
    if (targetDir && download.folder) {
      writeBackendMarker(path.join(targetDir, download.folder), {
        id: download.id,
        label: download.label,
        llamaVersion: version,
        synapseVersion: getSynapseVersion(),
        installedAt,
        target: download.folder,
        assets: download.files,
      });
    }
  } else if (kind === 'python') {
    settings.pythonInstall = {
      id: download.id,
      label: download.label,
      folder: download.folder,
    };
    if (targetDir && !settings.pythonDirectory) {
      settings.pythonDirectory = targetDir;
    }
  }
  saveSettings(settings);
}

function resolveTargetDir(kind: BinaryKind, dir: string): string {
  const settings = loadSettings();
  if (kind === 'python') {
    return dir || settings.pythonDirectory || getDefaultPythonDir();
  }
  return dir || settings.backendDirectory;
}

// Streaming SHA-256 verification for pinned archives. Rejects with a clear
// error so the caller can surface a `failed` progress event.
function verifySha256(filePath: string, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => {
      const actual = hash.digest('hex');
      if (actual !== expected.toLowerCase()) {
        reject(
          new Error(
            `Checksum mismatch for ${path.basename(filePath)} ` +
              `(expected ${expected}, got ${actual})`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

// Central-directory pass: adds up the uncompressed size of the entries an
// extraction is going to write, which is what makes a real unpack percentage
// possible. Entries are never opened here, so yauzl advances through the
// central directory without decompressing anything — milliseconds even for a
// multi-gigabyte bundle. Resolves to 0 (= indeterminate progress) when the
// sizes cannot be trusted: a failure, or kept entries whose sizes the archive
// never recorded (a streamed zip defers them to data descriptors). Sizing the
// bar must never fail an install, and a bar that sits at 0% then jumps is worse
// than no bar at all. (Exported for the extraction-progress tests.)
export function zipPayloadBytes(
  zipPath: string,
  filter: (entryName: string) => boolean,
): Promise<number> {
  return new Promise((resolve) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: true },
      (openErr, zipfile) => {
        if (openErr || !zipfile) {
          log('size', zipPath, 'unknown:', openErr?.message ?? 'not readable');
          resolve(0);
          return;
        }
        let total = 0;
        let kept = 0;
        zipfile.on('entry', (entry: yauzl.Entry) => {
          if (!entry.fileName.endsWith('/') && filter(entry.fileName)) {
            total += entry.uncompressedSize;
            kept += 1;
          }
          zipfile.readEntry();
        });
        zipfile.on('end', () => {
          if (kept > 0 && total === 0) {
            log(
              'size',
              zipPath,
              'unknown: no entry carries an uncompressed size',
            );
            resolve(0);
            return;
          }
          resolve(total);
        });
        zipfile.on('error', (err: Error) => {
          log('size', zipPath, 'unknown:', err.message);
          resolve(0);
        });
        zipfile.readEntry();
      },
    );
  });
}

// Streaming zip extraction (yauzl): entries are decompressed and written
// through async streams, so the main process event loop (and the UI) stays
// responsive while large archives are unpacked. `onBytes` reports each chunk
// written, which is what feeds the unpack progress bar. (Exported for the
// extraction-progress tests.)
export function extractZip(
  zipPath: string,
  destDir: string,
  filter: (entryName: string) => boolean,
  logLabel: string,
  onBytes?: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (openErr, zipfile) => {
        if (openErr || !zipfile) {
          reject(openErr ?? new Error(`Failed to open ${zipPath}`));
          return;
        }

        log(logLabel, 'extracting', zipPath, '->', destDir);

        const fail = (err: Error) => {
          zipfile.close();
          reject(err);
        };

        zipfile.on('entry', (entry: yauzl.Entry) => {
          if (entry.fileName.endsWith('/') || !filter(entry.fileName)) {
            zipfile.readEntry();
            return;
          }
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) {
              fail(streamErr);
              return;
            }
            const outPath = path.join(destDir, path.basename(entry.fileName));
            const outStream = fs.createWriteStream(outPath);
            if (onBytes) {
              // Per chunk, not per entry: a CUDA bundle has individual DLLs far
              // too large for the bar to only move when one finishes. The
              // stream only starts flowing on the next tick, so pipe() has its
              // own listener attached in time and each chunk is counted once.
              readStream.on('data', (chunk: Buffer) => onBytes(chunk.length));
            }
            readStream.pipe(outStream);
            outStream.on('finish', () => {
              log(logLabel, 'extracted', entry.fileName, '->', outPath);
              zipfile.readEntry();
            });
            readStream.on('error', fail);
            outStream.on('error', fail);
          });
        });

        zipfile.on('end', () => {
          zipfile.close();
          resolve();
        });

        zipfile.on('error', fail);

        zipfile.readEntry();
      },
    );
  });
}

function downloadToFile(
  url: string,
  tempPath: string,
  active: ActiveBinaryDownload,
  download: BackendDownload,
  win: BrowserWindow | null,
  aggregate: AggregateProgress,
  reportProgress: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (requestUrl: string) => {
      const req = https.get(requestUrl, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          log(download.id, 'redirect ->', response.headers.location);
          response.resume();
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(`Download failed with status ${response.statusCode}`),
          );
          return;
        }

        const totalBytes = parseInt(
          response.headers['content-length'] ?? '0',
          10,
        );
        aggregate.totalBytes += totalBytes;
        log(
          download.id,
          'GET',
          url,
          '->',
          totalBytes > 0 ? formatBytes(totalBytes) : '(size unknown)',
        );

        let lastSent = 0;
        let lastLoggedDecile = -1;
        const file = fs.createWriteStream(tempPath);

        response.on('data', (chunk: Buffer) => {
          aggregate.downloadedBytes += chunk.length;
          if (!file.write(chunk)) {
            response.pause();
            file.once('drain', () => response.resume());
          }
          if (reportProgress) {
            const percent =
              aggregate.totalBytes > 0
                ? Math.round(
                    (aggregate.downloadedBytes / aggregate.totalBytes) * 100,
                  )
                : 0;
            const now = Date.now();
            if (now - lastSent >= 250) {
              lastSent = now;
              sendProgress(win, active, download, {
                downloadedBytes: aggregate.downloadedBytes,
                totalBytes: aggregate.totalBytes,
                percent,
              });
            }
            const decile = Math.floor(percent / 10);
            if (decile > lastLoggedDecile) {
              lastLoggedDecile = decile;
              log(
                download.id,
                'progress',
                `${percent}%`,
                `(${formatBytes(aggregate.downloadedBytes)} / ${formatBytes(aggregate.totalBytes)})`,
              );
            }
          }
        });

        response.on('end', () => {
          file.end(() => resolve());
        });

        response.on('error', (err) => {
          file.destroy();
          reject(err);
        });

        file.on('error', reject);

        active.reqs.push(req);
      });

      req.on('error', reject);
    };

    request(url);
  });
}

// Windows reports a busy folder (a running llama-server keeps its own exe open)
// as one of these codes; every other code is a real, reportable failure.
function isBusyError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return (
    code === 'EBUSY' ||
    code === 'EPERM' ||
    code === 'ENOTEMPTY' ||
    code === 'ETXTBSY'
  );
}

// Scratch written next to a backend install by an interrupted transfer or swap:
// the staging folder, the previous build held aside by commitStagedBackend, and
// partial archives. All of them are dot-prefixed so the inventory ignores them,
// but a killed process leaves them behind and a CUDA bundle's staging folder is
// hundreds of MB that never comes back on its own.
//
// `.install-old` is not simply garbage: if the live folder is missing, it is the
// only copy of the user's working backend, so it is restored rather than
// deleted — the same recovery commitStagedBackend does, just earlier.
// (Exported for the scratch-sweep tests.)
export function sweepBackendScratch(targetDir: string): string[] {
  const removed: string[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(targetDir);
  } catch {
    return removed;
  }

  const inFlight = new Set<string>();
  activeDownloads.forEach((active) => {
    inFlight.add(active.tempPath);
    active.scratch.forEach((p) => inFlight.add(p));
  });

  entries.forEach((name) => {
    if (!name.startsWith('.') || name.includes('..') || name.includes(path.sep))
      return;
    const full = path.join(targetDir, name);
    if (inFlight.has(full)) return;

    const isTemp = name.endsWith('.install-tmp');
    const isOld = name.endsWith('.install-old');
    const isPart = name.endsWith('.part');
    if (!isTemp && !isOld && !isPart) return;

    try {
      if (isOld) {
        const live = path.join(
          targetDir,
          name.slice(1, -'.install-old'.length),
        );
        if (!fs.existsSync(live)) {
          log('sweep', 'restoring', full, '->', live);
          fs.renameSync(full, live);
          return;
        }
      }
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } catch (error) {
      // Leftover scratch is never worth failing an install or an uninstall over;
      // the next pass tries again.
      log(
        'sweep',
        'could not remove',
        full,
        error instanceof Error ? error.message : error,
      );
    }
  });

  if (removed.length > 0)
    log('sweep', `removed ${removed.length} scratch path(s)`);
  return removed;
}

// Swaps a verified staging folder into place. The previous build is moved aside
// rather than deleted up front, so a swap that cannot happen (a running backend
// keeps its folder busy) leaves the working install exactly where it was.
// (Exported for the install-swap tests.)
export function commitStagedBackend(
  targetDir: string,
  folder: string,
  stageDir: string,
): void {
  const liveDir = path.join(targetDir, folder);
  const backupDir = path.join(targetDir, `.${folder}.install-old`);

  // A previous swap that died between the two renames left the old build in the
  // backup and nothing live: restore it before anything else touches either.
  if (fs.existsSync(backupDir)) {
    if (!fs.existsSync(liveDir)) {
      log('install', folder, 'restoring', backupDir, '->', liveDir);
      fs.renameSync(backupDir, liveDir);
    } else {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(liveDir)) {
    fs.renameSync(stageDir, liveDir);
    return;
  }

  try {
    fs.renameSync(liveDir, backupDir);
  } catch (error) {
    throw new Error(
      isBusyError(error)
        ? `${folder} is in use — stop the running model and try again.`
        : `Could not move the existing ${folder} aside: ${
            error instanceof Error ? error.message : error
          }`,
    );
  }

  try {
    fs.renameSync(stageDir, liveDir);
  } catch (error) {
    // Better an old backend than no backend.
    try {
      fs.renameSync(backupDir, liveDir);
    } catch {
      log('install', folder, 'previous build left at', backupDir);
    }
    throw new Error(
      isBusyError(error)
        ? `${folder} is in use — stop the running model and try again.`
        : `Could not install the new ${folder}: ${
            error instanceof Error ? error.message : error
          }`,
    );
  }

  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    // The new build is live; the old one is dead weight in a dot-prefixed
    // folder the inventory ignores, and the next install clears it.
    log(
      'install',
      folder,
      'could not remove',
      backupDir,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function startBinaryDownload(
  kind: BinaryKind,
  download: BackendDownload,
  dir: string,
  win: BrowserWindow | null = null,
): Promise<string> {
  const targetDir = resolveTargetDir(kind, dir);
  const isZip = download.url.endsWith('.zip');
  const isTarGz = download.url.endsWith('.tar.gz');
  const rawFileName = `download-${download.folder}`;
  const tempPath = path.join(targetDir, `.${rawFileName}.part`);
  const extras = (download.files ?? []).slice(1);
  const extraTempPaths = extras.map((extraFile) =>
    path.join(targetDir, `.${extraFile}.part`),
  );

  // A backend is unpacked into a staging folder and swapped in only once the
  // bundle verifies. Extracting straight into the live folder both leaves the
  // previous build's DLLs behind (llama.cpp loads whatever sits in the folder)
  // and, since an update has to clear the old build first, destroys a working
  // backend when the download then fails. Dot-prefixed so the backend inventory
  // never treats it as an install.
  const stageDir =
    kind === 'backend' && (isZip || isTarGz)
      ? path.join(targetDir, `.${download.folder}.install-tmp`)
      : '';

  lastStarted.set(download.id, { kind, download, dir });

  fs.mkdirSync(targetDir, { recursive: true });
  if (kind === 'backend') {
    // Starting an install is also the natural moment to reclaim scratch from a
    // previous run that ended badly — before its files could collide with ours.
    sweepBackendScratch(targetDir);
  }

  const active: ActiveBinaryDownload = {
    id: download.id,
    kind,
    folder: download.folder,
    reqs: [],
    tempPath,
    scratch: [...extraTempPaths, ...(stageDir ? [stageDir] : [])],
    cancelled: false,
    runId: Date.now(),
  };
  activeDownloads.set(download.id, active);

  log(
    'start',
    kind,
    download.id,
    `(${download.label})`,
    '->',
    targetDir,
    extras.length > 0
      ? `+ ${extras.length} extra archive(s): ${extras.join(', ')}`
      : '',
  );

  const aggregate: AggregateProgress = { downloadedBytes: 0, totalBytes: 0 };

  try {
    // Extra archives (e.g. the CUDA runtime DLLs) download in parallel with
    // the main binary from the same release.
    const mainDownload = downloadToFile(
      download.url,
      tempPath,
      active,
      download,
      win,
      aggregate,
      true,
    );
    const extraDownloads = extras.map((extraFile, index) => {
      const extraUrl = download.url.replace(
        path.basename(download.url),
        extraFile,
      );
      return downloadToFile(
        extraUrl,
        extraTempPaths[index],
        active,
        download,
        win,
        aggregate,
        false,
      );
    });
    await Promise.all([mainDownload, ...extraDownloads]);

    log(
      download.id,
      'downloads finished',
      `(${formatBytes(aggregate.downloadedBytes)} / ${formatBytes(aggregate.totalBytes)})`,
    );

    if (active.cancelled) {
      throw new Error('Download cancelled');
    }

    // Pinned downloads (e.g. Python) carry a checksum; verify before we
    // touch the filesystem so a corrupt transfer never gets extracted.
    if (download.sha256) {
      log(download.id, 'verifying sha256…');
      await verifySha256(tempPath, download.sha256);
    }

    if (isZip || isTarGz) {
      const destDir = stageDir || path.join(targetDir, download.folder);
      fs.mkdirSync(destDir, { recursive: true });

      // Unpack progress covers every archive of this install, sized up front
      // where the format allows it. A .tar.gz payload size is only known after
      // decompressing, so that path counts bytes without a percentage.
      const unpack: UnpackProgress = {
        active,
        extractedBytes: 0,
        totalBytes: 0,
        lastSent: 0,
      };
      const trackBytes = (bytes: number) => {
        unpack.extractedBytes += bytes;
        sendUnpackProgress(win, download, unpack);
      };
      const keepDll = (name: string) => name.endsWith('.dll');
      // Counted at entry headers, so it runs slightly ahead of the writes;
      // close enough to be useful where no total exists to divide by.
      const countTarEntry = (entry: { size?: number }) =>
        trackBytes(entry.size ?? 0);

      if (download.extractAll) {
        // Full-archive installs (Python): every entry is needed, and the
        // install_only archive wraps everything in a top-level `python/`
        // folder which `strip: 1` removes.
        if (isTarGz) {
          log(download.id, 'extracting full tar.gz', tempPath, '->', destDir);
          sendUnpackProgress(win, download, unpack, true);
          await tar.x({
            file: tempPath,
            cwd: destDir,
            strip: 1,
            onentry: countTarEntry,
          });
          fs.unlinkSync(tempPath);
        } else {
          unpack.totalBytes = await zipPayloadBytes(tempPath, () => true);
          sendUnpackProgress(win, download, unpack, true);
          await extractZip(
            tempPath,
            destDir,
            () => true,
            download.id,
            trackBytes,
          );
          fs.unlinkSync(tempPath);
        }
        if (process.platform !== 'win32') {
          const py = path.join(destDir, 'bin', 'python3');
          if (fs.existsSync(py)) fs.chmodSync(py, 0o755);
        }
      } else if (isZip) {
        // Main bundle first, then the runtime archives — one shared reporter
        // keeps the percentage moving across all of them instead of restarting.
        const extraSizes = await Promise.all(
          extraTempPaths.map((extraTemp) =>
            zipPayloadBytes(extraTemp, keepDll),
          ),
        );
        unpack.totalBytes =
          (await zipPayloadBytes(tempPath, keepLlamaEntry)) +
          extraSizes.reduce((sum, size) => sum + size, 0);
        log(
          download.id,
          'unpacking',
          `${formatBytes(unpack.totalBytes)} of payload`,
        );
        sendUnpackProgress(win, download, unpack, true);

        await extractZip(
          tempPath,
          destDir,
          keepLlamaEntry,
          download.id,
          trackBytes,
        );
        fs.unlinkSync(tempPath);
        await Promise.all(
          extraTempPaths.map(async (extraTemp) => {
            await extractZip(
              extraTemp,
              destDir,
              keepDll,
              download.id,
              trackBytes,
            );
            fs.unlinkSync(extraTemp);
          }),
        );
      } else {
        log(download.id, 'extracting tar.gz', tempPath, '->', destDir);
        sendUnpackProgress(win, download, unpack, true);
        await tar.x({
          file: tempPath,
          cwd: destDir,
          strip: 1,
          filter: (p: string) => keepLlamaEntry(p),
          onentry: countTarEntry,
        });
        fs.unlinkSync(tempPath);
      }

      // A llama backend folder missing one of the three tools is not usable
      // (the optimizer needs llama-fit-params), and a partial extraction
      // would otherwise only surface at server start. Same invariant as
      // .erb/scripts/setup-binaries.ts. Full-archive installs (the Python
      // runtime) are not llama.cpp bundles and are checked by their checksum.
      if (requiresLlamaBundle(kind, download)) {
        const exe = isZip ? '.exe' : '';
        const missing = LLAMA_BUNDLE_BINS.filter(
          (bin) => !fs.existsSync(path.join(destDir, `${bin}${exe}`)),
        );
        if (missing.length > 0) {
          throw new Error(
            `${rawFileName} did not provide ${missing.join(
              ', ',
            )} — the llama.cpp bundle layout changed, or the asset is not a full backend build`,
          );
        }
      }

      // Verified: the staged folder becomes the backend folder. Until this line
      // the previous install was untouched, so every failure above leaves a
      // working backend in place.
      if (stageDir) {
        commitStagedBackend(targetDir, download.folder, stageDir);
      }
    } else {
      const destPath = path.join(targetDir, rawFileName);
      fs.renameSync(tempPath, destPath);
      if (process.platform !== 'win32') fs.chmodSync(destPath, '755');
    }

    recordDownload(kind, download, targetDir);
    activeDownloads.delete(download.id);
    log(
      download.id,
      'completed ->',
      path.join(targetDir, isZip || isTarGz ? download.folder : rawFileName),
    );
    sendProgress(win, active, download, {
      downloadedBytes: aggregate.downloadedBytes,
      totalBytes: aggregate.totalBytes,
      percent: 100,
      status: 'completed',
    });
    if (kind === 'backend') backendsChanged();

    return path.join(
      targetDir,
      isZip || isTarGz ? download.folder : rawFileName,
    );
  } catch (error) {
    activeDownloads.delete(download.id);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      extraTempPaths.forEach((p) => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      // Nothing half-installed is ever left where the inventory would find it:
      // the staging folder is discarded and the live folder was never touched.
      if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup
    }
    log(download.id, 'failed:', error instanceof Error ? error.message : error);
    let failureMessage: string | undefined;
    if (!active.cancelled) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }
    sendProgress(win, active, download, {
      downloadedBytes: aggregate.downloadedBytes,
      totalBytes: aggregate.totalBytes,
      percent: 0,
      status: active.cancelled ? 'cancelled' : 'failed',
      error: failureMessage,
    });
    throw error;
  }
}

export function cancelBinaryDownload(id: string): boolean {
  const active = activeDownloads.get(id);
  if (!active) return false;
  active.cancelled = true;
  active.reqs.forEach((req) => req.destroy());
  log('cancel', id, `(${active.reqs.length} active request(s) aborted)`);
  return true;
}

export function findBinaryById(id: string): LastStarted | null {
  return lastStarted.get(id) ?? null;
}

// Removes an installed binary folder by name. Deliberately keyed on the folder
// rather than on a download descriptor: a leftover install has no descriptor,
// and a stale record may not match any target this build offers — those are
// exactly the cases that have to be removable.
export function uninstallInstalledBackend(
  folder: string,
  dir?: string,
): { success: boolean; error?: string } {
  const targetDir = resolveTargetDir('backend', dir ?? '');

  if (
    !folder ||
    folder.includes('..') ||
    folder.includes('/') ||
    folder.includes('\\')
  ) {
    return { success: false, error: 'Invalid folder name' };
  }

  const active = [...activeDownloads.values()].find(
    (entry) => entry.folder === folder,
  );
  if (active) {
    return {
      success: false,
      error: 'Cannot uninstall while download is in progress',
    };
  }

  const targetPath = path.resolve(path.join(targetDir, folder));
  if (!targetPath.startsWith(path.resolve(targetDir))) {
    return { success: false, error: 'Invalid target path' };
  }

  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      log('uninstall', 'backend', folder, `removed ${targetPath}`);
    } else {
      log('uninstall', 'backend', folder, `nothing to remove at ${targetPath}`);
    }
    // Removing an install is also when its scratch goes: an interrupted install
    // of the folder being cleared leaves a staging folder behind, and the user
    // just asked for this directory to be clean.
    sweepBackendScratch(targetDir);
  } catch (e: any) {
    log('uninstall', 'backend', folder, 'failed:', e?.message ?? e);
    return {
      success: false,
      error: isBusyError(e)
        ? `${folder} is in use — stop the running model and try again.`
        : (e?.message ?? 'Failed to remove files'),
    };
  }

  try {
    const settings = loadSettings();
    const before = settings.backendDownloads ?? [];
    const remaining = before.filter(
      (d) => d.folder !== folder && d.id !== folder,
    );
    const removed = before.filter(
      (d) => d.folder === folder || d.id === folder,
    );
    settings.backendDownloads = remaining;

    // Uninstalling the backend a profile is pinned to would otherwise leave
    // selectedBackend pointing at a deleted folder and every launch falling
    // back through resolveBackend's heuristics.
    const selected = settings.selectedBackend;
    const selectionLost =
      selected &&
      selected !== 'Default' &&
      (selected === folder ||
        removed.some((d) => d.id === selected || d.folder === selected)) &&
      !(settings.customBinaryPaths ?? []).includes(selected);
    if (selectionLost) settings.selectedBackend = 'Default';

    saveSettings(settings);
  } catch (e: any) {
    log(
      'uninstall',
      'backend',
      folder,
      'settings update failed:',
      e?.message ?? e,
    );
    return { success: false, error: 'Failed to update settings' };
  }

  [...lastStarted.entries()].forEach(([id, entry]) => {
    if (entry.download.folder === folder) lastStarted.delete(id);
  });
  backendsChanged();
  return { success: true };
}

export function uninstallBinary(
  kind: BinaryKind,
  download: BackendDownload,
  dir: string,
): { success: boolean; error?: string } {
  if (kind === 'backend') {
    return uninstallInstalledBackend(download.folder, dir);
  }

  const targetDir = resolveTargetDir(kind, dir);

  // Cannot uninstall while actively downloading
  if (activeDownloads.has(download.id)) {
    return {
      success: false,
      error: 'Cannot uninstall while download is in progress',
    };
  }

  const { folder } = download;
  if (
    !folder ||
    folder.includes('..') ||
    folder.includes('/') ||
    folder.includes('\\')
  ) {
    return { success: false, error: 'Invalid folder name' };
  }

  // Safety: ensure targetPath is inside targetDir
  const normalizedTarget = path.resolve(path.join(targetDir, folder));
  const normalizedDir = path.resolve(targetDir);
  if (!normalizedTarget.startsWith(normalizedDir)) {
    return { success: false, error: 'Invalid target path' };
  }

  try {
    if (fs.existsSync(normalizedTarget)) {
      fs.rmSync(normalizedTarget, { recursive: true, force: true });
      log('uninstall', kind, download.id, `removed ${normalizedTarget}`);
    } else {
      log(
        'uninstall',
        kind,
        download.id,
        `nothing to remove at ${normalizedTarget}`,
      );
    }
  } catch (e: any) {
    log('uninstall', kind, download.id, 'failed:', e?.message ?? e);
    return { success: false, error: e?.message ?? 'Failed to remove files' };
  }

  // Update settings persistence
  try {
    const settings = loadSettings();
    if (settings.pythonInstall?.folder === folder) {
      delete settings.pythonInstall;
    }
    saveSettings(settings);
  } catch (e: any) {
    log(
      'uninstall',
      kind,
      download.id,
      'settings update failed:',
      e?.message ?? e,
    );
    return { success: false, error: 'Failed to update settings' };
  }

  lastStarted.delete(download.id);
  return { success: true };
}

export function listBinaryDownloads(): {
  backends: BackendDownloadRecord[];
  customBackendPaths: string[];
  python: BackendDownloadRecord | null;
} {
  // The scan is the answer, not the cached records: a folder that outlived
  // settings is still installed (and uninstallable), and a record whose folder
  // is gone is not. Writing that back is getInstalledBackends' job, at the
  // moments something actually changed on disk — this path runs on every read.
  const inventory = listInstalledBackends();
  const settings = loadSettings();
  // Heal a missing install record when the managed runtime is present on disk
  // (e.g. settings were reset or the runtime was restored from a backup).
  if (!settings.pythonInstall) {
    const recommended = getPythonDownload();
    if (recommended && getManagedPythonBinary(settings)) {
      settings.pythonInstall = {
        id: recommended.id,
        label: recommended.label,
        folder: recommended.folder,
      };
      saveSettings(settings, true);
    }
  }
  return {
    backends: inventory.backends
      .filter((backend) => backend.exists && backend.hasServer)
      .map((backend) => ({
        id: backend.id,
        label: backend.label,
        folder: backend.folder,
        version: backend.llamaVersion ?? undefined,
        installedAt: backend.installedAt,
      })),
    customBackendPaths: settings.customBinaryPaths ?? [],
    python: settings.pythonInstall ?? null,
  };
}
