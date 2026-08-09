import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Zap, HardDrive, CodeXml, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactComponent as SynapseMark } from '../../../assets/icon.svg';

interface SetupOption {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  description: ReactNode;
}

const SETUP_OPTIONS: SetupOption[] = [
  {
    id: 'simple',
    label: 'Simple',
    icon: Zap,
    color: '#4ade80',
    description: (
      <>
        The quickest and easiest way to setup Synapse, advanced options can
        always be configured later.{' '}
        <span className="onb-option-recommended">
          Recommended for most users.
        </span>
      </>
    ),
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: HardDrive,
    color: '#fbbf24',
    description:
      'Display some additional setup options, such as choosing your install location or GPU.',
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: CodeXml,
    color: '#f87171',
    description:
      'Shows all setup options, allowing you to skip installing unwanted components, or set up custom parsers or binaries.',
  },
];

export default function SetupExperiencePage({
  onBegin,
}: {
  onBegin: (id: string) => void;
}) {
  return (
    <div className="onb-page">
      <div className="onb-panel">
        <div className="onb-hero">
          <div className="onb-hero-image onb-rise">
            <SynapseMark className="onb-hero-logo" />
          </div>
          <h1 className="onb-hero-title onb-rise onb-delay-1">
            Welcome to Synapse
          </h1>
          <p className="onb-hero-text onb-rise onb-delay-2">
            The fundamentally free AI Platform that runs on your device. Your
            data stays with you, and setup only takes a second.
          </p>
        </div>

        <div className="onb-options">
          <p className="onb-options-heading onb-rise onb-delay-1">
            Select your setup experience.
          </p>
          {SETUP_OPTIONS.map((option, index) => {
            const Icon: ComponentType<{
              size?: number;
              strokeWidth?: number;
            }> = option.icon;
            return (
              <button
                type="button"
                key={option.id}
                className={`onb-option onb-rise onb-delay-${index + 2}`}
                style={{ '--onb-color': option.color } as CSSProperties}
                onClick={() => onBegin(option.id)}
              >
                <span
                  className="onb-option-icon"
                  style={{
                    background: `${option.color}26`,
                    color: option.color,
                  }}
                >
                  <Icon size={22} strokeWidth={2} />
                </span>
                <span className="onb-option-body">
                  <span className="onb-option-title">{option.label}</span>
                  <span className="onb-option-desc">{option.description}</span>
                </span>
                <span
                  className="onb-option-arrow"
                  style={{ color: option.color }}
                >
                  <ArrowRight size={20} strokeWidth={2} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
