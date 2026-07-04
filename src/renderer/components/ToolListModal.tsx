import { MouseEvent, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import './styles/ToolListModal.css';

interface ToolInfo {
  name: string;
  label: string;
  description: string;
  descriptionForHuman?: string;
  icon?: string;
}

interface ToolListModalProps {
  title: string;
  description?: string;
  tools: ToolInfo[];
  onClose: () => void;
  editTools?: string[];
  onToolToggle?: (key: string) => void;
}

export default function ToolListModal({
  title,
  description,
  tools,
  onClose,
  editTools,
  onToolToggle,
}: ToolListModalProps) {
  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="tlm-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} tools`}
    >
      <div className="tlm-dialog">
        <div className="tlm-header">
          <h2 className="tlm-title">{title}</h2>
          <button type="button" className="tlm-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {description && (
          <div className="tlm-description">{description}</div>
        )}
        <div className="tlm-list">
          {tools.length === 0 ? (
            <div className="tlm-empty">No tools in this extension.</div>
          ) : (
            tools.map((tool, idx) => {
              const isChecked = editTools ? editTools.includes(tool.name) : false;
              return (
                <div
                  key={tool.name || `tool-${idx}`}
                  className={`tlm-tool-row${isChecked ? ' tlm-tool-row--checked' : ''}`}
                >
                  {editTools !== undefined && onToolToggle ? (
                    <label className="tlm-tool-checkbox-label">
                      <input
                        type="checkbox"
                        className="tlm-tool-checkbox"
                        checked={isChecked}
                        onChange={() => onToolToggle(tool.name)}
                      />
                    </label>
                  ) : null}
                  <div className="tlm-tool-info">
                    <div className="tlm-tool-name">{tool.label}</div>
                    <div className="tlm-tool-desc">{tool.descriptionForHuman ?? tool.description}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
