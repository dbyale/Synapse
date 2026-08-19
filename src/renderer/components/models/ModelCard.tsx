import { useMemo } from 'react';
import { ChevronRight, ChevronLeft, Download, Heart, Cpu } from 'lucide-react';
import type { ModelSearchResult } from '../../preload.d';
import { getCompanyLogoComponent } from '../../utils/companyLogos';
import {
  formatCount,
  getAvatarColor,
  getInitials,
} from '../../utils/formatters';
import { PIPELINE_TAG_MAP } from '../../../data/pipelineTags';
import {
  PIPELINE_DESCRIPTIONS,
  FALLBACK_PIPELINE_DESCRIPTION,
} from '../../../data/pipelineDescriptions';

// ── Tags inferred from model name ──
const NAME_TAG_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\bqat\b/i, tag: 'QAT' },
  { pattern: /\binstruct\b/i, tag: 'Instruct' },
  { pattern: /\bchat\b/i, tag: 'Chat' },
  { pattern: /\bvision\b/i, tag: 'Vision' },
  { pattern: /\bcode\b/i, tag: 'Code' },
  { pattern: /\bmoe\b/i, tag: 'MoE' },
  { pattern: /\bfp(?:8|16|32)\b/i, tag: 'FP' },
  { pattern: /\biq[234]\b/i, tag: 'I-Quant' },
];

function detectNameTags(repoId: string): string[] {
  const tags: string[] = [];
  NAME_TAG_PATTERNS.forEach(({ pattern, tag }) => {
    if (pattern.test(repoId) && !tags.includes(tag)) {
      tags.push(tag);
    }
  });
  return tags;
}

const API_TAG_ALLOWLIST: Record<string, string> = {
  thinking: 'Thinking',
  reasoning: 'Reasoning',
  function_calling: 'Function Calling',
  vision: 'Vision',
  code: 'Code',
};

function extractApiTags(apiTags: string[]): string[] {
  const result: string[] = [];
  apiTags.forEach((t) => {
    const label = API_TAG_ALLOWLIST[t];
    if (label && !result.includes(label)) result.push(label);
  });
  return result;
}

// ── Tooltip Strings ──
const TOOLTIP_DOWNLOADS = 'Total downloads on HuggingFace';
const TOOLTIP_LIKES = 'Total likes on HuggingFace';

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

interface ModelCardProps {
  model: ModelSearchResult;
  selected: boolean;
  onSelect: (repoId: string) => void;
}

// ── Presentational header (avatar + name + meta), shared by list + detail panel ──
export function ModelCardHeader({ model }: { model: ModelSearchResult }) {
  const LogoComponent = getCompanyLogoComponent(model.id);

  const pipelineTag =
    model.pipelineTag !== 'none' && model.pipelineTag !== 'unknown'
      ? (PIPELINE_TAG_MAP[model.pipelineTag] ?? null)
      : null;

  const pipelineTooltipText =
    model.pipelineTag && PIPELINE_DESCRIPTIONS[model.pipelineTag]
      ? PIPELINE_DESCRIPTIONS[model.pipelineTag]
      : FALLBACK_PIPELINE_DESCRIPTION;

  const paramTooltip = model.parameters
    ? getParameterTooltip(model.parameters)
    : null;

  const detectedTags = useMemo(() => {
    const nameTags = detectNameTags(model.id);
    const apiTags = extractApiTags(model.tags);
    return [...new Set([...nameTags, ...apiTags])];
  }, [model.id, model.tags]);

  return (
    <div className="model-card__left">
      <div
        className="model-card__avatar"
        style={{
          background: LogoComponent
            ? '#333333'
            : `${getAvatarColor(model.author)}25`,
          color: LogoComponent ? '#ffffff' : getAvatarColor(model.author),
        }}
        title={model.author}
      >
        {LogoComponent ? (
          <LogoComponent className="model-card__avatar-img" />
        ) : (
          getInitials(model.author)
        )}
      </div>

      <div className="model-card__text">
        <span className="model-card__name">{model.id}</span>

        <div className="model-card__meta">
          {pipelineTag && (
            <div className="model-card__meta-tooltip-wrapper">
              <span className="model-card__pipeline">
                <pipelineTag.icon size={13} />
                {pipelineTag.label}
              </span>
              <div className="model-card__meta-tooltip">
                <div className="model-card__meta-tooltip-title">
                  Task: {pipelineTag.label}
                </div>
                <div className="model-card__meta-tooltip-text">
                  {pipelineTooltipText}
                </div>
              </div>
            </div>
          )}

          {detectedTags.map((tag) => (
            <span key={tag} className="model-card__tag-pill">
              {tag}
            </span>
          ))}

          {model.parameters && paramTooltip && (
            <div className="model-card__meta-tooltip-wrapper">
              <span className="model-card__meta-item">
                <Cpu size={14} /> {model.parameters}
              </span>
              <div className="model-card__meta-tooltip">
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

          <div className="model-card__meta-tooltip-wrapper">
            <span className="model-card__meta-item">
              <Download size={14} /> {formatCount(model.downloads)}
            </span>
            <div className="model-card__meta-tooltip">
              <div className="model-card__meta-tooltip-text">
                {TOOLTIP_DOWNLOADS}
              </div>
            </div>
          </div>

          <div className="model-card__meta-tooltip-wrapper">
            <span className="model-card__meta-item">
              <Heart size={14} /> {formatCount(model.likes)}
            </span>
            <div className="model-card__meta-tooltip">
              <div className="model-card__meta-tooltip-text">
                {TOOLTIP_LIKES}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ModelCard({
  model,
  selected,
  onSelect,
}: ModelCardProps) {
  return (
    <div className={`model-card ${selected ? 'model-card--selected' : ''}`}>
      <button
        type="button"
        className={`model-card__header ${selected ? 'model-card__header--expanded' : ''}`}
        onClick={() => onSelect(model.id)}
      >
        <ModelCardHeader model={model} />
        {selected ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </div>
  );
}
