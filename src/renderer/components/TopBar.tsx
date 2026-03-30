import { CSSProperties } from 'react';

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
  selector: {
    minWidth: 200,
    padding: '6px 12px',
    cursor: 'pointer',
  },
};

export default function TopBar() {
  return (
    <header style={s.bar} className="draggable">
      <div style={s.section} className="no-drag">
        <span style={s.title}>My App</span>
      </div>

      <div
        style={{ ...s.section, justifyContent: 'center' }}
        className="no-drag"
      >
        <select className="input-base" style={s.selector}>
          <option>Select a model...</option>
          <option>llama-3.1-8b</option>
          <option>mistral-7b</option>
        </select>
      </div>

      <div
        style={{ ...s.section, justifyContent: 'flex-end' }}
        className="no-drag"
      />
    </header>
  );
}
