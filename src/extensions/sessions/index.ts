/* eslint-disable import/no-cycle */
import type { ExtensionToolDef, ExtensionToolContext } from '../types';
import type { SavedSession, Message } from '../../shared/chatTypes';
import manifest from './manifest.json';
import * as store from '../../main/sessionStore';

// Alias cache per profileId. Stores mapping alias(1..N) -> real UUID
// for the *previous* sessions (excluding the invoking current session).
// Deterministic: sorted by updatedAt desc, alias 1 = newest previous.
const aliasCache = new Map<
  string,
  { aliasToId: Map<number, string>; idToAlias: Map<string, number> }
>();

function buildPreviousAliases(
  profileId: string,
  currentSessionId: string | undefined,
  allSessions: { id: string; updatedAt: number }[],
): {
  aliasToId: Map<number, string>;
  idToAlias: Map<string, number>;
  ordered: typeof allSessions;
} {
  const previous = allSessions.filter((s) => s.id !== currentSessionId);
  const aliasToId = new Map<number, string>();
  const idToAlias = new Map<string, number>();
  previous.forEach((s, idx) => {
    const alias = idx + 1;
    aliasToId.set(alias, s.id);
    idToAlias.set(s.id, alias);
  });
  aliasCache.set(profileId, { aliasToId, idToAlias });
  return { aliasToId, idToAlias, ordered: previous };
}

function resolveAliasToId(
  profileId: string,
  raw: string | number,
): string | null {
  // Try numeric alias first
  const asNumber = typeof raw === 'number' ? raw : Number(raw);
  const isNumericAlias =
    raw !== '' &&
    Number.isInteger(asNumber) &&
    asNumber > 0 &&
    String(raw).trim() === String(asNumber);

  if (isNumericAlias) {
    const entry = aliasCache.get(profileId);
    if (!entry) {
      // No prior list call — build lazily via store (imported lazily below would be too late)
      // Fallback: try to load via dynamic helper later; for now return null to trigger lazy build
      return `__alias__${asNumber}`;
    }
    return entry.aliasToId.get(asNumber) ?? null;
  }
  // Treat as UUID string
  const str = String(raw).trim();
  if (!str) return null;
  if (str.startsWith('__alias__')) return str;
  return str;
}

function requireContext(ctx?: ExtensionToolContext): {
  sessionId: string;
  profileId: string;
} {
  if (!ctx?.sessionId || !ctx?.profileId) {
    throw new Error(
      'Session context unavailable. This tool must be called from within a chat session.',
    );
  }
  return { sessionId: ctx.sessionId, profileId: ctx.profileId };
}

function toMessagePreview(msg: Message) {
  const textParts = msg.content
    .filter((s) => s.text?.trim() || s.type === 'tool')
    .map((seg) => {
      if (seg.type === 'tool') {
        return `[tool:${seg.toolName ?? 'unknown'}] params=${seg.toolParams ?? ''} result=${seg.toolResult ?? ''}`;
      }
      return seg.text?.trim() ?? '';
    })
    .filter(Boolean)
    .join('\n');
  return {
    id: msg.id,
    role: msg.role,
    text: textParts,
    collapsed: !!msg.collapsed,
    hasToolCalls: msg.content.some((s) => s.type === 'tool'),
  };
}

export const tools: Record<string, ExtensionToolDef> = {
  get_current_session_name: {
    meta: {
      name: 'get_current_session_name',
      label: 'Get Current Session Name',
      description: 'Get the name/title of the current chat session.',
      descriptionForModel:
        'Returns the title, IDs, and timestamps of the session that invoked this tool (the current conversation). Use this to know what the current session is called.\nNo parameters required.',
      icon: 'MessagesSquare',
      tags: ['sessions'],
    },
    params: {
      type: 'object',
      properties: {},
    },
    async handler(_params: Record<string, never>, ctx?: ExtensionToolContext) {
      const { sessionId, profileId } = requireContext(ctx);
      const session = store.getSessionWithLive(sessionId);
      if (!session) {
        return { error: 'Current session not found' };
      }
      if (session.profileId !== profileId) {
        return { error: 'Session not found in current profile' };
      }
      return {
        alias: null,
        realId: session.id,
        title: session.title,
        profileId: session.profileId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        pinned: !!session.pinned,
      };
    },
  },

  rename_current_session: {
    meta: {
      name: 'rename_current_session',
      label: 'Rename Current Session',
      description: 'Rename the current chat session.',
      descriptionForModel:
        'Rename the current conversation (the session that invoked this tool). Use this to give the current chat a more descriptive title.\nParameters:\n  new_title (required) — the new title for the current session',
      icon: 'Pencil',
      tags: ['sessions'],
    },
    params: {
      type: 'object',
      properties: {
        new_title: {
          type: 'string',
          description: 'The new title for the current session',
        },
      },
      required: ['new_title'],
    },
    async handler(params: { new_title: string }, ctx?: ExtensionToolContext) {
      const { sessionId, profileId } = requireContext(ctx);
      const newTitle = String(params.new_title ?? '').trim();
      if (!newTitle) {
        return { error: 'new_title is required and cannot be empty' };
      }
      // Scope check: ensure session belongs to current profile
      const existing = store.getSessionWithLive(sessionId);
      if (!existing) return { error: 'Current session not found' };
      if (existing.profileId !== profileId) {
        return { error: 'Session not found in current profile' };
      }
      const oldTitle = existing.title;
      const updated = store.renameSessionWithLive(sessionId, newTitle);
      if (!updated) {
        return { error: 'Failed to rename current session' };
      }
      return {
        success: true,
        alias: null,
        realId: updated.id,
        oldTitle,
        newTitle: updated.title,
      };
    },
  },

  list_previous_sessions: {
    meta: {
      name: 'list_previous_sessions',
      label: 'List Previous Sessions',
      description:
        'List previous chat sessions for the current profile with short numeric aliases.',
      descriptionForModel:
        'List all previous chat sessions for the CURRENT profile only (never other profiles), excluding the current session. Results are sorted newest-first.\n' +
        'Each session has a short numeric `alias` (1, 2, 3...) that you MUST use as `session_alias` when calling load_previous_session or rename_previous_session. Aliases are ephemeral but deterministic — call this again to refresh. Also returns `realId` (UUID) for reference, `title`, `messageCount`, `createdAt`, `updatedAt`.\n' +
        'Parameters:\n' +
        '  limit (optional) — max number to return\n' +
        '  offset (optional) — skip N most recent previous sessions\n' +
        'Always call this before trying to load or rename a previous session, so you have the correct alias.',
      icon: 'History',
      tags: ['sessions'],
    },
    params: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of previous sessions to return',
          minimum: 1,
        },
        offset: {
          type: 'integer',
          description: 'Skip the N most recent previous sessions',
          minimum: 0,
        },
      },
    },
    async handler(
      params: { limit?: number; offset?: number },
      ctx?: ExtensionToolContext,
    ) {
      const { sessionId, profileId } = requireContext(ctx);
      const all = store.listSessionsWithLive(profileId);
      // Build alias maps for previous only (excluding current)
      const { ordered } = buildPreviousAliases(
        profileId,
        sessionId,
        all.map((s: SavedSession) => ({ id: s.id, updatedAt: s.updatedAt })),
      );
      // ordered is already sorted newest-first
      // Map ordered ids back to full session objects
      const idToSession = new Map<string, SavedSession>(
        all.map((s: SavedSession) => [s.id, s]),
      );
      let sessions: SavedSession[] = ordered
        .map((o) => idToSession.get(o.id)!)
        .filter(Boolean) as SavedSession[];

      const offset = params.offset ?? 0;
      const { limit } = params;
      if (offset) sessions = sessions.slice(offset);
      if (limit !== undefined && limit !== null)
        sessions = sessions.slice(0, limit);

      // Need idToAlias from cache (which is for full previous list, not sliced)
      const cacheEntry = aliasCache.get(profileId)!;
      return {
        currentSessionId: sessionId,
        profileId,
        totalPrevious: ordered.length,
        returned: sessions.length,
        offset,
        sessions: sessions.map((s: SavedSession) => ({
          alias: cacheEntry.idToAlias.get(s.id)!,
          realId: s.id,
          title: s.title,
          messageCount: s.messages.length,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          pinned: !!s.pinned,
        })),
      };
    },
  },

  load_previous_session: {
    meta: {
      name: 'load_previous_session',
      label: 'Load Previous Session',
      description: 'Load the last X messages from a previous session.',
      descriptionForModel:
        'Load the last N messages from a previous session (same profile only). You MUST first call list_previous_sessions to get the `alias` (1,2,3...). Pass that alias as `session_alias`. Alternatively you may pass the full `realId` UUID.\n' +
        'This tool is read-only and profile-scoped — it cannot access sessions from other profiles.\n' +
        'Parameters:\n' +
        '  session_alias (required) — short numeric alias (e.g., 1) from list_previous_sessions, or full realId UUID\n' +
        '  last_n_messages (optional, default 5) — number of most recent messages to return. No cap.',
      icon: 'FolderOpen',
      tags: ['sessions'],
    },
    params: {
      type: 'object',
      properties: {
        session_alias: {
          oneOf: [{ type: 'integer' }, { type: 'string' }],
          description:
            'Short numeric alias (1,2,3...) from list_previous_sessions, or full session UUID',
        },
        last_n_messages: {
          type: 'integer',
          description:
            'Number of most recent messages to return (default 5, no cap)',
          minimum: 1,
          default: 5,
        },
      },
      required: ['session_alias'],
    },
    async handler(
      params: { session_alias: string | number; last_n_messages?: number },
      ctx?: ExtensionToolContext,
    ) {
      const { sessionId: currentId, profileId } = requireContext(ctx);
      const rawAlias = params.session_alias;
      if (
        rawAlias === undefined ||
        rawAlias === null ||
        String(rawAlias).trim() === ''
      ) {
        return { error: 'session_alias is required' };
      }
      const lastN = params.last_n_messages ?? 5;
      if (!Number.isInteger(lastN) || lastN < 1) {
        return { error: 'last_n_messages must be a positive integer' };
      }

      // using live-aware store helpers (profile-scoped)

      // Resolve alias -> realId
      let resolved: string | null = null;
      const maybeAlias = resolveAliasToId(profileId, rawAlias);
      if (maybeAlias && maybeAlias.startsWith('__alias__')) {
        // Lazy rebuild because no cache present
        const all = store.listSessionsWithLive(profileId);
        const { aliasToId } = buildPreviousAliases(
          profileId,
          currentId,
          all.map((s: SavedSession) => ({ id: s.id, updatedAt: s.updatedAt })),
        );
        const n = Number(maybeAlias.replace('__alias__', ''));
        resolved = aliasToId.get(n) ?? null;
      } else {
        // Check if rawAlias was a numeric alias that existed in cache
        const cache = aliasCache.get(profileId);
        const asNum = Number(rawAlias);
        const isNumericAlias =
          rawAlias !== '' &&
          Number.isInteger(asNum) &&
          asNum > 0 &&
          String(rawAlias).trim() === String(asNum) &&
          cache?.aliasToId.has(asNum);
        if (isNumericAlias) {
          resolved = maybeAlias;
        } else {
          // Treat as raw UUID string
          const str = String(rawAlias).trim();
          // Also allow direct numeric alias passed as string that maps via cache
          if (
            cache &&
            cache.aliasToId.has(asNum) &&
            String(rawAlias).trim() === String(asNum)
          ) {
            resolved = cache.aliasToId.get(asNum)!;
          } else {
            resolved = str;
          }
        }
      }

      if (!resolved) {
        return {
          error: `Session alias "${rawAlias}" not found in current profile. Call list_previous_sessions first.`,
        };
      }

      // Disallow loading current session via this tool
      if (resolved === currentId) {
        return {
          error:
            'Cannot load the current session with this tool. Use get_current_session_name for current session info.',
        };
      }

      const target = store.getSessionWithLive(resolved);
      if (!target) {
        return { error: `Session "${rawAlias}" not found` };
      }
      if (target.profileId !== profileId) {
        return { error: 'Session not found in current profile' };
      }

      const aliasForTarget =
        aliasCache.get(profileId)?.idToAlias.get(target.id) ?? null;
      const totalMessages = target.messages.length;
      const slice = target.messages.slice(-lastN);
      return {
        alias: aliasForTarget,
        realId: target.id,
        title: target.title,
        profileId: target.profileId,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
        pinned: !!target.pinned,
        totalMessages,
        returnedMessages: slice.length,
        last_n_messages: lastN,
        messages: slice.map(toMessagePreview),
        // Also include raw messages for programmatic use (truncated to text+tool)
        // The preview above is lean; full messages include history for debugging
      };
    },
  },

  rename_previous_session: {
    meta: {
      name: 'rename_previous_session',
      label: 'Rename Previous Session',
      description: 'Rename a previous chat session by alias.',
      descriptionForModel:
        'Rename a previous session (same profile only). You MUST first call list_previous_sessions to get the `alias` (1,2,3...). Pass that alias as `session_alias`.\n' +
        'Parameters:\n' +
        '  session_alias (required) — short numeric alias (e.g., 1) from list_previous_sessions, or full realId UUID\n' +
        '  new_title (required) — new title for that previous session',
      icon: 'Pencil',
      tags: ['sessions'],
    },
    params: {
      type: 'object',
      properties: {
        session_alias: {
          oneOf: [{ type: 'integer' }, { type: 'string' }],
          description:
            'Short numeric alias (1,2,3...) from list_previous_sessions, or full session UUID',
        },
        new_title: {
          type: 'string',
          description: 'New title for the previous session',
        },
      },
      required: ['session_alias', 'new_title'],
    },
    async handler(
      params: { session_alias: string | number; new_title: string },
      ctx?: ExtensionToolContext,
    ) {
      const { sessionId: currentId, profileId } = requireContext(ctx);
      const rawAlias = params.session_alias;
      const newTitle = String(params.new_title ?? '').trim();
      if (
        rawAlias === undefined ||
        rawAlias === null ||
        String(rawAlias).trim() === ''
      ) {
        return { error: 'session_alias is required' };
      }
      if (!newTitle) {
        return { error: 'new_title is required and cannot be empty' };
      }

      // using live-aware store helpers (profile-scoped)

      let resolved: string | null = null;
      const maybeAlias = resolveAliasToId(profileId, rawAlias);
      if (maybeAlias && maybeAlias.startsWith('__alias__')) {
        const all = store.listSessionsWithLive(profileId);
        const { aliasToId } = buildPreviousAliases(
          profileId,
          currentId,
          all.map((s: SavedSession) => ({ id: s.id, updatedAt: s.updatedAt })),
        );
        const n = Number(maybeAlias.replace('__alias__', ''));
        resolved = aliasToId.get(n) ?? null;
      } else {
        const cache = aliasCache.get(profileId);
        const asNum = Number(rawAlias);
        const isNumericAlias =
          rawAlias !== '' &&
          Number.isInteger(asNum) &&
          asNum > 0 &&
          String(rawAlias).trim() === String(asNum) &&
          cache?.aliasToId.has(asNum);
        if (isNumericAlias) {
          resolved = maybeAlias;
        } else {
          const str = String(rawAlias).trim();
          if (
            cache &&
            cache.aliasToId.has(asNum) &&
            String(rawAlias).trim() === String(asNum)
          ) {
            resolved = cache.aliasToId.get(asNum)!;
          } else {
            resolved = str;
          }
        }
      }

      if (!resolved) {
        return {
          error: `Session alias "${rawAlias}" not found in current profile. Call list_previous_sessions first.`,
        };
      }

      if (resolved === currentId) {
        return {
          error:
            'Cannot rename the current session with this tool. Use rename_current_session instead.',
        };
      }

      const target = store.getSessionWithLive(resolved);
      if (!target) {
        return { error: `Session "${rawAlias}" not found` };
      }
      if (target.profileId !== profileId) {
        return { error: 'Session not found in current profile' };
      }

      const oldTitle = target.title;
      const updated = store.renameSessionWithLive(resolved, newTitle);
      if (!updated) {
        return { error: `Failed to rename session "${rawAlias}"` };
      }
      const aliasForTarget =
        aliasCache.get(profileId)?.idToAlias.get(updated.id) ?? null;
      return {
        success: true,
        alias: aliasForTarget,
        realId: updated.id,
        oldTitle,
        newTitle: updated.title,
      };
    },
  },
};

export { manifest };
