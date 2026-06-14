import { MouseEvent, KeyboardEvent } from 'react';
import { X, Check } from 'lucide-react';
import { formatBytes } from '../utils/formatters';
import './styles/ModelSelectModal.css';

interface VariantData {
  filename: string;
  quantization: string;
  sizeBytes: number;
}

interface GroupData {
  name: string;
  totalSize: number;
  variants: VariantData[];
}

interface ModelSelectModalProps {
  groups: GroupData[];
  selectedFilename: string;
  onSelect: (filename: string) => void;
  onClose: () => void;
}

export default function ModelSelectModal({
  groups,
  selectedFilename,
  onSelect,
  onClose,
}: ModelSelectModalProps) {
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
      className="msm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Select a model"
    >
      <div className="msm-dialog">
        <div className="msm-header">
          <h2>Select Model</h2>
          <button
            type="button"
            className="msm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="msm-list">
          {groups.length === 0 ? (
            <div className="msm-empty">No models available.</div>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="msm-group">
                <button
                  type="button"
                  className="msm-group-header"
                  onClick={() => {
                    if (group.variants.length > 0) {
                      onSelect(group.variants[0].filename);
                      onClose();
                    }
                  }}
                >
                  <h3>{group.name}</h3>
                  <span className="msm-group-size">
                    {formatBytes(group.totalSize)}
                  </span>
                </button>
                {group.variants.map((variant) => (
                  <button
                    key={variant.filename}
                    type="button"
                    className={`msm-variant${selectedFilename === variant.filename ? ' msm-variant--selected' : ''}`}
                    onClick={() => {
                      onSelect(variant.filename);
                      onClose();
                    }}
                  >
                    <span className="msm-variant__quant">
                      {variant.quantization.toUpperCase()}
                    </span>
                    <span className="msm-variant__size">
                      {formatBytes(variant.sizeBytes)}
                    </span>
                    <span className="msm-variant__filename">
                      {variant.filename}
                    </span>
                    {selectedFilename === variant.filename && (
                      <Check size={16} className="msm-variant__check" />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
