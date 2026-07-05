import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, parse } from 'path';
import { app } from 'electron';

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') {
    return { frontmatter: {}, body: content };
  }
  const endIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (endIndex === -1) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  for (let i = 1; i < endIndex; i++) {
    const match = lines[i].match(/^([^:]+):\s*(.*)$/);
    if (match) frontmatter[match[1].trim()] = match[2].trim();
  }
  const body = lines.slice(endIndex + 1).join('\n').trim();
  return { frontmatter, body };
}

function buildMarkdown(opts: {
  title: string;
  body: string;
  type?: string;
  tags?: string[];
  created: string;
  modified: string;
}): string {
  const lines = ['---'];
  lines.push(`title: ${opts.title}`);
  if (opts.type) lines.push(`type: ${opts.type}`);
  if (opts.tags && opts.tags.length > 0) lines.push(`tags: ${opts.tags.join(', ')}`);
  lines.push(`created: ${opts.created}`);
  lines.push(`modified: ${opts.modified}`);
  lines.push('---');
  lines.push('');
  lines.push(opts.body);
  return lines.join('\n');
}

function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) links.push(match[1].trim());
  return [...new Set(links)];
}

function sanitizeFilename(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '.md';
}

function createSnippet(body: string, query?: string, maxLen = 150): string {
  if (!body) return '';
  if (!query) return body.length > maxLen ? body.slice(0, maxLen) + '...' : body;
  const q = query.toLowerCase();
  const idx = body.toLowerCase().indexOf(q);
  if (idx === -1) return body.length > maxLen ? body.slice(0, maxLen) + '...' : body;
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + q.length + 60);
  let snippet = '';
  if (start > 0) snippet += '...';
  snippet += body.slice(start, end);
  if (end < body.length) snippet += '...';
  return snippet;
}

// ──────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────

export interface MemoryMeta {
  title: string;
  type: string;
  tags: string[];
  created: string;
  modified: string;
}

export interface MemoryItem extends MemoryMeta {
  snippet: string;
  related_memories: string[];
}

// ──────────────────────────────────────────────
// Memory Manager
// ──────────────────────────────────────────────

export class MemoryManager {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(app.getPath('userData'), 'memories');
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) await mkdir(this.baseDir, { recursive: true });
  }

  private async readFileMeta(filePath: string) {
    const content = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);
    const title = frontmatter['title'] || parse(filePath).name;
    return {
      title,
      type: frontmatter['type'] || '',
      tags: parseTags(frontmatter['tags'] || ''),
      created: frontmatter['created'] || '',
      modified: frontmatter['modified'] || '',
      content: body,
    };
  }

  async saveMemory(
    title: string,
    content: string,
    type?: string,
    tags?: string[],
  ): Promise<{ success: boolean; title: string; file: string; created?: string; error?: string }> {
    try {
      if (!title || !title.trim()) return { success: false, title: '', file: '', error: 'Title is required.' };
      if (content === undefined || content === null) return { success: false, title, file: '', error: 'Content is required.' };
      await this.ensureDir();
      const filename = sanitizeFilename(title.trim());
      const filePath = join(this.baseDir, filename);
      const now = new Date().toISOString();
      let created = now;
      let finalType = type;
      let finalTags = tags;

      if (existsSync(filePath)) {
        try {
          const existing = await this.readFileMeta(filePath);
          created = existing.created || now;
          if (!finalType) finalType = existing.type;
          if (!finalTags || finalTags.length === 0) finalTags = existing.tags;
        } catch {
          // ignore
        }
      }

      const markdown = buildMarkdown({ title: title.trim(), body: content, type: finalType, tags: finalTags, created, modified: now });
      await writeFile(filePath, markdown, 'utf-8');
      return { success: true, title: title.trim(), file: filename, created };
    } catch (error) {
      return { success: false, title, file: '', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async readMemory(
    title: string,
  ): Promise<{
    success: boolean;
    title?: string;
    type?: string;
    tags?: string[];
    content?: string;
    related_memories?: string[];
    created?: string;
    modified?: string;
    error?: string;
  }> {
    try {
      if (!title || !title.trim()) return { success: false, error: 'Title is required.' };
      await this.ensureDir();
      const filename = sanitizeFilename(title.trim());
      const filePath = join(this.baseDir, filename);
      if (!existsSync(filePath)) return { success: false, error: `Memory "${title.trim()}" not found. Use list_memories or search_memories to find available memories.` };

      const { title: memTitle, type, tags, created, modified, content } = await this.readFileMeta(filePath);
      return { success: true, title: memTitle, type, tags, content, related_memories: extractWikiLinks(content), created, modified };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchMemories(
    query?: string,
    type?: string,
    tag?: string,
  ): Promise<{
    success: boolean;
    results: MemoryItem[];
    total: number;
    error?: string;
  }> {
    try {
      await this.ensureDir();
      if (!existsSync(this.baseDir)) return { success: true, results: [], total: 0 };
      const files = await readdir(this.baseDir);
      const results: MemoryItem[] = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const { title, type: fileType, tags, created, modified, content } = await this.readFileMeta(join(this.baseDir, file));
          const q = (query || '').toLowerCase();
          const matchesQuery = !query || title.toLowerCase().includes(q) || fileType.toLowerCase().includes(q) || content.toLowerCase().includes(q) || tags.some((t) => t.toLowerCase().includes(q));
          const matchesType = !type || fileType === type;
          const matchesTag = !tag || tags.includes(tag);
          if (matchesQuery && matchesType && matchesTag) {
            results.push({ title, type: fileType, tags, snippet: createSnippet(content, query), related_memories: extractWikiLinks(content), created, modified });
          }
        } catch {
          // skip unparseable
        }
      }

      return { success: true, results, total: results.length };
    } catch (error) {
      return { success: false, results: [], total: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteMemory(
    title: string,
  ): Promise<{ success: boolean; title: string; deleted: boolean; error?: string }> {
    try {
      if (!title || !title.trim()) return { success: false, title: '', deleted: false, error: 'Title is required.' };
      await this.ensureDir();
      const filename = sanitizeFilename(title.trim());
      const filePath = join(this.baseDir, filename);
      if (!existsSync(filePath)) return { success: false, title: title.trim(), deleted: false, error: `Memory "${title.trim()}" not found.` };
      await unlink(filePath);
      return { success: true, title: title.trim(), deleted: true };
    } catch (error) {
      return { success: false, title, deleted: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listMemories(
    type?: string,
    tag?: string,
  ): Promise<{
    success: boolean;
    memories: MemoryMeta[];
    total: number;
    error?: string;
  }> {
    try {
      await this.ensureDir();
      if (!existsSync(this.baseDir)) return { success: true, memories: [], total: 0 };
      const files = await readdir(this.baseDir);
      const memories: MemoryMeta[] = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const { title, type: fileType, tags, created, modified } = await this.readFileMeta(join(this.baseDir, file));
          const matchesType = !type || fileType === type;
          const matchesTag = !tag || tags.includes(tag);
          if (matchesType && matchesTag) memories.push({ title, type: fileType, tags, created, modified });
        } catch {
          // skip
        }
      }

      memories.sort((a, b) => b.modified.localeCompare(a.modified));
      return { success: true, memories, total: memories.length };
    } catch (error) {
      return { success: false, memories: [], total: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function createMemoryManager(baseDir?: string): MemoryManager {
  return new MemoryManager(baseDir);
}
