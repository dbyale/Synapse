import { MouseEvent, KeyboardEvent } from 'react';
import { X, Check } from 'lucide-react';
import { formatBytes } from '../utils/formatters';
import './styles/ProjectorSelectModal.css';

interface ProjectorData {
  filename: string;
  quantization: string;
  sizeBytes: number;
}

interface ProjectorSelectModalProps {
  projectors: ProjectorData[];
  selectedFilename: string;
  onSelect: (filename: string) => void;
  onClose: () => void;
}

export default function ProjectorSelectModal({
  projectors,
  selectedFilename,
  onSelect,
  onClose,
}: ProjectorSelectModalProps) {
  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="prsm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Select a projector"
    >
      <div className="prsm-dialog">
        <div className="prsm-header">
          <h2>Select Projector (Optional)</h2>
          <button
            type="button"
            className="prsm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="prsm-list">
          <button
            type="button"
            className={`prsm-card prsm-card--none${selectedFilename === '' ? ' prsm-card--selected' : ''}`}
            onClick={() => {
              onSelect('');
              onClose();
            }}
          >
            None
          </button>
          {projectors.map((proj) => (
            <button
              key={proj.filename}
              type="button"
              className={`prsm-card${selectedFilename === proj.filename ? ' prsm-card--selected' : ''}`}
              onClick={() => {
                onSelect(proj.filename);
                onClose();
              }}
            >
              <span className="prsm-card__quant">
                {proj.quantization.toUpperCase()}
              </span>
              <span className="prsm-card__size">
                {formatBytes(proj.sizeBytes)}
              </span>
              <span className="prsm-card__filename">{proj.filename}</span>
              {selectedFilename === proj.filename && (
                <Check size={16} className="prsm-card__check" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
