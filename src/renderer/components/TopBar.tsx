import React, { CSSProperties } from 'react';
import DownloadManager from './DownloadManager'; // <-- ADD IMPORT

const s: Record<string, CSSProperties> = {
  bar: {
    height: 'var(--topbar-height)',
    minHeight: 'var(--topbar-height)',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
  },
  section: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
};

export default function TopBar() {
  return (
    <header style={s.bar} className="draggable">
      <div style={s.section} className="no-drag">
        <span style={s.title}>Synapse</span>
      </div>

      <div
        style={{ ...s.section, justifyContent: 'flex-end', gap: '12px' }} // <-- ADD GAP
        className="no-drag"
      >
        <DownloadManager /> {/* <-- ADD COMPONENT */}
      </div>
    </header>
  );
}
