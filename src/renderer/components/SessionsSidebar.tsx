import { useEffect, useCallback, useState, FormEvent, memo } from 'react';
import {
  X,
  SquarePen,
  Search,
  Pencil,
  Download,
  Trash2,
  Check,
  MessageSquare,
  Loader2,
  Pin,
} from 'lucide-react';
import { sessionsToMarkdown } from '../utils/sessions';
import type { SavedSession } from '../../shared/chatTypes';
import './styles/SessionsSidebar.css';

interface SessionsSidebarProps {
  profileId: string;
  profileName: string;
  activeSessionId: string | null;
  collapsed: boolean;
  streamingSessionIds: Set<string>;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}

const GROUP_ORDER = [
  'Today',
  'Yesterday',
  'Previous 7 days',
  'Previous 30 days',
  'Older',
] as const;

type GroupLabel = 'Pinned' | (typeof GROUP_ORDER)[number];

function getGroupLabel(ts: number): GroupLabel {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(ts);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Previous 7 days';
  if (diffDays < 30) return 'Previous 30 days';
  return 'Older';
}

function SessionsSidebar({
  profileId,
  profileName,
  activeSessionId,
  collapsed,
  streamingSessionIds,
  onToggle,
  onOpen,
  onNewChat,
  onDelete,
}: SessionsSidebarProps) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.electronAPI.chatListSessions(profileId);
      setSessions(list);
    } catch {
      setSessions([]);
    }
  }, [profileId]);

  useEffect(() => {
    refresh();
  }, [refresh, streamingSessionIds]);

  const startRename = (session: SavedSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const submitRename = async (e: FormEvent) => {
    e.preventDefault();
    if (renamingId) {
      try {
        await window.electronAPI.chatRenameSession(renamingId, renameValue);
      } catch {
        // Ignore rename failures
      }
      refresh();
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDeleteClick = (id: string) => {
    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      onDelete(id);
      setTimeout(() => refresh(), 50);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const exportSession = (session: SavedSession) => {
    const md = sessionsToMarkdown(session, profileName);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (session.title || 'session').replace(
      /[\\/:*?"<>|]/g,
      '_',
    );
    a.download = `${safeTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const togglePin = async (session: SavedSession) => {
    try {
      await window.electronAPI.chatSetSessionPinned(
        session.id,
        !session.pinned,
      );
    } catch {
      // Ignore pin failures
    }
    refresh();
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? sessions.filter((s) => s.title.toLowerCase().includes(q))
    : sessions;

  const groups: { label: GroupLabel; items: SavedSession[] }[] = [];
  const pinnedItems = visible.filter((s) => s.pinned);
  if (pinnedItems.length > 0)
    groups.push({ label: 'Pinned', items: pinnedItems });
  GROUP_ORDER.forEach((label) => {
    const items = visible.filter(
      (s) => !s.pinned && getGroupLabel(s.updatedAt) === label,
    );
    if (items.length > 0) groups.push({ label, items });
  });

  return (
    <div
      className="sessions-sidebar-wrapper"
      style={{
        width: collapsed ? 0 : 320,
        minWidth: collapsed ? 0 : 320,
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
      }}
    >
      <div className="sessions-sidebar" style={{ width: 320, minWidth: 320 }}>
        <div className="sessions-sidebar__header">
          <span className="sessions-sidebar__title">
            {profileName || 'Sessions'}
          </span>
          <button
            type="button"
            className="sessions-sidebar__close"
            onClick={onToggle}
            title="Hide sidebar"
          >
            <X size={16} />
          </button>
        </div>
        <button
          type="button"
          className="sessions-sidebar__newchat"
          onClick={onNewChat}
        >
          <SquarePen size={16} />
          New Chat
        </button>
        <div className="sessions-sidebar__search">
          <Search size={14} className="sessions-sidebar__search-icon" />
          <input
            type="text"
            className="sessions-sidebar__search-input"
            placeholder="Search conversation..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="sessions-sidebar__list">
          {sessions.length === 0 && (
            <div className="sessions-sidebar__empty">No conversations yet</div>
          )}
          {sessions.length > 0 && groups.length === 0 && (
            <div className="sessions-sidebar__empty">No matches</div>
          )}
          {sessions.length > 0 &&
            groups.length > 0 &&
            groups.map((group) => (
              <div key={group.label} className="sessions-sidebar__group">
                <div className="sessions-sidebar__group-title">
                  {group.label}
                </div>
                {group.items.map((session) => (
                  <div
                    key={session.id}
                    className={`sessions-sidebar__item${session.id === activeSessionId ? ' sessions-sidebar__item--active' : ''}`}
                  >
                    {renamingId === session.id ? (
                      <form
                        className="sessions-sidebar__rename"
                        onSubmit={submitRename}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="sessions-sidebar__rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          onBlur={submitRename}
                        />
                        <button
                          type="submit"
                          className="sessions-sidebar__rename-save"
                          aria-label="Save name"
                        >
                          <Check size={14} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="sessions-sidebar__item-main"
                          onClick={() => onOpen(session.id)}
                          title={session.title || 'Untitled session'}
                        >
                          <div className="sessions-sidebar__item-icon">
                            {streamingSessionIds.has(session.id) ? (
                              <Loader2
                                size={16}
                                className="sessions-sidebar__spinner"
                              />
                            ) : (
                              <MessageSquare
                                size={16}
                                className="sessions-sidebar__favicon-fallback"
                              />
                            )}
                          </div>
                          <div className="sessions-sidebar__item-content">
                            <span className="sessions-sidebar__item-title">
                              {session.title || 'Untitled session'}
                            </span>
                            <span className="sessions-sidebar__item-meta">
                              {(() => {
                                const count = session.messages.filter(
                                  (m) => m.role === 'user',
                                ).length;
                                return `${count} ${count === 1 ? 'message' : 'messages'}`;
                              })()}
                            </span>
                          </div>
                        </button>
                        <div className="sessions-sidebar__item-actions">
                          <button
                            type="button"
                            className={`sessions-sidebar__item-action${session.pinned ? ' sessions-sidebar__item-action--pinned' : ''}`}
                            onClick={() => togglePin(session)}
                            title={session.pinned ? 'Unpin' : 'Pin'}
                            aria-label={
                              session.pinned ? 'Unpin session' : 'Pin session'
                            }
                          >
                            <Pin
                              size={13}
                              fill={session.pinned ? 'currentColor' : 'none'}
                            />
                          </button>
                          <button
                            type="button"
                            className="sessions-sidebar__item-action"
                            onClick={() => startRename(session)}
                            title="Rename"
                            aria-label="Rename session"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="sessions-sidebar__item-action"
                            onClick={() => exportSession(session)}
                            title="Export as Markdown"
                            aria-label="Export session as Markdown"
                          >
                            <Download size={13} />
                          </button>
                          <button
                            type="button"
                            className={`sessions-sidebar__item-action${confirmDeleteId === session.id ? ' sessions-sidebar__item-action--confirm' : ''}`}
                            onClick={() => handleDeleteClick(session.id)}
                            title={
                              confirmDeleteId === session.id
                                ? 'Click again to confirm'
                                : 'Delete'
                            }
                            aria-label="Delete session"
                          >
                            {confirmDeleteId === session.id ? (
                              <Check size={13} />
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

export default memo(SessionsSidebar);
