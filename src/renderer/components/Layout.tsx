import { CSSProperties, useRef, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SourcesSidebar from './SourcesSidebar';
import { SourcesProvider, useSourcesContext } from '../context/SourcesContext';
import ChatPage from '../pages/ChatPage';

function LayoutInner() {
  const { isOpen, closeSources, sources } = useSourcesContext();
  const location = useLocation();
  const navigate = useNavigate();
  const prevPathRef = useRef(location.pathname);

  const isChatRoute =
    location.pathname === '/' || location.pathname === '/chat';

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMenuNavigate((path) => {
      navigate(path);
    });

    return unsubscribe;
  }, [navigate]);

  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      closeSources();
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname, closeSources]);

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
    contentRow: {
      display: 'flex',
      flex: 1,
      minHeight: 0,
    },
    content: {
      flex: 1,
      overflow: 'hidden auto',
      padding: 24,
      minWidth: 0,
    },
  };

  return (
    <div style={s.wrapper}>
      <Sidebar />
      <div style={s.main}>
        <TopBar />
        <div style={s.contentRow}>
          <div style={s.content}>
            <div
              style={{
                display: isChatRoute ? 'block' : 'none',
                height: '100%',
              }}
            >
              <ChatPage />
            </div>
            <div style={{ display: isChatRoute ? 'none' : 'block' }}>
              <Outlet />
            </div>
          </div>
          <SourcesSidebar
            sources={sources}
            onClose={closeSources}
            isOpen={isOpen}
          />
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  return (
    <SourcesProvider>
      <LayoutInner />
    </SourcesProvider>
  );
}
