import path from 'path';
import fs from 'fs';
import https from 'https';
import { BrowserWindow } from 'electron';
import { getModelsDirectory } from '../../main/settings';
import { ClientRequest } from 'http';
import type {
  ModelSearchResult,
  SearchFilter,
  LocalModel,
  DownloadProgress,
  RemoteModelFile
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
  limit: number = 20
): Promise<ModelSearchResult[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    sort: sort,
    direction: String(direction)
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
      throw new Error(`HuggingFace API returned ${response.status}: ${response.statusText}`);
    }

    const models: HFApiModel[] = await response.json();

    return models.map((model) => {
      const repoId = model.id;
      const [author = 'unknown', ...nameParts] = repoId.split('/');
      const name = nameParts.join('/') || repoId;

      let parameters: string | null = null;
      const paramMatch = repoId.match(
        /(\d+(?:\.\d+)?[bBmM](?:-[A-Za-z]\d+(?:\.\d+)?[bBmM])?|\d+x\d+(?:\.\d+)?[bBmM])/
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
export async function listModelFiles(repoId: string): Promise<RemoteModelFile[]> {
  try {
    const response = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`);
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
          bits
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
        throw new Error(`Failed to copy model file ${filename}: ${err.message}`);
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
          throw new Error(`Failed to create projector directory: ${err.message}`);
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
          throw new Error(`Failed to copy projector file ${filename}: ${err.message}`);
        }
      }
    }
  }

  return { success: true };
}


export function downloadModel(repoId: string, filename: string, win: BrowserWindow | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelsDir = getModelsDirectory();
    const isProjector = filename.toLowerCase().includes('mmproj');

    // Split repoId (e.g. "TheBloke/Llama-2") into nested folder paths
    const repoParts = repoId.split('/');
    let targetDir = path.join(modelsDir, ...repoParts);

    // Divert into a 'projectors' subfolder if applicable
    if (isProjector) {
      targetDir = path.join(targetDir, 'projectors');
    }

    // IMPORTANT: The HF `filename` can contain directories (e.g., "folder/model-001.gguf")
    // We must resolve the absolute directory for the actual file
    const destPath = path.join(targetDir, filename);
    const destDir = path.dirname(destPath);

    // Create the folders if they don't exist.
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

    const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
    const file = fs.createWriteStream(destPath);

    const request = (downloadUrl: string) => {
      const cleanupAndReject = (err: Error) => {
        file.close();

        if (fs.existsSync(destPath)) {
          try {
            fs.unlinkSync(destPath);
          } catch (e) {
            console.error('Failed to clean up incomplete download:', e);
          }
        }

        const record = activeDownloads.get(filename);
        const wasCancelled = record?.cancelled;

        activeDownloads.delete(filename);

        if (wasCancelled) {
          resolve('CANCELLED');
        } else {
          win?.webContents.send('download-progress', {
            modelId: repoId,
            filename,
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 0,
            status: 'failed'
          } as DownloadProgress);

          reject(err);
        }
      };

      const req = https.get(downloadUrl, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          cleanupAndReject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10);
        let downloadedBytes = 0;

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          file.write(chunk);

          const progress: DownloadProgress = {
            modelId: repoId,
            filename,
            downloadedBytes,
            totalBytes,
            percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
          };

          win?.webContents.send('download-progress', progress);
        });

        response.on('end', () => {
          file.end();
          activeDownloads.delete(filename);
          resolve(destPath);
        });

        response.on('error', cleanupAndReject);
      });

      req.on('error', cleanupAndReject);

      activeDownloads.set(filename, { req, destPath, win, repoId });
    };

    request(url);
  });
}

export function cancelDownload(filename: string): boolean {
  const record = activeDownloads.get(filename);
  if (record) {
    record.cancelled = true;

    record.win?.webContents.send('download-progress', {
      modelId: record.repoId,
      filename,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      status: 'cancelled'
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
      const generalName = pathParts.length >= 3 ? `${author}/${modelName}` : modelName;

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
        isProjector
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
    fs.unlinkSync(foundPath);

    let currentDir = path.dirname(foundPath);
    while (currentDir !== modelsDir && currentDir.length > modelsDir.length) {
      try {
        if (fs.readdirSync(currentDir).length === 0) {
          fs.rmdirSync(currentDir);
          currentDir = path.dirname(currentDir);
        } else {
          break;
        }
      } catch (err) {
        break;
      }
    }
    return true;
  }

  return false;
}
