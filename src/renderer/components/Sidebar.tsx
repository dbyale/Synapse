import React, { CSSProperties, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, Bot, Settings } from 'lucide-react';

const navItems = [
  { path: '/', icon: MessageSquare, label: 'Chat' },
  { path: '/models', icon: Bot, label: 'Models' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

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
  },
  menuItemActive: {
    background: 'rgba(255, 255, 255, 0.06)',
    fontWeight: 600,
  },
  icon: {
    color: 'var(--text-primary)',
    opacity: 0.9,
  },
};

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setIsResizing(true);
      // Capture the pointer — all future pointer events go to this element
      // even if the cursor leaves the window
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

  return (
    <nav
      className="draggable"
      style={{
        width: sidebarWidth,
        height: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 12px',
        borderRight: '1px solid var(--border)',
        position: 'relative',
        flexShrink: 0,
        // Prevent text selection while resizing
        userSelect: isResizing ? 'none' : 'auto',
      }}
    >
      {/* Main Pages Navigation */}
      <div style={s.navGroup} className="no-drag">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button
              type="button"
              key={item.path}
              style={{ ...s.menuItem, ...(isActive ? s.menuItemActive : {}) }}
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} strokeWidth={2} style={s.icon} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Drag Handle — uses Pointer Capture for smooth off-screen dragging */}
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
    </nav>
  );
}
