import { CSSProperties } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const s: Record<string, CSSProperties> = {
  wrapper: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: 24,
  },
};

export default function Layout() {
  return (
    <div style={s.wrapper}>
      <Sidebar />
      <div style={s.main}>
        <TopBar />
        <div style={s.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
