import path from 'path';
import fs from 'fs';
import https from 'https';
import { BrowserWindow } from 'electron';
import { ClientRequest } from 'http';
import { getModelsDirectory } from '../../main/settings';
import { mergeGgufSplits, cancelMerge } from '../../main/ggufSplit';
import type {
  ModelSearchResult,
  SearchFilter,
  LocalModel,
  DownloadProgress,
  RemoteModelFile,
} from '../preload.d';

// ── Raw shape returned by HuggingFace REST API ──
interface HFApiModel {
  _id: string;
  id: string;
  likes: number;
  trendingScore: number;
  private: boolean;
  downloads: number;
  tags: string[];
  pipeline_tag?: string;
  library_name?: string;
  createdAt: string;
  modelId: string;
}

const DEFAULT_FILTERS: SearchFilter[] = [
  { id: 'gguf', label: 'GGUF', type: 'library' },
];

const activeDownloads = new Map<
  string,
  {
    req: ClientRequest;
    destPath: string;
    cancelled?: boolean;
    win: BrowserWindow | null;
    repoId: string;
  }
>();

const SPLIT_PART_RE = /^(.*?)-(\d{4,5})-of-(\d{4,5})\.gguf$/i;

export function isSplitPart(filename: string): boolean {
  return SPLIT_PART_RE.test(path.basename(filename));
}

function resolveModelTargetDir(repoId: string, filename: string): string {
  const modelsDir = getModelsDirectory();
  const isProjector = filename.toLowerCase().includes('mmproj');
  const repoParts = repoId.split('/');
  let targetDir = path.join(modelsDir, ...repoParts);
  if (isProjector) {
    targetDir = path.join(targetDir, 'projectors');
  }
  return targetDir;
}

function resolveMergePaths(repoId: string, filename: string): {
  targetDir: string;
  base: string;
  mergedFilename: string;
  mergedPath: string;
} {
  const targetDir = resolveModelTargetDir(repoId, filename);
  const basename = path.basename(filename);
  const partMatch = basename.match(SPLIT_PART_RE);
  const base = partMatch
    ? partMatch[1]
    : basename.replace(/\.gguf$/i, '');
  const mergedFilename = `${base}.gguf`;
  return { targetDir, base, mergedFilename, mergedPath: path.join(targetDir, mergedFilename) };
}

// ── Helper to recursively scan folders for .gguf files ──
function walkDir(dir: string, callback: (filepath: string) => void) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) {
      walkDir(filepath, callback);
    } else {
      callback(filepath);
    }
  });
}

export async function searchModels(
  query: string,
  filters: SearchFilter[] = [],
  sort: string = 'trendingScore',
  direction: number = -1,
  limit: number = 20,
): Promise<ModelSearchResult[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    sort,
    direction: String(direction),
  });

  // Only append search parameter if it's not empty
  if (query.trim()) {
    params.set('search', query.trim());
  }

  const tagFilters: string[] = [];

  // Default GGUF filter must be added manually if we default to []
  tagFilters.push('gguf');

  if (Array.isArray(filters)) {
    filters.forEach((filter) => {
      switch (filter.type) {
        case 'library':
        case 'tag':
        case 'language':
          if (filter.id !== 'gguf') tagFilters.push(filter.id);
          break;
        case 'pipeline_tag':
          params.set('pipeline_tag', filter.id);
          break;
        case 'author':
          params.set('author', filter.id);
          break;
      }
    });
  }

  if (tagFilters.length > 0) {
    params.set('filter', tagFilters.join(','));
  }

  const url = `https://huggingface.co/api/models?${params.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `HuggingFace API returned ${response.status}: ${response.statusText}`,
      );
    }

    const models: HFApiModel[] = await response.json();

    return models.map((model) => {
      const repoId = model.id;
      const [author = 'unknown', ...nameParts] = repoId.split('/');
      const name = nameParts.join('/') || repoId;

      let parameters: string | null = null;
      const paramMatch = repoId.match(
        /((?:[A-Za-z])?\d+(?:\.\d+)?[bBmM](?:-[A-Za-z]\d+(?:\.\d+)?[bBmM])?|\d+x\d+(?:\.\d+)?[bBmM])/,
      );
      if (paramMatch) {
        parameters = paramMatch[0].toUpperCase();
      }

      return {
        id: repoId,
        author,
        name,
        downloads: model.downloads ?? 0,
        likes: model.likes ?? 0,
        trendingScore: model.trendingScore ?? 0,
        lastModified: model.createdAt ?? new Date().toISOString(),
        pipelineTag: model.pipeline_tag ?? 'unknown',
        parameters,
        tags: model.tags ?? [],
      };
    });
  } catch (err) {
    console.error('HuggingFace search error:', err);
    throw err;
  }
}

// ── List GGUF files and parse file sizes + quantizations ──
export async function listModelFiles(
  repoId: string,
): Promise<RemoteModelFile[]> {
  try {
    const response = await fetch(
      `https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`,
    );
    if (!response.ok) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = await response.json();
    const files: RemoteModelFile[] = [];

    data.forEach((file) => {
      if (file.type === 'file' && file.path.endsWith('.gguf')) {
        const filename = file.path;
        const lowerName = filename.toLowerCase();

        let quant = 'GGUF';
        let bits = 0;

        // Catch Vision Projectors (mmproj) and extract their specific bit format
        if (lowerName.includes('mmproj')) {
          const pMatch = filename.match(/mmproj-([^.]+)\.gguf/i);
          quant = pMatch ? pMatch[1].toUpperCase() : 'MMPROJ';
          bits = -1; // Flag as projector so they sort to the bottom
        } else {
          // Extract standard quantizations like Q4_K_M, IQ3_M, FP16, BF16, Q8_0
          const qMatch = filename.match(/(?:q|iq|fp|bf)\d+(?:_[a-z0-9_]+)?/i);
          if (qMatch) {
            quant = qMatch[0].toUpperCase();
            const bitMatch = quant.match(/\d+/);
            if (bitMatch) bits = parseInt(bitMatch[0], 10);
          } else {
            const fallback = filename.match(/(?:-|\.)([^.]+)\.gguf$/i);
            if (fallback) quant = fallback[1].toUpperCase();
          }
        }

        files.push({
          filename,
          sizeBytes: file.size,
          quantization: quant,
          bits,
        });
      }
    });

    return files;
  } catch (err) {
    console.error('Error listing model files:', err);
  }
  return [];
}

export function registerLocalModel(payload: {
  name: string;
  author: string;
  modelPaths: string[];
  projectorPaths: string[];
}): { success: boolean; message?: string } {
  const modelsDir = getModelsDirectory();

  // Create a folder structure: author/modelName
  const authorFolder = payload.author.replace(/[^a-zA-Z0-9_-]/g, '_');
  const modelFolderName = payload.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const modelDir = path.join(modelsDir, authorFolder, modelFolderName);

  // Create the model directory if it doesn't exist
  if (!fs.existsSync(modelDir)) {
    try {
      fs.mkdirSync(modelDir, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw new Error(`Failed to create model directory: ${err.message}`);
      }
    }
  }

  // Copy model files
  for (const srcPath of payload.modelPaths) {
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Model file not found: ${srcPath}`);
    }

    const filename = path.basename(srcPath);
    const destPath = path.join(modelDir, filename);

    // Skip if already in the destination
    if (path.resolve(srcPath) !== path.resolve(destPath)) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err: any) {
        throw new Error(
          `Failed to copy model file ${filename}: ${err.message}`,
        );
      }
    }
  }

  // Copy projector files into a 'projectors' subfolder
  if (payload.projectorPaths.length > 0) {
    const projectorDir = path.join(modelDir, 'projectors');

    if (!fs.existsSync(projectorDir)) {
      try {
        fs.mkdirSync(projectorDir, { recursive: true });
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          throw new Error(
            `Failed to create projector directory: ${err.message}`,
          );
        }
      }
    }

    for (const srcPath of payload.projectorPaths) {
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Projector file not found: ${srcPath}`);
      }

      const filename = path.basename(srcPath);
      const destPath = path.join(projectorDir, filename);

      // Skip if already in the destination
      if (path.resolve(srcPath) !== path.resolve(destPath)) {
        try {
          fs.copyFileSync(srcPath, destPath);
        } catch (err: any) {
          throw new Error(
            `Failed to copy projector file ${filename}: ${err.message}`,
          );
        }
      }
    }
  }

  return { success: true };
}

export function downloadModel(
  repoId: string,
  filename: string,
  win: BrowserWindow | null,
  resume: boolean = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const targetDir = resolveModelTargetDir(repoId, filename);

    const destPath = path.join(targetDir, path.basename(filename));
    const partPath = destPath + '.part';
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          reject(err);
          return;
        }
      }
    }

    if (fs.existsSync(destPath)) {
      resolve(destPath);
      return;
    }

    let startByte = 0;
    if (resume) {
      if (fs.existsSync(partPath)) {
        startByte = fs.statSync(partPath).size;
      }
    } else {
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch (e) {
          console.error('Failed to delete old part file:', e);
        }
      }
    }

    const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
    let file = fs.createWriteStream(partPath, {
      flags: startByte > 0 ? 'a' : 'w',
    });

    const doRequest = (downloadUrl: string, byteOffset: number) => {
      const cleanupAndReject = (err: Error) => {
        file.close();

        const record = activeDownloads.get(repoId + ':' + filename);
        const wasCancelled = record?.cancelled;

        activeDownloads.delete(repoId + ':' + filename);

        if (wasCancelled) {
          resolve('CANCELLED');
        } else {
          win?.webContents.send('download-progress', {
            modelId: repoId,
            filename,
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 0,
            status: 'failed',
            error: err.message,
          } as DownloadProgress);

          reject(err);
        }
      };

      const options: https.RequestOptions = {};
      if (byteOffset > 0) {
        options.headers = { Range: `bytes=${byteOffset}-` };
      }

      const req = https.get(downloadUrl, options, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          doRequest(response.headers.location, byteOffset);
          return;
        }

        if (response.statusCode === 200 && byteOffset > 0) {
          file.close();
          try {
            fs.unlinkSync(partPath);
          } catch (e) {}
          file = fs.createWriteStream(partPath);
          byteOffset = 0;
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          cleanupAndReject(
            new Error(`Download failed with status ${response.statusCode}`),
          );
          return;
        }

        const contentLength = parseInt(
          response.headers['content-length'] ?? '0',
          10,
        );
        const totalBytes =
          byteOffset > 0 ? contentLength + byteOffset : contentLength;
        let downloadedBytes = byteOffset;

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          file.write(chunk);

          const progress: DownloadProgress = {
            modelId: repoId,
            filename,
            downloadedBytes,
            totalBytes,
            percent:
              totalBytes > 0
                ? Math.round((downloadedBytes / totalBytes) * 100)
                : 0,
          };

          win?.webContents.send('download-progress', progress);
        });

        response.on('end', () => {
          file.end(() => {
            try {
              fs.renameSync(partPath, destPath);
            } catch (e) {
              console.error('Failed to rename part file:', e);
            }
            activeDownloads.delete(repoId + ':' + filename);
            win?.webContents.send('download-progress', {
              modelId: repoId,
              filename,
              downloadedBytes,
              totalBytes,
              percent: 100,
              status: 'completed',
            } as DownloadProgress);
            resolve(destPath);
          });
        });

        response.on('error', cleanupAndReject);
      });

      req.on('error', cleanupAndReject);

      activeDownloads.set(repoId + ':' + filename, {
        req,
        destPath,
        win,
        repoId,
      });
    };

    doRequest(url, startByte);
  });
}

export function mergeSplitParts(
  repoId: string,
  filename: string,
  win: BrowserWindow | null,
): Promise<string> {
  const { targetDir, base, mergedFilename, mergedPath } = resolveMergePaths(
    repoId,
    filename,
  );
  const fail = (message: string): never => {
    win?.webContents.send('download-progress', {
      modelId: repoId,
      filename: mergedFilename,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      status: 'failed',
      merge: true,
      error: message,
    } as DownloadProgress);
    throw new Error(message);
  };

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(targetDir);
  } catch {
    fail(`Model directory not found: ${targetDir}`);
  }
  const parts = entries
    .filter((f) => {
      const m = f.match(SPLIT_PART_RE);
      return !!m && m[1] === base;
    })
    .sort((a, b) => a.localeCompare(b));

  if (parts.length === 0) {
    if (fs.existsSync(mergedPath)) return Promise.resolve(mergedPath);
    fail(`No split parts found for ${base} in ${targetDir}`);
  }
  const totalMatch = parts[0].match(SPLIT_PART_RE);
  const expectedTotal = totalMatch ? parseInt(totalMatch[3], 10) : parts.length;
  if (parts.length !== expectedTotal || !/-00001-of-/i.test(parts[0])) {
    fail(
      `Incomplete split model ${base}: found ${parts.length} of ${expectedTotal} parts`,
    );
  }

  const partPaths = parts.map((p) => path.join(targetDir, p));
  let totalBytes = 0;
  try {
    totalBytes = partPaths.reduce(
      (sum, p) => sum + fs.statSync(p).size,
      0,
    );
  } catch {
    fail(`Failed to read split part sizes for ${base}`);
  }

  try {
    const statfs = (
      fs as unknown as {
        statfsSync?: (p: string) => { bfree: number; bsize: number };
      }
    ).statfsSync;
    if (typeof statfs === 'function') {
      const { bfree, bsize } = statfs(targetDir);
      const freeBytes = bfree * bsize;
      if (freeBytes < totalBytes * 1.05) {
        fail(
          `Insufficient disk space to merge ${base}: need ~${(totalBytes / 1024 / 1024 / 1024).toFixed(1)} GB free`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Insufficient')) throw err;
  }

  win?.webContents.send('download-progress', {
    modelId: repoId,
    filename: mergedFilename,
    downloadedBytes: totalBytes,
    totalBytes,
    percent: 100,
    status: 'merging',
    merge: true,
  } as DownloadProgress);

  const firstPartPath = partPaths[0];
  return mergeGgufSplits(firstPartPath, mergedPath).then(
    () => {
      try {
        const mergedSize = fs.statSync(mergedPath).size;
        const maxPart = Math.max(
          ...partPaths.map((p) => fs.statSync(p).size),
        );
        if (mergedSize < maxPart || mergedSize < totalBytes * 0.9) {
          fail(`Merged file verification failed for ${mergedFilename}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Merged file'))
          throw err;
        fail(`Merged file not found: ${mergedFilename}`);
      }
      for (const p of partPaths) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          console.error('Failed to delete split part:', p, e);
        }
      }
      win?.webContents.send('download-progress', {
        modelId: repoId,
        filename: mergedFilename,
        downloadedBytes: totalBytes,
        totalBytes,
        percent: 100,
        status: 'completed',
        merge: true,
      } as DownloadProgress);
      return mergedPath;
    },
    (err: Error): string => {
      return fail(err.message || `Failed to merge ${base}`);
    },
  );
}

export async function downloadSplitModel(
  repoId: string,
  filenames: string[],
  win: BrowserWindow | null,
  resume: boolean = false,
): Promise<string> {
  if (filenames.length === 0) throw new Error('No files to download');
  if (filenames.length === 1 || !filenames.some((f) => isSplitPart(f))) {
    return downloadModel(repoId, filenames[0], win, resume);
  }
  const results = await Promise.all(
    filenames.map((f) => downloadModel(repoId, f, win, resume)),
  );
  if (results.includes('CANCELLED')) return 'CANCELLED';
  return mergeSplitParts(repoId, filenames[0], win);
}

export function cancelSplitMerge(repoId: string, filename: string): boolean {
  const { mergedPath } = resolveMergePaths(repoId, filename);
  return cancelMerge(mergedPath);
}

export function deletePartFile(repoId: string, filename: string): boolean {
  const targetDir = resolveModelTargetDir(repoId, filename);
  const partPath = path.join(targetDir, path.basename(filename) + '.part');
  if (fs.existsSync(partPath)) {
    try {
      fs.unlinkSync(partPath);
      return true;
    } catch (err) {
      console.error('Failed to delete part file:', err);
      return false;
    }
  }
  return false;
}

export function cleanupPartFiles(): void {
  const modelsDir = getModelsDirectory();
  if (!fs.existsSync(modelsDir)) return;
  function walkAndClean(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkAndClean(fullPath);
      } else if (fullPath.endsWith('.part')) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`[cleanup] Deleted part file: ${fullPath}`);
        } catch (err) {
          console.error(
            `[cleanup] Failed to delete part file: ${fullPath}`,
            err,
          );
        }
      }
    }
  }
  walkAndClean(modelsDir);
}

export function cancelDownload(repoId: string, filename: string): boolean {
  const record = activeDownloads.get(repoId + ':' + filename);
  if (record) {
    record.cancelled = true;

    record.win?.webContents.send('download-progress', {
      modelId: record.repoId,
      filename,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      status: 'cancelled',
    } as DownloadProgress);

    record.req.destroy();
    return true;
  }
  return false;
}

export function listLocalModels(): LocalModel[] {
  const modelsDir = getModelsDirectory();
  if (!fs.existsSync(modelsDir)) return [];

  // Temporarily defined as any[] to inject the extended fields required by the frontend
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models: any[] = [];

  // Use recursive search instead of flat readdirSync
  walkDir(modelsDir, (filepath) => {
    if (filepath.endsWith('.gguf')) {
      const stats = fs.statSync(filepath);
      const filename = path.basename(filepath);

      // Calculate author and model names based on parent folder structure
      const relativePath = path.relative(modelsDir, filepath);
      const pathParts = relativePath.split(path.sep);

      let author = 'Local';
      let modelName = 'Uncategorized';

      if (pathParts.length >= 3) {
        // e.g., author/modelName/filename.gguf or author/modelName/projectors/filename.gguf
        author = pathParts[0];
        modelName = pathParts[1];
      } else if (pathParts.length === 2) {
        // Just directly dropped into a folder (fallback)
        author = pathParts[0];
        modelName = pathParts[0];
      }

      // Recreate the repo ID equivalent for UI grouping
      const generalName =
        pathParts.length >= 3 ? `${author}/${modelName}` : modelName;

      // Extract details from the filename
      const lowerName = filename.toLowerCase();
      const isProjector = lowerName.includes('mmproj');
      let quant = 'Unknown';

      if (isProjector) {
        const pMatch = filename.match(/mmproj-([^.]+)\.gguf/i);
        quant = pMatch ? pMatch[1].toUpperCase() : 'MMPROJ';
      } else {
        const qMatch = filename.match(/(?:q|iq|fp|bf)\d+(?:_[a-z0-9_]+)?/i);
        if (qMatch) {
          quant = qMatch[0].toUpperCase();
        } else {
          const fallback = filename.match(/(?:-|\.)([^.]+)\.gguf$/i);
          if (fallback) quant = fallback[1].toUpperCase();
        }
      }

      models.push({
        filename,
        filepath,
        sizeBytes: stats.size,
        lastModified: stats.mtime.toISOString(),
        // Metadata required for ExtendedLocalModel by the LocalModelGroupCard
        generalName,
        quantization: quant,
        isProjector,
      });
    }
  });

  return models as LocalModel[];
}

export function deleteLocalModel(identifier: string): boolean {
  const modelsDir = getModelsDirectory();

  let foundPath: string | null = null;

  if (path.isAbsolute(identifier) && fs.existsSync(identifier)) {
    foundPath = identifier;
  } else {
    walkDir(modelsDir, (filepath) => {
      if (path.basename(filepath) === identifier) {
        foundPath = filepath;
      }
    });
  }

  if (foundPath) {
    // Delete the file
    fs.unlinkSync(foundPath);

    // Clean up empty parent directories
    let currentDir = path.dirname(foundPath);
    const normalizedModelsDir = path.normalize(modelsDir);

    // Keep going up the directory tree while we're inside modelsDir
    while (
      currentDir.startsWith(normalizedModelsDir) &&
      currentDir !== normalizedModelsDir
    ) {
      try {
        const contents = fs.readdirSync(currentDir);

        // If directory is empty, delete it and move up
        if (contents.length === 0) {
          fs.rmdirSync(currentDir);
          console.log(`Deleted empty directory: ${currentDir}`);
          currentDir = path.dirname(currentDir);
        } else {
          // Directory has files, stop cleanup
          break;
        }
      } catch (err) {
        console.error(`Error cleaning up directory ${currentDir}:`, err);
        break;
      }
    }

    return true;
  }

  return false;
}
