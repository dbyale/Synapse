import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import SetupExperiencePage from './SetupExperiencePage';
import ProfessionsSetupPage from './ProfessionsSetupPage';
import LlamaSetupPage from './LlamaSetupPage';
import './onboarding.css';

type Step = 'setup' | 'professions' | 'llamaSetup';

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

  const openOnboarding = useCallback(() => {
    idRef.current += 1;
    setLayers([{ id: idRef.current, step: 'setup', phase: 'enter' }]);
    setClosing(false);
    setOpen(true);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRestartOnboarding(openOnboarding);
    return unsubscribe;
  }, [openOnboarding]);

  const closeOnboarding = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
  }, []);

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
      case 'llamaSetup':
        return <LlamaSetupPage onBack={() => navigate('setup')} />;
      case 'setup':
      default:
        return (
          <SetupExperiencePage
            onBegin={(id) =>
              navigate(id === 'simple' ? 'professions' : 'llamaSetup')
            }
          />
        );
    }
  };

  if (!open) return null;

  return (
    <div className={`onb-root${closing ? ' onb-root--closing' : ''}`}>
      <button
        type="button"
        aria-label="Close onboarding"
        className="onb-close"
        onClick={closeOnboarding}
      >
        <X size={20} strokeWidth={2} />
      </button>

      {layers.map((layer) => (
        <div key={layer.id} className={`onb-layer onb-layer--${layer.phase}`}>
          {renderPage(layer)}
        </div>
      ))}
    </div>
  );
}
