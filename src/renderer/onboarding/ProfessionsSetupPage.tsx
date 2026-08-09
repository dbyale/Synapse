import { useState } from 'react';
import {
  ArrowLeft,
  CircleQuestionMark,
  Languages,
  FileText,
  PencilLine,
  SquareLibrary,
  BookSearch,
  FileBracesCorner,
  Check,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Profession {
  id: string;
  label: string;
  icon: LucideIcon;
}

const PROFESSIONS: Profession[] = [
  { id: 'qa', label: 'Q&A', icon: CircleQuestionMark },
  { id: 'translation', label: 'Translation', icon: Languages },
  { id: 'business', label: 'Business', icon: FileText },
  { id: 'writing', label: 'Writing', icon: PencilLine },
  { id: 'education', label: 'Education', icon: SquareLibrary },
  { id: 'research', label: 'Research', icon: BookSearch },
  { id: 'development', label: 'Development', icon: FileBracesCorner },
];

export default function ProfessionsSetupPage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleProfession = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="onb-page onb-professions-page">
      <button
        type="button"
        aria-label="Back to setup experience"
        className="onb-back-arrow onb-rise"
        onClick={onBack}
      >
        <ArrowLeft size={18} strokeWidth={2} />
      </button>

      <div className="onb-professions">
        <div className="onb-professions-info">
          <h1 className="onb-professions-title onb-rise onb-delay-1">
            What will you use Synapse for?
          </h1>
          <p className="onb-professions-text onb-rise onb-delay-2">
            Tell us a bit about the kind of work you do, and we&apos;ll suggest
            the AI models and tools that fit you best.
          </p>
          <p className="onb-professions-note onb-rise onb-delay-3">
            Your answers aren&apos;t collected or sent anywhere. This
            information is only used locally to generate suggestions for which
            AI models and tools might suit you.
          </p>
        </div>

        <div className="onb-professions-right">
          <p className="onb-professions-hint onb-rise onb-delay-1">
            Select as many as you like.
          </p>
          <div className="onb-profession-grid">
            {PROFESSIONS.map((profession, index) => {
              const Icon = profession.icon;
              const isSelected = selected.has(profession.id);
              return (
                <button
                  type="button"
                  key={profession.id}
                  className={`onb-profession onb-rise onb-delay-${
                    (index % 3) + 2
                  }${isSelected ? ' onb-profession--selected' : ''}`}
                  onClick={() => toggleProfession(profession.id)}
                >
                  <span className="onb-profession-icon">
                    <Icon size={24} strokeWidth={2} />
                  </span>
                  <span className="onb-profession-label">
                    {profession.label}
                  </span>
                  <span className="onb-profession-check">
                    {isSelected && <Check size={14} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="onb-professions-footer onb-rise onb-delay-4">
        <button type="button" className="onb-continue" onClick={onContinue}>
          Continue
          <ArrowRight size={20} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
