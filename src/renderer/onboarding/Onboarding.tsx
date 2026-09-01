import { useCallback, useEffect, useRef, useState } from 'react';
import SetupExperiencePage from './SetupExperiencePage';
import ProfessionsSetupPage from './ProfessionsSetupPage';
import BackendSetupPage from './BackendSetupPage';
import ParserSetupPage from './ParserSetupPage';
import LlamaSetupPage from './LlamaSetupPage';
import DownloadManager from '../components/DownloadManager';
import type { BackendInfo, ParserInfo } from '../preload.d';
import './onboarding.css';

type Step = 'setup' | 'professions' | 'backend' | 'parser' | 'llamaSetup';

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
  // Prefetched when the first onboarding page opens so Backend/Parser
  // pages can reuse it instead of re-issuing IPC.
  const [preloadedBackend, setPreloadedBackend] = useState<BackendInfo | null>(
    null,
  );
  const [preloadedParser, setPreloadedParser] = useState<ParserInfo | null>(
    null,
  );
  const [hwLoading, setHwLoading] = useState(false);
  const hwPromiseRef = useRef<Promise<void> | null>(null);

  const fetchHardware = useCallback(() => {
    if (hwPromiseRef.current) return hwPromiseRef.current;
    setHwLoading(true);
    // Defer to next idle period so the first paint / transition is not janked.
    // Using setTimeout yields to the browser's render cycle before IPC
    // hits the main process's heavy si.graphics / exec work.
    hwPromiseRef.current = new Promise<void>((resolve) => {
      const run = () => {
        Promise.all([
          window.electronAPI
            .getBackendInfo()
            .then((info) => setPreloadedBackend(info))
            .catch(() => {}),
          window.electronAPI
            .getParserInfo()
            .then((info) => setPreloadedParser(info))
            .catch(() => {}),
        ]).finally(() => {
          setHwLoading(false);
          resolve();
        });
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 300 });
      } else {
        // 150ms lets EXIT_MS animation + first frame settle
        window.setTimeout(run, 150);
      }
    });
    return hwPromiseRef.current;
  }, []);

  const openOnboarding = useCallback(() => {
    idRef.current += 1;
    setLayers([{ id: idRef.current, step: 'setup', phase: 'enter' }]);
    setClosing(false);
    setOpen(true);
    // Clear any stale session data and start background detection
    setPreloadedBackend(null);
    setPreloadedParser(null);
    setHwLoading(false);
    hwPromiseRef.current = null;
    // Defer so SetupExperiencePage paints before heavy IPC
    fetchHardware();
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
      hwPromiseRef.current = null;
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

  const renderPage = (layer: PageLayer) => {
    switch (layer.step) {
      case 'professions':
        return (
          <ProfessionsSetupPage
            onBack={() => navigate('setup')}
            onContinue={() => navigate('llamaSetup')}
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
            onContinue={() => navigate('professions')}
          />
        );
      case 'llamaSetup':
        return <LlamaSetupPage onBack={() => navigate('setup')} />;
      case 'setup':
      default:
        return (
          <SetupExperiencePage
            onBegin={(id) => {
              if (id === 'simple') navigate('professions');
              else if (id === 'custom') navigate('backend');
              else navigate('llamaSetup');
            }}
          />
        );
    }
  };

  if (!open) return null;

  return (
    <div className={`onb-root${closing ? ' onb-root--closing' : ''}`}>
      <div className="onb-topbar-actions">
        <DownloadManager />
      </div>

      {layers.map((layer) => (
        <div key={layer.id} className={`onb-layer onb-layer--${layer.phase}`}>
          {renderPage(layer)}
        </div>
      ))}
    </div>
  );
}
