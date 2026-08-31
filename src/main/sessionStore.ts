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

export function setSessionPinned(
  id: string,
  pinned: boolean,
): SavedSession | null {
  const all = load();
  const session = all[id];
  if (!session) return null;
  const updated = { ...session, pinned };
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

// --- Live-aware helpers for extension use (avoids circular import with chat.ts) ---
let liveSessionsProvider: (() => Map<string, any>) | null = null;
let sessionChangedCallback: ((id: string) => void) | null = null;

export function setLiveSessionsProvider(
  provider: () => Map<string, any>,
): void {
  liveSessionsProvider = provider;
}

export function setSessionChangedCallback(
  cb: (id: string) => void,
): void {
  sessionChangedCallback = cb;
}

export function getSessionWithLive(id: string): SavedSession | null {
  const provider = liveSessionsProvider?.();
  const live = provider?.get(id);
  if (live) {
    return {
      id: live.sessionId,
      profileId: live.profileId,
      title: live.title,
      createdAt: live.createdAt,
      updatedAt: Date.now(),
      messages: live.messages,
      history: live.history,
      pinned: live.pinned,
      sources: live.sources,
    };
  }
  return getSession(id);
}

export function listSessionsWithLive(profileId: string): SavedSession[] {
  const base = listSessions(profileId);
  const provider = liveSessionsProvider?.();
  if (!provider) return base;
  const idToLive = new Map<string, any>();
  provider.forEach((live: any, id: string) => {
    if (live.profileId === profileId) idToLive.set(id, live);
  });
  const merged = base.map((saved) => {
    const live = idToLive.get(saved.id);
    if (!live) return saved;
    return {
      ...saved,
      title: live.title,
      messages: live.messages,
      history: live.history,
      pinned: live.pinned,
      sources: live.sources,
      updatedAt: Date.now(),
    };
  });
  // Include live sessions not yet persisted (should be rare as startSession persists immediately)
  for (const [id, live] of idToLive) {
    if (!merged.find((s) => s.id === id)) {
      merged.push({
        id: live.sessionId,
        profileId: live.profileId,
        title: live.title,
        createdAt: live.createdAt,
        updatedAt: Date.now(),
        messages: live.messages,
        history: live.history,
        pinned: live.pinned,
        sources: live.sources,
      });
    }
  }
  return merged.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function renameSessionWithLive(
  id: string,
  title: string,
): SavedSession | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const provider = liveSessionsProvider?.();
  const live = provider?.get(id);
  if (live) {
    live.title = trimmed;
    const all = load();
    if (all[id]) {
      all[id] = { ...all[id], title: trimmed };
      persist();
    } else {
      const saved: SavedSession = {
        id: live.sessionId,
        profileId: live.profileId,
        title: trimmed,
        createdAt: live.createdAt,
        updatedAt: Date.now(),
        messages: live.messages,
        history: live.history,
        pinned: live.pinned,
        sources: live.sources,
      };
      saveSession(saved);
    }
    sessionChangedCallback?.(id);
    return {
      id: live.sessionId,
      profileId: live.profileId,
      title: trimmed,
      createdAt: live.createdAt,
      updatedAt: Date.now(),
      messages: live.messages,
      history: live.history,
      pinned: live.pinned,
      sources: live.sources,
    };
  }
  const updated = renameSession(id, trimmed);
  if (updated) sessionChangedCallback?.(id);
  return updated;
}