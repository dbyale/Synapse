import { useState, KeyboardEvent, MouseEvent } from 'react';
import { AlertTriangle, ListChecks, HelpCircle, X } from 'lucide-react';
import './styles/UserInputModal.css';

interface UserInputModalProps {
  type: 'confirm' | 'select' | 'freeform';
  prompt: string;
  options?: string[];
  allowOther?: boolean;
  toolName: string;
  toolParams: any;
  onResponse: (response: { action: 'confirmed' | 'denied' | 'selected'; value?: string }) => void;
}

export default function UserInputModal({
  type,
  prompt,
  options,
  allowOther,
  toolName,
  toolParams,
  onResponse,
}: UserInputModalProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onResponse({ action: 'denied' });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onResponse({ action: 'denied' });
  };

  if (type === 'confirm') {
    return (
      <div className="uim-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} role="dialog" aria-modal="true">
        <div className="uim-dialog">
          <div className="uim-header">
            <AlertTriangle size={20} className="uim-warning-icon" />
            <h2 className="uim-title">Action Required</h2>
            <button type="button" className="uim-close" onClick={() => onResponse({ action: 'denied' })} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="uim-body">
            <div className="uim-tool-name">Tool: {toolName}</div>
            <p className="uim-prompt">{prompt}</p>
            {toolParams?.command && (
              <code className="uim-command">{toolParams.command}</code>
            )}
          </div>
          <div className="uim-actions">
            <button type="button" className="uim-btn uim-btn--deny" onClick={() => onResponse({ action: 'denied' })}>
              Deny
            </button>
            <button type="button" className="uim-btn uim-btn--confirm" onClick={() => onResponse({ action: 'confirmed' })}>
              Allow
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'select' || type === 'freeform') {
    const handleSubmit = () => {
      if (showCustomInput && customValue.trim()) {
        onResponse({ action: 'selected', value: customValue.trim() });
      } else if (selectedOption) {
        onResponse({ action: 'selected', value: selectedOption });
      }
    };

    return (
      <div className="uim-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} role="dialog" aria-modal="true">
        <div className="uim-dialog">
          <div className="uim-header">
            {type === 'select' ? <ListChecks size={20} /> : <HelpCircle size={20} />}
            <h2 className="uim-title">{toolName}</h2>
            <button type="button" className="uim-close" onClick={() => onResponse({ action: 'denied' })} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="uim-body">
            <p className="uim-prompt">{prompt}</p>
            {options && options.length > 0 && (
              <div className="uim-options">
                {options.map((opt) => (
                  <label key={opt} className={`uim-option${selectedOption === opt ? ' uim-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="uim-select"
                      value={opt}
                      checked={selectedOption === opt}
                      onChange={() => { setSelectedOption(opt); setShowCustomInput(false); }}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
                {allowOther && (
                  <label className={`uim-option${showCustomInput ? ' uim-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="uim-select"
                      checked={showCustomInput}
                      onChange={() => { setShowCustomInput(true); setSelectedOption(null); }}
                    />
                    <span>Other...</span>
                  </label>
                )}
              </div>
            )}
            {showCustomInput && (
              <input
                type="text"
                className="uim-custom-input"
                placeholder="Type your answer..."
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                autoFocus
              />
            )}
            {type === 'freeform' && !options && (
              <input
                type="text"
                className="uim-custom-input"
                placeholder="Type your answer..."
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                autoFocus
              />
            )}
          </div>
          <div className="uim-actions">
            <button type="button" className="uim-btn uim-btn--deny" onClick={() => onResponse({ action: 'denied' })}>
              Skip
            </button>
            <button
              type="button"
              className="uim-btn uim-btn--confirm"
              onClick={handleSubmit}
              disabled={!selectedOption && !(showCustomInput && customValue.trim()) && !(type === 'freeform' && !options && !customValue.trim())}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
