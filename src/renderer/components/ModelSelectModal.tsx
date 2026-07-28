import { useState, MouseEvent, KeyboardEvent, ChangeEvent } from 'react';
import { X, Check, Search, Cpu } from 'lucide-react';
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
  onSelect: (filename: string, groupName: string) => void;
  onClose: () => void;
}

function extractParametersFromName(modelName: string): string | null {
  const name = modelName.toUpperCase();
  const patterns = [
    /[-_](\d+\.?\d*[BM][-]?A\d+\.?\d*[BM])(?:[-_]|$)/i,
    /[-_](\d+X\d+\.?\d*[BM])(?:[-_]|$)/i,
    /[-_]([A-Za-z]\d+\.?\d*[BM])(?:[-_]|$)/i,
    /[-_](\d+\.?\d*[BM])(?:[-_]|$)/i,
  ];
  const patternIndex = patterns.findIndex((pattern) => name.match(pattern));
  if (patternIndex !== -1) {
    const match = name.match(patterns[patternIndex]);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

export default function ModelSelectModal({
  groups,
  selectedFilename,
  onSelect,
  onClose,
}: ModelSelectModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

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

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const query = searchQuery.toLowerCase();

  const filteredGroups = query
    ? groups
        .map((group) => {
          const matchingVariants = group.variants.filter(
            (v) =>
              v.filename.toLowerCase().includes(query) ||
              v.quantization.toLowerCase().includes(query) ||
              group.name.toLowerCase().includes(query),
          );
          return { ...group, variants: matchingVariants };
        })
        .filter((g) => g.variants.length > 0)
    : groups;

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

        <div className="msm-search">
          <Search size={16} className="msm-search__icon" />
          <input
            type="text"
            className="msm-search__input"
            placeholder="Search models..."
            value={searchQuery}
            onChange={handleSearchChange}
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              className="msm-search__clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="msm-list">
          {filteredGroups.length === 0 ? (
            <div className="msm-empty">
              {query ? 'No models match your search.' : 'No models available.'}
            </div>
          ) : (
            filteredGroups.map((group) => {
              const parameters = extractParametersFromName(group.name);
              return (
                <div key={group.name} className="msm-group">
                  <button
                    type="button"
                    className="msm-group-header"
                    onClick={() => {
                      if (group.variants.length > 0) {
                        onSelect(group.variants[0].filename, group.name);
                        onClose();
                      }
                    }}
                  >
                    <h3>{group.name}</h3>
                    {parameters && (
                      <span className="model-card__meta-item">
                        <Cpu size={14} /> {parameters}
                      </span>
                    )}
                  </button>
                  {group.variants.map((variant) => (
                    <button
                      key={variant.filename}
                      type="button"
                      className={`msm-variant${selectedFilename === variant.filename ? ' msm-variant--selected' : ''}`}
                      onClick={() => {
                        onSelect(variant.filename, group.name);
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
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
