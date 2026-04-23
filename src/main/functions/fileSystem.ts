// npm install minimatch
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { existsSync } from 'fs';
import { minimatch } from 'minimatch';

let allowedDirectories: string[] = [];

export function setAllowedDirectories(dirs: string[]): void {
  allowedDirectories = dirs.map(d => path.resolve(d));
}

export function getAllowedDirectories(): string[] {
  return [...allowedDirectories];
}

function sanitizePath(raw: string): string {
  const sanitized = raw.replace(/[}{"';`]/g, '').trim();
  if (sanitized === '') {
    throw new Error('Invalid path: empty after sanitization');
  }
  return sanitized;
}

function normalizePath(inputPath: string): string {
  const placeholderMap: Record<string, string> = {
    'root': os.homedir(),
    '~': os.homedir(),
    '.': process.cwd(),
    'home': os.homedir(),
    'cwd': process.cwd(),
    'desktop': path.join(os.homedir(), 'Desktop'),
    'documents': path.join(os.homedir(), 'Documents'),
    'downloads': path.join(os.homedir(), 'Downloads'),
  };

  const lowerInput = inputPath.toLowerCase();
  if (placeholderMap[lowerInput]) {
    return placeholderMap[lowerInput];
  }

  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1));
  }

  return inputPath;
}

function validatePath(filePath: string): void {
  if (allowedDirectories.length === 0) return;
  const resolvedPath = path.resolve(filePath);
  for (const allowedDir of allowedDirectories) {
    if (resolvedPath.startsWith(path.resolve(allowedDir))) return;
  }
  throw new Error(`Path '${filePath}' is not within allowed directories`);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json',
    '.xml': 'application/xml', '.csv': 'text/csv',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function generateDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diffs: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] ?? '';
    const newLine = newLines[i] ?? '';
    if (oldLine !== newLine) {
      if (oldLine) diffs.push(`- ${oldLine}`);
      if (newLine) diffs.push(`+ ${newLine}`);
    }
  }
  return diffs.length > 0 ? diffs.join('\n') : '(no changes)';
}

async function walkDirectory(dir: string, pattern: string, excludePatterns: string[]): Promise<string[]> {
  const results: string[] = [];
  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(dir, fullPath);
      const isExcluded = excludePatterns.some(p => minimatch(relativePath, p));
      if (isExcluded) continue;
      if (entry.isDirectory()) await walk(fullPath);
      else if (minimatch(entry.name, pattern)) results.push(fullPath);
    }
  }
  await walk(dir);
  return results;
}

interface TreeNode { name: string; type: 'file' | 'directory'; size?: number; children?: TreeNode[]; }

async function buildDirectoryTree(dir: string, excludePatterns: string[]): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(dir, fullPath);
    const isExcluded = excludePatterns.some(p => minimatch(relativePath, p));
    if (isExcluded) continue;
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, type: 'directory', children: await buildDirectoryTree(fullPath, excludePatterns) });
    } else {
      const stat = await fs.stat(fullPath);
      nodes.push({ name: entry.name, type: 'file', size: stat.size });
    }
  }
  return nodes;
}

function formatPermissions(mode: number): string {
  return (mode & parseInt('777', 8)).toString(8).padStart(3, '0');
}

export async function readTextFile(params: { path: string; head?: number; tail?: number }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`File not found: ${p}`);
    const content = await fs.readFile(p, 'utf-8');
    let lines = content.split('\n');
    if (params.head !== undefined && params.head > 0) lines = lines.slice(0, params.head);
    if (params.tail !== undefined && params.tail > 0) lines = lines.slice(-params.tail);
    return lines.join('\n');
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function readMediaFile(params: { path: string }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`File not found: ${p}`);
    const data = await fs.readFile(p);
    const result = { mimeType: getMimeType(p), data: data.toString('base64') };
    return JSON.stringify(result);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function readMultipleFiles(params: { paths: string[] }): Promise<string> {
  try {
    const results: Array<{ path: string; content?: string; error?: string }> = [];
    for (const filePath of params.paths) {
      try {
        const p = normalizePath(sanitizePath(filePath));
        validatePath(p);
        const content = await fs.readFile(p, 'utf-8');
        results.push({ path: p, content });
      } catch (error) {
        results.push({ path: filePath, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return JSON.stringify(results);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function writeFile(params: { path: string; content: string }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    const dirPath = path.dirname(p);
    if (!existsSync(dirPath)) await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(p, params.content, 'utf-8');
    return `File written successfully: ${p}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function editFile(params: { path: string; edits: Array<{ oldText: string; newText: string }>; dryRun?: boolean }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`File not found: ${p}`);
    let content = await fs.readFile(p, 'utf-8');
    const originalContent = content;
    for (const edit of params.edits) {
      if (!content.includes(edit.oldText)) throw new Error(`Old text not found in file: ${edit.oldText}`);
      content = content.replace(edit.oldText, edit.newText);
    }
    const diff = generateDiff(originalContent, content);
    if (!params.dryRun) await fs.writeFile(p, content, 'utf-8');
    const result = { dryRun: params.dryRun ?? false, diff, message: params.dryRun ? 'DRY RUN: Changes not applied' : 'File edited successfully' };
    return JSON.stringify(result);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function createDirectory(params: { path: string }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    await fs.mkdir(p, { recursive: true });
    return `Directory created successfully: ${p}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function listDirectory(params: { path: string }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`Directory not found: ${p}`);
    const entries = await fs.readdir(p, { withFileTypes: true });
    const lines = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`);
    return lines.join('\n') || '(empty directory)';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function listDirectoryWithSizes(params: { path: string; sortBy?: string }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`Directory not found: ${p}`);
    const entries = await fs.readdir(p, { withFileTypes: true });
    const items = await Promise.all(entries.map(async e => {
      const stat = await fs.stat(path.join(p, e.name));
      return { name: e.name, type: e.isDirectory() ? 'DIR' : 'FILE', size: stat.size };
    }));
    if (params.sortBy === 'size') items.sort((a, b) => b.size - a.size);
    else if (params.sortBy === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
    return items.map(i => `${i.type.padEnd(4)} ${i.size.toString().padStart(10)} ${i.name}`).join('\n') || '(empty directory)';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function moveFile(params: { source: string; destination: string }): Promise<string> {
  try {
    const source = normalizePath(sanitizePath(params.source));
    const destination = normalizePath(sanitizePath(params.destination));
    validatePath(source);
    validatePath(destination);
    if (!existsSync(source)) throw new Error(`Source file not found: ${source}`);
    const destDir = path.dirname(destination);
    if (!existsSync(destDir)) await fs.mkdir(destDir, { recursive: true });
    await fs.rename(source, destination);
    return `File moved successfully from ${source} to ${destination}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function searchFiles(params: { path: string; pattern: string; excludePatterns?: string[] }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`Directory not found: ${p}`);
    const files = await walkDirectory(p, params.pattern, params.excludePatterns ?? []);
    return files.length > 0 ? files.join('\n') : `No files matching pattern "${params.pattern}" found`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function directoryTree(params: { path: string; excludePatterns?: string[] }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`Directory not found: ${p}`);
    const tree = await buildDirectoryTree(p, params.excludePatterns ?? []);
    function formatTree(nodes: TreeNode[], prefix = ''): string {
      return nodes.map((node, i) => {
        const isLast = i === nodes.length - 1;
        const line = `${prefix}${isLast ? '└── ' : '├── '}${node.name}${node.type === 'directory' ? '/' : ''}${node.size !== undefined ? ` (${node.size} bytes)` : ''}`;
        const childLines = node.children?.length ? formatTree(node.children, prefix + (isLast ? '    ' : '│   ')) : '';
        return childLines ? `${line}\n${childLines}` : line;
      }).join('\n');
    }
    return formatTree(tree) || '(empty directory)';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function getFileInfo(params: { path: string }): Promise<string> {
  try {
    const p = normalizePath(sanitizePath(params.path));
    validatePath(p);
    if (!existsSync(p)) throw new Error(`Path not found: ${p}`);
    const stat = await fs.stat(p);
    const result = {
      path: path.resolve(p),
      isFile: stat.isFile(), isDirectory: stat.isDirectory(),
      size: stat.size, permissions: formatPermissions(stat.mode),
      created: stat.birthtime.toISOString(), modified: stat.mtime.toISOString(), accessed: stat.atime.toISOString(),
    };
    return JSON.stringify(result);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function listAllowedDirectories(): Promise<string> {
  try {
    return allowedDirectories.length > 0 ? allowedDirectories.join('\n') : 'All directories allowed (no restrictions configured)';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
