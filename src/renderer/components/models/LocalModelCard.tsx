import React, { useState, useMemo } from 'react';
import {
  Trash2,
  Cpu,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import type { LocalModel } from '../../preload.d';
import {
  formatBytes,
  getAvatarColor,
  getInitials,
} from '../../utils/formatters';
import { getCompanyLogoComponent } from '../../utils/companyLogos';
import { parseQuantization } from '../../utils/quantizationDescriptions';

export interface ExtendedLocalModel extends LocalModel {
  architecture?: string;
  parameters?: string;
  activeParameters?: string;
  contextLength?: number;
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

// ── Extract Parameters from Model Name ──
function extractParametersFromName(modelName: string): string | null {
  const name = modelName.toUpperCase();

  // Match patterns like: 8B, 70B, 1.5B, etc.
  // Also match MoE patterns: 8x7B, 26B-A4B, 14B-A2.7B
  const patterns = [
    /[-_](\d+\.?\d*[BM][-]?A\d+\.?\d*[BM])(?:[-_]|$)/i, // MoE with -A format (e.g., 26B-A4B)
    /[-_](\d+X\d+\.?\d*[BM])(?:[-_]|$)/i, // MoE with X format (e.g., 8X7B)
    /[-_]([A-Za-z]\d+\.?\d*[BM])(?:[-_]|$)/i, // Letter-prefixed format (e.g., E4B)
    /[-_](\d+\.?\d*[BM])(?:[-_]|$)/i, // Standard format (e.g., 8B, 1.5B)
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

function extractQuantizationFromFilename(filename: string): string {
  // Remove mmproj- prefix if present
  const cleanFilename = filename.replace(/^mmproj-/i, '').toUpperCase();

  // Extract quantization suffix like -Q6_K, -f16, etc.
  const match = cleanFilename.match(
    /-(Q\d+_K|F\d+|Q\d+|I\d+|A\d+B)(?:\.gguf)?$/i,
  );
  return match ? match[1] : 'Unknown';
}

// ── Extract author from model name ──
function extractAuthor(modelName: string): string {
  const parts = modelName.split('/');
  return parts.length > 1 ? parts[0] : modelName.split('-')[0] || modelName;
}

// ── Parse Parameters & MoE Detection ──
function getParameterTooltip(params: string) {
  const upperParams = params.toUpperCase();
  const details: string[] = [];

  // Check for "-A" format (e.g., 26B-A4B or 14B-A2.7B)
  const aMatch = upperParams.match(/^([0-9.]+[BM])-A([0-9.]+[BM])$/);
  // Check for "x" format (e.g., 8X7B)
  const xMatch = upperParams.match(/^([0-9]+)X([0-9.]+[BM])$/);

  if (aMatch) {
    details.push('Architecture: Mixture of Experts (MoE)');
    details.push(`Total Parameters: ${aMatch[1]}`);
    details.push(`Active Parameters: ${aMatch[2]} (used per token)`);
  } else if (xMatch) {
    details.push('Architecture: Mixture of Experts (MoE)');
    details.push(`Experts: ${xMatch[1]} experts of ${xMatch[2]} each`);
    details.push('Active Parameters: Fraction used per token');
  } else {
    details.push('Architecture: Dense (All parameters active)');
  }

  return {
    title: `Size: ${upperParams}`,
    details,
    text: "Represents the neural network's complexity. Higher parameters typically yield better reasoning and accuracy, but require more RAM and processing power to run.",
  };
}

export default function LocalModelCard({
  group,
  onDelete,
  onSearchModel,
}: LocalModelCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Extract parameters from model name if not explicitly provided
  const parameters = useMemo(() => {
    return group.parameters || extractParametersFromName(group.name);
  }, [group.parameters, group.name]);

  const paramTooltip = parameters ? getParameterTooltip(parameters) : null;
  const author = extractAuthor(group.name);
  const LogoComponent = getCompanyLogoComponent(group.name);

  return (
    <div className="model-card">
      <button
        type="button"
        className={`model-card__header ${isExpanded ? 'model-card__header--expanded' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="model-card__left">
          <div
            className="model-card__avatar"
            style={{
              background: LogoComponent
                ? '#333333'
                : `${getAvatarColor(author)}25`,
              color: LogoComponent ? '#ffffff' : getAvatarColor(author),
            }}
            title={author}
          >
            {LogoComponent ? (
              <LogoComponent className="model-card__avatar-img" />
            ) : (
              getInitials(author)
            )}
          </div>

          <div className="model-card__text">
            <span className="model-card__name">{group.name}</span>

            <div className="model-card__meta">
              {parameters && paramTooltip && (
                <div className="model-card__meta-tooltip-wrapper">
                  <span className="model-card__meta-item">
                    <Cpu size={14} /> {parameters}
                  </span>
                  <div className="local-model-card__meta-tooltip">
                    <div className="model-card__meta-tooltip-title">
                      {paramTooltip.title}
                    </div>
                    {paramTooltip.details.length > 0 && (
                      <ul
                        className="model-card__dl-tooltip-list"
                        style={{ marginBottom: '6px' }}
                      >
                        {paramTooltip.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    )}
                    <div className="model-card__meta-tooltip-text">
                      {paramTooltip.text}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {isExpanded && (
        <div className="model-card__expanded">
          {/* ── HuggingFace Link Section ── */}
          <div className="local-group-card__hf-section">
            <button
              type="button"
              className="local-group-card__hf-link"
              onClick={(e) => {
                e.stopPropagation();
                onSearchModel(group.name);
              }}
              title={`Search for ${group.name} on HuggingFace`}
            >
              <ExternalLink size={14} />
              Search on HuggingFace
            </button>
          </div>

          {/* ── Variants ── */}
          <div className="local-group-card__variants">
            {group.fileGroups.map((fg) => {
              const displayQuantization = fg.isProjector
                ? extractQuantizationFromFilename(fg.parts[0].filename)
                : fg.quantization;

              const quantInfo = parseQuantization(
                fg.id,
                displayQuantization,
                fg.isProjector,
              );

              if (fg.parts.length > 1) {
                quantInfo.details.unshift(
                  `Multi-part file (${fg.parts.length} parts)`,
                );
              }

              return (
                <div key={fg.id} className="local-variant">
                  <div className="local-variant__info">
                    <div className="local-variant__row">
                      <div className="local-variant__quant-wrapper">
                        <span className="local-variant__quant">
                          {fg.isProjector
                            ? `MMPROJ (${displayQuantization.toUpperCase()})`
                            : displayQuantization.toUpperCase()}
                        </span>
                        <div className="local-variant__quant-tooltip">
                          <div className="model-card__dl-tooltip-title">
                            {quantInfo.filename}
                          </div>
                          {quantInfo.details.length > 0 && (
                            <ul className="model-card__dl-tooltip-list">
                              {quantInfo.details.map((detail) => (
                                <li key={detail}>{detail}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      <span className="local-variant__size">
                        {formatBytes(fg.totalSize)}
                      </span>
                    </div>
                    <div className="local-variant__files">
                      {fg.parts.map((p) => p.filename).join(', ')}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="local-variant__delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(fg.parts.map((p) => p.filepath));
                    }}
                    title="Delete this variant"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
