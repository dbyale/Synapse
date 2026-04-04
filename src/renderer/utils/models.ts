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

const activeDownloads = new Map<string, { req: ClientRequest; destPath: string }>();

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

  if (filters && Symbol.iterator in Object(filters)) {
    for (const filter of filters) {
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
    }
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
        /(\d+(?:\.\d+)?[bBmM](?:-[A-Za-z]\d+[bBmM])?|\d+x\d+(?:\.\d+)?[bBmM])/
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
    const data = await response.json();

    const files: RemoteModelFile[] = [];

    for (const file of data) {
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
    }

    return files;
  } catch (err) {
    console.error('Error listing model files:', err);
  }
  return [];
}

export function downloadModel(repoId: string, filename: string, win: BrowserWindow | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelsDir = getModelsDirectory();
    const destPath = path.join(modelsDir, filename);

    if (fs.existsSync(destPath)) {
      resolve(destPath);
      return;
    }

    const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
    const file = fs.createWriteStream(destPath);

    const request = (downloadUrl: string) => {
      // Create a unified, safe cleanup function
      const cleanupAndReject = (err: Error) => {
        file.close(); // Important: Close the stream to release Windows file locks

        // Safely check if file exists before deleting to prevent ENOENT crashes
        if (fs.existsSync(destPath)) {
          try {
            fs.unlinkSync(destPath);
          } catch (e) {
            console.error('Failed to clean up incomplete download:', e);
          }
        }
        activeDownloads.delete(filename);
        reject(err);
      };

      const req = https.get(downloadUrl, (response) => {
        // Handle Redirects
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

        // Use safe cleanup for response errors
        response.on('error', cleanupAndReject);
      });

      // Use safe cleanup for request errors
      req.on('error', cleanupAndReject);

      // Save request to allow cancellation
      activeDownloads.set(filename, { req, destPath });
    };

    request(url);
  });
}

export function cancelDownload(filename: string): boolean {
  const record = activeDownloads.get(filename);
  if (record) {
    // Calling destroy() aborts the network request. This will automatically
    // trigger the 'error' event on the request above, which will safely handle
    // closing the stream, deleting the file, and removing the active download record.
    record.req.destroy();
    return true;
  }
  return false;
}

export function listLocalModels(): LocalModel[] {
  const modelsDir = getModelsDirectory();
  if (!fs.existsSync(modelsDir)) return [];

  return fs.readdirSync(modelsDir)
    .filter((f) => f.endsWith('.gguf'))
    .map((filename) => {
      const filepath = path.join(modelsDir, filename);
      const stats = fs.statSync(filepath);
      return {
        filename,
        filepath,
        sizeBytes: stats.size,
        lastModified: stats.mtime.toISOString(),
      };
    });
}

export function deleteLocalModel(filename: string): boolean {
  const filepath = path.join(getModelsDirectory(), filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return true;
  }
  return false;
}
