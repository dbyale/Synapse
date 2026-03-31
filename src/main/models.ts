import path from 'path';
import fs from 'fs';
import https from 'https';
import { BrowserWindow } from 'electron';
import { getModelsDirectory } from './settings';

export interface ModelSearchResult {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  trendingScore: number;
  lastModified: string;
  pipelineTag: string;
  parameters: string | null;
  tags: string[];
}

export interface SearchFilter {
  id: string;
  label: string;
  type: 'library' | 'pipeline_tag' | 'tag' | 'author' | 'language';
}

export interface LocalModel {
  filename: string;
  filepath: string;
  sizeBytes: number;
  lastModified: string;
}

export interface DownloadProgress {
  modelId: string;
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

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

// ── Default filters applied to every search ──
const DEFAULT_FILTERS: SearchFilter[] = [
  { id: 'gguf', label: 'GGUF', type: 'library' },
];

// ── Search HuggingFace via REST API ──
export async function searchModels(
  query: string,
  limit: number = 20,
  filters: SearchFilter[] = DEFAULT_FILTERS
): Promise<ModelSearchResult[]> {
  const params = new URLSearchParams({
    search: query,
    limit: String(limit),
  });

  // Map filters to their corresponding API query parameters
  const tagFilters: string[] = [];

  for (const filter of filters) {
    switch (filter.type) {
      case 'library':
      case 'tag':
      case 'language':
        tagFilters.push(filter.id);
        break;
      case 'pipeline_tag':
        params.set('pipeline_tag', filter.id);
        break;
      case 'author':
        params.set('author', filter.id);
        break;
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

// ── List GGUF files for a specific HuggingFace repo ──
export async function listModelFiles(repoId: string): Promise<string[]> {
  try {
    const response = await fetch(`https://huggingface.co/api/models/${repoId}`);
    const data = await response.json();

    if (data.siblings) {
      return data.siblings
        .map((f: { rfilename: string }) => f.rfilename)
        .filter((name: string) => name.endsWith('.gguf'));
    }
  } catch (err) {
    console.error('Error listing model files:', err);
  }
  return [];
}

// ── Download a GGUF file ──
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
      https.get(downloadUrl, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          fs.unlinkSync(destPath);
          reject(new Error(`Download failed with status ${response.statusCode}`));
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
          resolve(destPath);
        });

        response.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    };

    request(url);
  });
}

// ── List locally downloaded models ──
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

// ── Delete a local model ──
export function deleteLocalModel(filename: string): boolean {
  const filepath = path.join(getModelsDirectory(), filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return true;
  }
  return false;
}
