import React, { CSSProperties, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  Bot,
  Settings,
  SlidersHorizontal,
  GitBranch,
  Puzzle,
} from 'lucide-react';

const mainNavItems = [
  { path: '/', icon: MessageSquare, label: 'Chat' },
  { path: '/profiles', icon: SlidersHorizontal, label: 'Profiles' },
  { path: '/models', icon: Bot, label: 'Models' },
  { path: '/extensions', icon: Puzzle, label: 'Extensions' },
  { path: '/workflows', icon: GitBranch, label: 'Workflows' },
];

const bottomNavItems = [
  { path: '/settings', icon: Settings, label: 'Settings' },
];

const COLLAPSED_WIDTH = 60;
const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const EXPAND_DELAY_MS = 0; // instant expand on hover
const COLLAPSE_DELAY_MS = 120; // slight delay before collapsing

const s: Record<string, CSSProperties> = {
  navGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s ease',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  menuItemActive: {
    background: 'rgba(255, 255, 255, 0.06)',
    fontWeight: 600,
  },
  icon: {
    color: 'var(--text-primary)',
    opacity: 0.9,
    flexShrink: 0,
  },
};

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Hover-expand state ──
  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHovered(true), EXPAND_DELAY_MS);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(
      () => setHovered(false),
      COLLAPSE_DELAY_MS,
    );
  };

  // ── Resizable width (only active when expanded) ──
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setIsResizing(true);
      handleRef.current?.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isResizing) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    },
    [isResizing],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      setIsResizing(false);
      handleRef.current?.releasePointerCapture(e.pointerId);
    },
    [],
  );

  const isExpanded = hovered || isResizing;
  const currentWidth = isExpanded ? sidebarWidth : COLLAPSED_WIDTH;

  return (
    <nav
      className="draggable"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        width: currentWidth,
        minWidth: currentWidth,
        height: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 8px',
        borderRight: '1px solid var(--border)',
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
        transition: isResizing
          ? 'none'
          : 'width 0.2s ease, min-width 0.2s ease',
        userSelect: isResizing ? 'none' : 'auto',
        // Sit on top of page content while expanded so it doesn't shift layout
        zIndex: isExpanded ? 50 : 'auto',
      }}
    >
      {/* Main Pages Navigation */}
      <div style={s.navGroup} className="no-drag">
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button
              type="button"
              key={item.path}
              style={{ ...s.menuItem, ...(isActive ? s.menuItemActive : {}) }}
              onClick={() => navigate(item.path)}
              title={!isExpanded ? item.label : undefined}
            >
              <Icon size={18} strokeWidth={2} style={s.icon} />
              <span
                style={{
                  opacity: isExpanded ? 1 : 0,
                  transition: isResizing ? 'none' : 'opacity 0.15s ease',
                  pointerEvents: 'none',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Spacer pushes bottom nav items to the bottom */}
      <div style={{ flex: 1 }} />

      {/* Settings at the bottom */}
      <div style={s.navGroup} className="no-drag">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button
              type="button"
              key={item.path}
              style={{ ...s.menuItem, ...(isActive ? s.menuItemActive : {}) }}
              onClick={() => navigate(item.path)}
              title={!isExpanded ? item.label : undefined}
            >
              <Icon size={18} strokeWidth={2} style={s.icon} />
              <span
                style={{
                  opacity: isExpanded ? 1 : 0,
                  transition: isResizing ? 'none' : 'opacity 0.15s ease',
                  pointerEvents: 'none',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Drag Handle — only visible/active when expanded */}
      {isExpanded && (
        <button
          type="button"
          ref={handleRef}
          className="no-drag"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Resize sidebar"
          style={{
            position: 'absolute',
            top: 0,
            right: -3,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            zIndex: 100,
            backgroundColor: isResizing ? 'var(--accent)' : 'transparent',
            transition: isResizing ? 'none' : 'background-color 0.2s ease',
            border: 'none',
            padding: 0,
            margin: 0,
            outline: 'none',
          }}
        />
      )}
    </nav>
  );
}
