import { BrowserWindow } from 'electron';
import https from 'https';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
import * as yauzl from 'yauzl';
import type { ClientRequest } from 'http';
import { getModelsDirectory, loadSettings, saveSettings } from './settings';
import type {
  BackendDownload,
  BackendDownloadRecord,
  DownloadProgress,
  ParserDownloadRecord,
} from '../renderer/preload.d';

interface ActiveBinaryDownload {
  id: string;
  kind: 'backend' | 'parser';
  reqs: ClientRequest[];
  tempPath: string;
  cancelled: boolean;
}

interface LastStarted {
  kind: 'backend' | 'parser';
  download: BackendDownload;
  dir: string;
}

// Shared across all streams of one download (main binary + extra archives),
// so progress reflects the total transfer instead of just the first file.
interface AggregateProgress {
  downloadedBytes: number;
  totalBytes: number;
}

const activeDownloads = new Map<string, ActiveBinaryDownload>();
const lastStarted = new Map<string, LastStarted>();

function log(...args: unknown[]) {
  console.log('[binary:download]', ...args);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sendProgress(
  win: BrowserWindow | null,
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
    } as DownloadProgress);
  }
}

function recordDownload(kind: 'backend' | 'parser', download: BackendDownload) {
  const settings = loadSettings();
  if (kind === 'backend') {
    const existing = settings.backendDownloads ?? [];
    if (!existing.some((d) => d.folder === download.folder)) {
      const record: BackendDownloadRecord = {
        id: download.id,
        label: download.label,
        folder: download.folder,
      };
      settings.backendDownloads = [...existing, record];
    }
  } else {
    const record: ParserDownloadRecord = {
      id: download.id,
      label: download.label,
      file: download.folder,
    };
    settings.parserDownloads = record;
  }
  saveSettings(settings);
}

function resolveTargetDir(kind: 'backend' | 'parser', dir: string): string {
  const settings = loadSettings();
  if (kind === 'backend') {
    return dir || settings.backendDirectory;
  }
  return (
    dir ||
    settings.parserDirectory ||
    path.join(path.dirname(getModelsDirectory()), 'parser')
  );
}

// Streaming zip extraction (yauzl): entries are decompressed and written
// through async streams, so the main process event loop (and the UI) stays
// responsive while large archives are unpacked.
function extractZip(
  zipPath: string,
  destDir: string,
  filter: (entryName: string) => boolean,
  logLabel: string,
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
  kind: 'backend' | 'parser',
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
              sendProgress(win, download, {
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

        const active = activeDownloads.get(download.id);
        if (active) active.reqs.push(req);
      });

      req.on('error', reject);
    };

    request(url);
  });
}

export async function startBinaryDownload(
  kind: 'backend' | 'parser',
  download: BackendDownload,
  dir: string,
  win: BrowserWindow | null = null,
): Promise<string> {
  const targetDir = resolveTargetDir(kind, dir);
  const isZip = download.url.endsWith('.zip');
  const isTarGz = download.url.endsWith('.tar.gz');
  const rawFileName =
    kind === 'parser' ? download.folder : `download-${download.folder}`;
  const tempPath = path.join(targetDir, `.${rawFileName}.part`);
  const extras = (download.files ?? []).slice(1);
  const extraTempPaths = extras.map((extraFile) =>
    path.join(targetDir, `.${extraFile}.part`),
  );

  lastStarted.set(download.id, { kind, download, dir });

  fs.mkdirSync(targetDir, { recursive: true });

  const active: ActiveBinaryDownload = {
    id: download.id,
    kind,
    reqs: [],
    tempPath,
    cancelled: false,
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
      kind,
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
        kind,
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

    if (isZip || isTarGz) {
      const destDir = path.join(targetDir, download.folder);
      fs.mkdirSync(destDir, { recursive: true });
      if (isZip) {
        await extractZip(
          tempPath,
          destDir,
          (name) => name.includes('llama-server') || name.endsWith('.dll'),
          download.id,
        );
        fs.unlinkSync(tempPath);
        await Promise.all(
          extraTempPaths.map(async (extraTemp) => {
            await extractZip(
              extraTemp,
              destDir,
              (name) => name.endsWith('.dll'),
              download.id,
            );
            fs.unlinkSync(extraTemp);
          }),
        );
      } else {
        log(download.id, 'extracting tar.gz', tempPath, '->', destDir);
        await tar.x({
          file: tempPath,
          cwd: destDir,
          strip: 1,
          filter: (p: string) =>
            p.includes('llama-server') || p.endsWith('.dylib'),
        });
        fs.unlinkSync(tempPath);
      }
    } else {
      const destPath = path.join(targetDir, rawFileName);
      fs.renameSync(tempPath, destPath);
      if (process.platform !== 'win32') fs.chmodSync(destPath, '755');
    }

    recordDownload(kind, download);
    activeDownloads.delete(download.id);
    log(
      download.id,
      'completed ->',
      path.join(targetDir, isZip || isTarGz ? download.folder : rawFileName),
    );
    sendProgress(win, download, {
      downloadedBytes: aggregate.downloadedBytes,
      totalBytes: aggregate.totalBytes,
      percent: 100,
      status: 'completed',
    });

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
    } catch {
      // Best-effort temp cleanup
    }
    log(download.id, 'failed:', error instanceof Error ? error.message : error);
    sendProgress(win, download, {
      downloadedBytes: aggregate.downloadedBytes,
      totalBytes: aggregate.totalBytes,
      percent: 0,
      status: active.cancelled ? 'cancelled' : 'failed',
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

export function listBinaryDownloads(): {
  backends: BackendDownloadRecord[];
  parser: ParserDownloadRecord | null;
  customBackendPaths: string[];
  customParserPaths: string[];
} {
  const settings = loadSettings();
  return {
    backends: settings.backendDownloads ?? [],
    parser: settings.parserDownloads ?? null,
    customBackendPaths: settings.customBinaryPaths ?? [],
    customParserPaths: settings.parserCustomBinaryPaths ?? [],
  };
}
