import { useCallback, useEffect, useRef, useState } from 'react';
import SetupExperiencePage from './SetupExperiencePage';
import ProfessionsSetupPage from './ProfessionsSetupPage';
import BackendSetupPage from './BackendSetupPage';
import ParserSetupPage from './ParserSetupPage';
import SystemSetupPage from './SystemSetupPage';
import ServerSetupPage from './ServerSetupPage';
import SecuritySetupPage from './SecuritySetupPage';
import ChatSetupPage from './ChatSetupPage';
import LlamaSetupPage from './LlamaSetupPage';
import DownloadManager from '../components/DownloadManager';
import type { BackendInfo, ParserInfo } from '../preload.d';
import './onboarding.css';

type Step =
  | 'setup'
  | 'professions'
  | 'backend'
  | 'parser'
  | 'system'
  | 'server'
  | 'security'
  | 'chatSetup'
  | 'llamaSetup';

interface PageLayer {
  id: number;
  step: Step;
  phase: 'enter' | 'settle' | 'exit';
}

const EXIT_MS = 300;
const CLOSE_MS = 260;

export default function Onboarding() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [layers, setLayers] = useState<PageLayer[]>([]);
  const idRef = useRef(0);

  // Temporary session-only cache — lives only while onboarding is open.
  // Hardware is probed before the first page mounts; nothing interactive
  // renders until it resolves so hover never contends with si.graphics.
  const [preloadedBackend, setPreloadedBackend] = useState<BackendInfo | null>(
    null,
  );
  const [preloadedParser, setPreloadedParser] = useState<ParserInfo | null>(
    null,
  );
  const [hwLoading, setHwLoading] = useState(false);
  const [hwReady, setHwReady] = useState(false);
  const hwPromiseRef = useRef<Promise<void> | null>(null);
  const [activePath, setActivePath] = useState<'simple' | 'advanced' | 'custom' | null>(null);

  const fetchHardware = useCallback(() => {
    if (hwPromiseRef.current) return hwPromiseRef.current;
    setHwLoading(true);
    setHwReady(false);
    hwPromiseRef.current = Promise.all([
      window.electronAPI
        .getBackendInfo()
        .then((info) => setPreloadedBackend(info))
        .catch(() => {}),
      window.electronAPI
        .getParserInfo()
        .then((info) => setPreloadedParser(info))
        .catch(() => {}),
    ])
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        setHwLoading(false);
        setHwReady(true);
      });
    // Safety timeout: never leave spinner stuck if probe hangs
    const timeout = window.setTimeout(() => setHwReady(true), 8000);
    hwPromiseRef.current.finally(() => window.clearTimeout(timeout));
    return hwPromiseRef.current;
  }, []);

  const openOnboarding = useCallback(() => {
    setClosing(false);
    setOpen(true);
    // Clear any stale session data and block first render until probe resolves
    setPreloadedBackend(null);
    setPreloadedParser(null);
    setHwLoading(false);
    setHwReady(false);
    setActivePath(null);
    setLayers([]);
    hwPromiseRef.current = null;
    fetchHardware().finally(() => {
      idRef.current += 1;
      setLayers([{ id: idRef.current, step: 'setup', phase: 'enter' }]);
    });
  }, [fetchHardware]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRestartOnboarding(openOnboarding);
    return unsubscribe;
  }, [openOnboarding]);

  const closeOnboarding = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      // Discard temporary session cache
      setPreloadedBackend(null);
      setPreloadedParser(null);
      setHwLoading(false);
      setHwReady(false);
      setActivePath(null);
      hwPromiseRef.current = null;
      setLayers([]);
    }, CLOSE_MS);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onCancelOnboarding(closeOnboarding);
    return unsubscribe;
  }, [closeOnboarding]);

  const navigate = useCallback((target: Step) => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (!top || top.step === target) return prev;
      idRef.current += 1;
      return [
        ...prev.map((layer): PageLayer => ({ ...layer, phase: 'exit' })),
        { id: idRef.current, step: target, phase: 'enter' },
      ];
    });

    window.setTimeout(() => {
      setLayers((prev) => {
        const remaining = prev.filter((layer) => layer.phase !== 'exit');
        return remaining.map(
          (layer): PageLayer =>
            layer.phase === 'enter' ? { ...layer, phase: 'settle' } : layer,
        );
      });
    }, EXIT_MS);
  }, []);

  const handleBegin = useCallback(
    (id: string) => {
      if (id === 'simple') {
        setActivePath('simple');
        navigate('professions');
      } else if (id === 'custom') {
        setActivePath('custom');
        navigate('backend');
      } else {
        // 'advanced'
        setActivePath('advanced');
        navigate('system');
      }
    },
    [navigate],
  );

  const renderPage = (layer: PageLayer) => {
    const isAdvanced = activePath === 'advanced';
    const isCustom = activePath === 'custom';
    switch (layer.step) {
      case 'professions':
        return (
          <ProfessionsSetupPage
            onBack={() =>
              navigate(
                isCustom ? 'security' : isAdvanced ? 'system' : 'setup',
              )
            }
            onContinue={() =>
              navigate(isAdvanced || isCustom ? 'chatSetup' : 'llamaSetup')
            }
          />
        );
      case 'backend':
        return (
          <BackendSetupPage
            preloaded={preloadedBackend}
            preloadedLoading={hwLoading}
            onBack={() => navigate('setup')}
            onContinue={() => navigate('parser')}
          />
        );
      case 'parser':
        return (
          <ParserSetupPage
            preloaded={preloadedParser}
            preloadedLoading={hwLoading}
            onBack={() => navigate('backend')}
            onContinue={() => navigate('system')}
          />
        );
      case 'system':
        return (
          <SystemSetupPage
            onBack={() => navigate(isCustom ? 'parser' : 'setup')}
            onContinue={() =>
              navigate(isCustom ? 'server' : 'professions')
            }
          />
        );
      case 'server':
        return (
          <ServerSetupPage
            onBack={() => navigate('system')}
            onContinue={() => navigate('security')}
          />
        );
      case 'security':
        return (
          <SecuritySetupPage
            onBack={() => navigate('server')}
            onContinue={() => navigate('professions')}
          />
        );
      case 'chatSetup':
        return (
          <ChatSetupPage
            onBack={() => navigate('professions')}
            onContinue={() => navigate('llamaSetup')}
          />
        );
      case 'llamaSetup':
        return (
          <LlamaSetupPage
            onBack={() =>
              navigate(
                isAdvanced || isCustom ? 'chatSetup' : 'professions',
              )
            }
          />
        );
      case 'setup':
      default:
        return <SetupExperiencePage onBegin={handleBegin} />;
    }
  };

  if (!open) return null;

  const showLoading = !hwReady && layers.length === 0;

  return (
    <div className={`onb-root${closing ? ' onb-root--closing' : ''}`}>
      <div className="onb-topbar-actions">
        <DownloadManager />
      </div>

      {showLoading ? (
        <div className="onb-loading">
          <span className="onb-loading-spinner" aria-hidden="true" />
          <p className="onb-loading-text">Detecting hardware…</p>
        </div>
      ) : (
        layers.map((layer) => (
          <div key={layer.id} className={`onb-layer onb-layer--${layer.phase}`}>
            {renderPage(layer)}
          </div>
        ))
      )}
    </div>
  );
}
