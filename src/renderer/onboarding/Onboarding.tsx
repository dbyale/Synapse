import { useCallback, useEffect, useRef, useState } from 'react';
import SetupExperiencePage from './SetupExperiencePage';
import ProfessionsSetupPage from './ProfessionsSetupPage';
import BackendSetupPage from './BackendSetupPage';
import SystemSetupPage from './SystemSetupPage';
import PythonSetupPage from './PythonSetupPage';
import ServerSetupPage from './ServerSetupPage';
import SecuritySetupPage from './SecuritySetupPage';
import ChatSetupPage from './ChatSetupPage';
import LlamaSetupPage from './LlamaSetupPage';
import ProfileSelectionPage from './ProfileSelectionPage';
import ModelDownloadPage from './ModelDownloadPage';
import DownloadManager from '../components/DownloadManager';
import {
  buildSelection,
  clearOnboardingProfileSelection,
  getCategoriesForSelection,
  writeOnboardingProfileSelection,
  type OnboardingProfileSelection,
} from './profileCatalog';
import type { BackendInfo } from '../preload.d';
import './onboarding.css';

type Step =
  | 'setup'
  | 'professions'
  | 'profileSelection'
  | 'modelDownload'
  | 'backend'
  | 'system'
  | 'python'
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
  const [hwLoading, setHwLoading] = useState(false);
  const [hwReady, setHwReady] = useState(false);
  const hwPromiseRef = useRef<Promise<void> | null>(null);
  const [activePath, setActivePath] = useState<
    'simple' | 'advanced' | 'custom' | null
  >(null);
  const [professionIds, setProfessionIds] = useState<string[]>([]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);

  const fetchHardware = useCallback(() => {
    if (hwPromiseRef.current) return hwPromiseRef.current;
    setHwLoading(true);
    setHwReady(false);
    hwPromiseRef.current = Promise.all([
      window.electronAPI
        .getBackendInfo()
        .then((info) => setPreloadedBackend(info))
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
    hwPromiseRef.current
      .finally(() => window.clearTimeout(timeout))
      .catch(() => undefined);
    return hwPromiseRef.current;
  }, []);

  const openOnboarding = useCallback(() => {
    setClosing(false);
    setOpen(true);
    // Clear any stale session data and block first render until probe resolves
    setPreloadedBackend(null);
    setHwLoading(false);
    setHwReady(false);
    setActivePath(null);
    clearOnboardingProfileSelection();
    setProfessionIds([]);
    setSelectedOptionIds([]);
    setLayers([]);
    hwPromiseRef.current = null;
    fetchHardware()
      .finally(() => {
        idRef.current += 1;
        setLayers([{ id: idRef.current, step: 'setup', phase: 'enter' }]);
      })
      .catch(() => undefined);
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
      setHwLoading(false);
      setHwReady(false);
      setActivePath(null);
      setProfessionIds([]);
      setSelectedOptionIds([]);
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

  const handleProfessionsContinue = useCallback(() => {
    if (activePath === 'advanced' || activePath === 'custom') {
      navigate('chatSetup');
      return;
    }

    const visibleOptionIds = new Set(
      getCategoriesForSelection(professionIds).flatMap((category) =>
        category.options.map((option) => option.id),
      ),
    );
    setSelectedOptionIds((previous) =>
      previous.filter((id) => visibleOptionIds.has(id)),
    );
    navigate('profileSelection');
  }, [activePath, navigate, professionIds]);

  const handleProfileSelectionContinue = useCallback(
    (selection: OnboardingProfileSelection) => {
      setProfessionIds(selection.professionIds);
      setSelectedOptionIds(selection.optionIds);
      writeOnboardingProfileSelection(selection);
      navigate('modelDownload');
    },
    [navigate],
  );

  const handleDiscardProfiles = useCallback(
    (optionIdsToDiscard: string[]) => {
      const discarded = new Set(optionIdsToDiscard);
      const next = selectedOptionIds.filter(
        (optionId) => !discarded.has(optionId),
      );
      setSelectedOptionIds(next);
      writeOnboardingProfileSelection(buildSelection(professionIds, next));
    },
    [professionIds, selectedOptionIds],
  );

  const renderPage = (layer: PageLayer) => {
    const isAdvanced = activePath === 'advanced';
    const isCustom = activePath === 'custom';
    switch (layer.step) {
      case 'professions':
        return (
          <ProfessionsSetupPage
            selectedProfessionIds={professionIds}
            onSelectedProfessionIdsChange={setProfessionIds}
            onBack={() => {
              if (isCustom) navigate('security');
              else if (isAdvanced) navigate('system');
              else navigate('setup');
            }}
            onContinue={handleProfessionsContinue}
          />
        );
      case 'profileSelection':
        return (
          <ProfileSelectionPage
            professionIds={professionIds}
            selectedOptionIds={selectedOptionIds}
            onSelectedOptionIdsChange={setSelectedOptionIds}
            requireSelection={!isAdvanced && !isCustom}
            onBack={() => navigate('professions')}
            onContinue={handleProfileSelectionContinue}
          />
        );
      case 'modelDownload':
        return (
          <ModelDownloadPage
            optionIds={selectedOptionIds}
            onBack={() => navigate('profileSelection')}
            onContinue={() => navigate('llamaSetup')}
            onDiscardProfiles={handleDiscardProfiles}
          />
        );
      case 'backend':
        return (
          <BackendSetupPage
            preloaded={preloadedBackend}
            preloadedLoading={hwLoading}
            onBack={() => navigate('setup')}
            onContinue={() => navigate('system')}
          />
        );
      case 'system':
        return (
          <SystemSetupPage
            onBack={() => navigate(isCustom ? 'backend' : 'setup')}
            onContinue={() => navigate('python')}
          />
        );
      case 'python':
        return (
          <PythonSetupPage
            onBack={() => navigate('system')}
            onContinue={() => navigate(isCustom ? 'server' : 'professions')}
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
              navigate(isAdvanced || isCustom ? 'chatSetup' : 'modelDownload')
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
