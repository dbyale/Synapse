import React, { useState } from 'react';
import {
  Trash2,
  Cpu,
  Database,
  Layout,
  Layers,
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { LocalModel } from '../../preload.d';
import { formatBytes } from '../../utils/formatters';

export interface ExtendedLocalModel extends LocalModel {
  generalName?: string;
  architecture?: string;
  quantization?: string;
  parameters?: string;
  activeParameters?: string;
  contextLength?: number;
  isProjector?: boolean;
}

export interface LocalFileGroup {
  id: string;
  quantization: string;
  isProjector: boolean;
  parts: ExtendedLocalModel[];
  totalSize: number;
}

export interface LocalModelGroup {
  name: string;
  architecture?: string;
  parameters?: string;
  activeParameters?: string;
  contextLength?: number;
  fileGroups: LocalFileGroup[];
  totalSize: number;
}

interface LocalModelCardProps {
  group: LocalModelGroup;
  onDelete: (filenames: string[]) => void;
  onSearchModel: (name: string) => void;
}

export default function LocalModelCard({
  group,
  onDelete,
  onSearchModel,
}: LocalModelCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="local-group-card">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={`local-group-card__header ${isExpanded ? 'local-group-card__header--expanded' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className="local-group-card__header-left">
          <button
            type="button"
            className="local-group-card__title-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSearchModel(group.name);
            }}
            title={`Search for ${group.name} on HuggingFace`}
          >
            {group.name}{' '}
            <Search size={16} className="local-group-card__title-icon" />
          </button>

          <div className="local-group-card__meta">
            {group.architecture && (
              <span className="local-group-card__meta-item">
                <Layout size={14} /> {group.architecture}
              </span>
            )}
            {group.parameters && (
              <span className="local-group-card__meta-item">
                <Cpu size={14} /> Params: {group.parameters}
              </span>
            )}
            {group.activeParameters && (
              <span className="local-group-card__meta-item">
                <Layers size={14} /> Active: {group.activeParameters}
              </span>
            )}
            {group.contextLength && (
              <span className="local-group-card__meta-item">
                <Database size={14} /> Context:{' '}
                {group.contextLength.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        <div className="local-group-card__header-right">
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {isExpanded && (
        <div className="local-group-card__variants">
          {group.fileGroups.map((fg) => (
            <div key={fg.id} className="local-variant">
              <div className="local-variant__info">
                <div className="local-variant__row">
                  <span className="local-variant__quant">
                    {fg.isProjector ? 'MMPROJ' : fg.quantization}
                  </span>
                  <span className="local-variant__size">
                    {formatBytes(fg.totalSize)}
                  </span>
                  {fg.parts.length > 1 && (
                    <span className="local-variant__parts">
                      ({fg.parts.length} parts)
                    </span>
                  )}
                </div>
                <div className="local-variant__files">
                  {fg.parts.map((p) => p.filename).join(', ')}
                </div>
              </div>

              <button
                type="button"
                className="local-variant__delete"
                onClick={() => onDelete(fg.parts.map((p) => p.filename))}
                title="Delete this variant"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
