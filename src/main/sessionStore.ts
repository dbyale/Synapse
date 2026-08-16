import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { Message, SavedSession } from '../shared/chatTypes';

let cache: Record<string, SavedSession> | null = null;

function storePath(): string {
  return path.join(app.getPath('userData'), 'sessions.json');
}

function load(): Record<string, SavedSession> {
  if (cache) return cache;
  try {
    if (fs.existsSync(storePath())) {
      const raw = fs.readFileSync(storePath(), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cache = parsed;
      }
    }
  } catch {
    // Ignore corrupted store
  }
  cache = cache ?? {};
  return cache;
}

function persist(): void {
  if (!cache) return;
  try {
    const tmp = `${storePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    fs.renameSync(tmp, storePath());
  } catch (e) {
    console.error('[sessionStore] write failed:', e);
  }
}

export function listSessions(profileId: string): SavedSession[] {
  return Object.values(load())
    .filter((s) => s.profileId === profileId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): SavedSession | null {
  return load()[id] ?? null;
}

export function saveSession(session: SavedSession): void {
  const all = load();
  const existing = all[session.id];
  const hasNewMessage =
    !existing || session.messages.length !== existing.messages.length;
  all[session.id] = {
    ...session,
    updatedAt: hasNewMessage ? Date.now() : existing.updatedAt,
  };
  persist();
}

export function deleteSession(id: string): void {
  const all = load();
  delete all[id];
  persist();
}

export function renameSession(id: string, title: string): SavedSession | null {
  const all = load();
  const session = all[id];
  if (!session) return null;
  const updated = { ...session, title: title.trim() || session.title };
  all[id] = updated;
  persist();
  return updated;
}

export function sanitizeMessagesForStorage(messages: Message[]): Message[] {
  return messages.map((msg) => ({
    ...msg,
    content: msg.content.map((seg) => {
      if (!seg.mediaItems || seg.mediaItems.length === 0) return seg;
      const mediaItems = seg.mediaItems.filter((item) => item.type !== 'video');
      return {
        ...seg,
        mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
      };
    }),
  }));
}