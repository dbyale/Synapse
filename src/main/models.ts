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
  lastModified: string;
  pipelineTag: string;
  parameters: string | null;
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

// ── Search HuggingFace ──
export async function searchModels(
  query: string,
  limit: number = 20
): Promise<ModelSearchResult[]> {
  const results: ModelSearchResult[] = [];

  try {
    const { listModels } = await import('@huggingface/hub');

    // Clean, standard SDK call. No hacks required!
    const iterator = listModels({
      search: { query: query.includes('gguf') ? query : `${query} gguf` },
      limit,
    });

    while (results.length < limit) {
      const { value: model, done } = await iterator.next();

      if (done) break;
      if (!model) continue;

      const repoId = model.name;
      const pipelineTag = model.task || 'none';

      // Extract parameters (7B, 13B, 8x7B) directly from the repo name using regex
      let parameters: string | null = null;
      const paramMatch = repoId.match(/(\d+(?:\.\d+)?[bBmM]|\d+x\d+(?:\.\d+)?[bBmM])/);
      if (paramMatch) {
        parameters = paramMatch[0].toUpperCase();
      }

      results.push({
        id: repoId,
        author: repoId.split('/')[0] ?? 'unknown',
        name: repoId.split('/')[1] ?? repoId,
        downloads: model.downloads ?? 0,
        likes: model.likes ?? 0,
        lastModified: model.updatedAt?.toString() ?? new Date().toISOString(),
        pipelineTag,
        parameters,
      });
    }
  } catch (err) {
    console.error('HuggingFace search error:', err);
    throw err;
  }

  return results;
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
