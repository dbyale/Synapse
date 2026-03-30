import { listModels } from '@huggingface/hub';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { getModelsDirectory } from './settings';
import { BrowserWindow } from 'electron';

export interface ModelSearchResult {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  lastModified: string;
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

// Search HuggingFace
export async function searchModels(
  query: string,
  limit: number = 20
): Promise<ModelSearchResult[]> {
  const results: ModelSearchResult[] = [];

  try {
    const iterator = listModels({
      // Pro-tip: appending 'gguf' ensures we mostly get compatible models
      search: { query: query.includes('gguf') ? query : `${query} gguf` },
      limit,
    });

    for await (const model of iterator) {
      // THE FIX: In the HF JS library, 'name' is the repo path (Author/Model)
      // and 'id' is the internal hex ID. We need the repo path.
      const repoId = model.name;

      results.push({
        id: repoId, // Use the correct repoId here
        author: repoId.split('/')[0] ?? 'unknown',
        name: repoId.split('/')[1] ?? repoId,
        downloads: model.downloads ?? 0,
        likes: model.likes ?? 0,
        lastModified: model.updatedAt?.toString() ?? '',
      });

      if (results.length >= limit) break;
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
    const response = await fetch(
      `https://huggingface.co/api/models/${repoId}`
    );
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
export function downloadModel(
  repoId: string,
  filename: string,
  win: BrowserWindow | null
): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelsDir = getModelsDirectory();
    const destPath = path.join(modelsDir, filename);

    // Don't re-download if it already exists
    if (fs.existsSync(destPath)) {
      resolve(destPath);
      return;
    }

    const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;

    const file = fs.createWriteStream(destPath);

    const request = (downloadUrl: string) => {
      https
        .get(downloadUrl, (response) => {
          // Handle redirects
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            request(response.headers.location);
            return;
          }

          if (response.statusCode !== 200) {
            fs.unlinkSync(destPath);
            reject(new Error(`Download failed with status ${response.statusCode}`));
            return;
          }

          const totalBytes = parseInt(
            response.headers['content-length'] ?? '0',
            10
          );
          let downloadedBytes = 0;

          response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            file.write(chunk);

            // Send progress to renderer
            const progress: DownloadProgress = {
              modelId: repoId,
              filename,
              downloadedBytes,
              totalBytes,
              percent: totalBytes > 0
                ? Math.round((downloadedBytes / totalBytes) * 100)
                : 0,
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
        })
        .on('error', (err) => {
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

  return fs
    .readdirSync(modelsDir)
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
