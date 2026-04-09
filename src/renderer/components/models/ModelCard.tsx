import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Download,
  ChevronDown,
  ChevronUp,
  Heart,
  Cpu,
  Search,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import type { ModelSearchResult, RemoteModelFile } from '../../preload.d';
import { getCompanyLogoComponent } from '../../utils/companyLogos';
import {
  formatCount,
  formatBytes,
  getAvatarColor,
  getInitials,
} from '../../utils/formatters';
import { parseQuantization } from '../../utils/quantizationDescriptions';
import { PIPELINE_TAG_MAP } from '../../../data/pipelineTags';
import { LANGUAGES } from '../../../data/languages';
import {
  PIPELINE_DESCRIPTIONS,
  FALLBACK_PIPELINE_DESCRIPTION,
} from '../../../data/pipelineDescriptions';

// ── Tooltip Strings ──
const TOOLTIP_DOWNLOADS = 'Total downloads on HuggingFace';
const TOOLTIP_LIKES = 'Total likes on HuggingFace';

interface ActiveDownload {
  filename: string;
  percent: number;
  status?: 'downloading' | 'cancelled' | 'failed' | string;
}

interface ModelCardProps {
  model: ModelSearchResult;
  isExpanded: boolean;
  files: RemoteModelFile[];
  filesLoading: boolean;
  downloads: Record<string, ActiveDownload>;
  systemMemoryMB: number; // Inherited from Settings
  onToggleExpand: (repoId: string) => void;
  onDownload: (repoId: string, filename: string) => void;
  onSearchBaseModel: (query: string) => void;
}

interface FileGroup {
  id: string;
  displayQuantization: string;
  bits: number;
  totalSizeBytes: number;
  parts: RemoteModelFile[];
}

// ── Heuristics & Math for Memory Context ──
interface ModelArchitecture {
  numLayers: number;
  numKvHeads: number;
  headDim: number;
}

function parseBillionsOfParams(params: string | null | undefined): number {
  if (!params) return 30; // Fallback to 30B
  const upper = params.toUpperCase();

  // Check for "-A" format (e.g., 26B-A4B or 14B-A2.7B)
  const aMatch = upper.match(/^([0-9.]+[BM])-A([0-9.]+[BM])$/);
  // Check for "x" format (e.g., 8X7B)
  const xMatch = upper.match(/^([0-9]+)X([0-9.]+[BM])$/);
  // Standard parameter format (e.g. 8B)
  const standardMatch = upper.match(/^([0-9.]+)[BM]$/);

  // Note: parseFloat("26B") or parseFloat("26M") natively strips the letter and returns 26.
  if (aMatch) {
    // Total parameters is the first capture group
    return parseFloat(aMatch[1]);
  }
  if (xMatch) {
    // Experts count * Size per expert
    return parseFloat(xMatch[1]) * parseFloat(xMatch[2]);
  }
  if (standardMatch) {
    // Standard dense model
    return parseFloat(standardMatch[1]);
  }

  return 30; // Fallback if no patterns match
}

function guessArchitectureFromParamCount(
  billionsOfParams: number,
): ModelArchitecture {
  if (billionsOfParams <= 3)
    return { numLayers: 22, numKvHeads: 4, headDim: 128 };
  if (billionsOfParams <= 9)
    return { numLayers: 32, numKvHeads: 8, headDim: 128 }; // e.g. Llama 3 8B
  if (billionsOfParams <= 14)
    return { numLayers: 40, numKvHeads: 8, headDim: 128 };
  if (billionsOfParams <= 35)
    return { numLayers: 60, numKvHeads: 8, headDim: 128 };
  return { numLayers: 80, numKvHeads: 8, headDim: 128 }; // 70B+ fallback
}

function calculateMaxContext(
  availableMemoryMB: number,
  modelSizeMB: number,
  architecture: ModelArchitecture,
  cacheBits: 16 | 8 = 16,
): number {
  // Free memory available strictly for the context
  const freeMemoryForContextMB = availableMemoryMB - modelSizeMB;

  if (freeMemoryForContextMB <= 0) return 0;

  const bytesPerParam = cacheBits / 8;
  const bytesPerToken =
    2 *
    architecture.numLayers *
    architecture.numKvHeads *
    architecture.headDim *
    bytesPerParam;

  const freeMemoryBytes = freeMemoryForContextMB * 1024 * 1024;

  return Math.floor(freeMemoryBytes / bytesPerToken);
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

// ── Lightweight Markdown Summary Extractor ──
function getMarkdownSummary(md: string): string {
  let content = md.replace(/^---[\s\S]*?---\n/, '');
  content = content.replace(/<!--[\s\S]*?-->/g, '');
  content = content.replace(/```[\s\S]*?```/g, '');
  content = content.replace(/<[^>]+>/g, '');
  content = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  content = content.replace(/\[\s*\]\([^)]+\)/g, '');

  const lines = content.split('\n').map((l) => l.trim());
  const summaryLines: string[] = [];

  lines.every((line) => {
    if (!line || line.match(/^[#|>]/)) {
      if (summaryLines.length > 0 && summaryLines.join(' ').length > 100) {
        return false;
      }
      return true;
    }

    summaryLines.push(line);

    if (summaryLines.length >= 8 || summaryLines.join(' ').length > 400) {
      return false;
    }
    return true;
  });

  let summary = summaryLines.join(' ').trim();

  summary = summary.replace(/__/g, '');
  summary = summary.replace(/~~/g, '');

  return summary || 'No description available.';
}

// ── Render Markdown Formatting into React Elements ──
function renderMarkdownSnippet(text: string): React.ReactNode[] {
  const regex = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  let match = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const token = match[0];
    const key = `md-${match.index}`;

    if (token.startsWith('[') && token.includes('](')) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1];
        const url = linkMatch[2];

        if (url.startsWith('#')) {
          parts.push(<strong key={key}>{label}</strong>);
        } else {
          parts.push(
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="model-card__summary-link"
              onClick={(e) => e.stopPropagation()}
              title={url}
            >
              {label}
            </a>,
          );
        }
      }
    } else if (token.startsWith('**')) {
      parts.push(
        <strong key={key} className="model-card__summary-bold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      parts.push(
        <em key={key} className="model-card__summary-italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={key} className="model-card__summary-code">
          {token.slice(1, -1)}
        </code>,
      );
    }

    lastIndex = regex.lastIndex;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
}

export default function ModelCard({
  model,
  isExpanded,
  files,
  filesLoading,
  downloads,
  systemMemoryMB,
  onToggleExpand,
  onDownload,
  onSearchBaseModel,
}: ModelCardProps) {
  const LogoComponent = getCompanyLogoComponent(model.id);

  const [readmeSummary, setReadmeSummary] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const fetchReadme = async () => {
      if (!isExpanded || hasFetchedRef.current) return;

      hasFetchedRef.current = true;
      setReadmeLoading(true);

      try {
        const res = await fetch(
          `https://huggingface.co/${model.id}/resolve/main/README.md`,
        );
        if (!res.ok) throw new Error('Not found');
        const text = await res.text();

        if (isMounted) {
          setReadmeSummary(getMarkdownSummary(text));
        }
      } catch {
        if (isMounted) {
          setReadmeSummary('No description available.');
        }
      } finally {
        if (isMounted) {
          setReadmeLoading(false);
        }
      }
    };

    fetchReadme();

    return () => {
      isMounted = false;
    };
  }, [isExpanded, model.id]);

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

  const datasets = Array.from(
    new Set(
      model.tags
        .filter((t) => t.startsWith('dataset:'))
        .map((t) => t.substring(8))
        .filter((t): t is string => Boolean(t)),
    ),
  );

  const baseModels = Array.from(
    new Set(
      model.tags
        .filter((t) => t.startsWith('base_model:'))
        .map((t) => t.split(':').pop())
        .filter((t): t is string => Boolean(t)),
    ),
  );

  const regions = Array.from(
    new Set(
      model.tags
        .filter((t) => t.startsWith('region:'))
        .map((t) => t.split(':').pop()?.toUpperCase())
        .filter(Boolean),
    ),
  );

  const languageLabels = Array.from(
    new Set(
      model.tags
        .map((t) => LANGUAGES.find((l) => l.code === t)?.label)
        .filter(Boolean),
    ),
  );

  const hasDetails =
    languageLabels.length > 0 ||
    baseModels.length > 0 ||
    datasets.length > 0 ||
    regions.length > 0;

  const sortedBitGroups = useMemo(() => {
    const groupedFiles = new Map<string, FileGroup>();

    files.forEach((file) => {
      const splitMatch = file.filename.match(
        /^(.*?)(?:-(\d{4,5})-of-(\d{4,5}))?\.gguf$/i,
      );
      const baseName =
        splitMatch && splitMatch[2]
          ? splitMatch[1]
          : file.filename.replace(/\.gguf$/i, '');
      const groupId = `${baseName}.gguf`;

      if (!groupedFiles.has(groupId)) {
        groupedFiles.set(groupId, {
          id: groupId,
          displayQuantization: file.quantization,
          bits: file.bits,
          totalSizeBytes: 0,
          parts: [],
        });
      }

      const group = groupedFiles.get(groupId)!;
      group.totalSizeBytes += file.sizeBytes;
      group.parts.push(file);
    });

    const bitGroups = Array.from(groupedFiles.values()).reduce(
      (acc, group) => {
        let key = 'Other';
        if (group.bits === -1) {
          key = 'Projectors';
        } else if (group.bits > 0) {
          key = `${group.bits}-bit`;
        }

        if (!acc[key]) acc[key] = [];
        acc[key].push(group);
        return acc;
      },
      {} as Record<string, FileGroup[]>,
    );

    return Object.entries(bitGroups).sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === 'Projectors') return 1;
      if (b === 'Projectors') return -1;
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0);
    });
  }, [files]);

  return (
    <div className="model-card">
      <button
        type="button"
        className={`model-card__header ${isExpanded ? 'model-card__header--expanded' : ''}`}
        onClick={() => onToggleExpand(model.id)}
      >
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

        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {isExpanded && (
        <div className="model-card__expanded">
          {/* ── Readme Summary ── */}
          <div className="model-card__summary">
            {readmeLoading ? (
              <span className="model-card__summary-loading">
                Loading summary...
              </span>
            ) : (
              <div className="model-card__summary-text">
                {readmeSummary ? renderMarkdownSnippet(readmeSummary) : ''}
              </div>
            )}
          </div>

          {/* ── Details Grid ── */}
          {hasDetails && (
            <div className="model-card__info-grid">
              {baseModels.length > 0 && (
                <div className="model-card__info-item">
                  <span className="model-card__info-label">Base Model</span>
                  <div className="model-card__info-value">
                    {baseModels.map((bm) => {
                      const searchName = bm.includes('/')
                        ? bm.split('/').pop() || bm
                        : bm;
                      return (
                        <button
                          type="button"
                          key={bm}
                          className="model-card__link-base"
                          onClick={() => onSearchBaseModel(searchName)}
                          title={`Search base model: ${searchName}`}
                        >
                          {bm} <Search size={12} style={{ opacity: 0.6 }} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {datasets.length > 0 && (
                <div className="model-card__info-item">
                  <span className="model-card__info-label">Datasets</span>
                  <div className="model-card__info-value">
                    {datasets.map((ds) => (
                      <button
                        type="button"
                        key={ds}
                        className="model-card__link-dataset"
                        onClick={() =>
                          window.open(
                            `https://huggingface.co/datasets/${ds}`,
                            '_blank',
                          )
                        }
                        title="View dataset on HuggingFace"
                      >
                        {ds} <ExternalLink size={12} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {languageLabels.length > 0 && (
                <div className="model-card__info-item">
                  <span className="model-card__info-label">Languages</span>
                  <div className="model-card__info-value">
                    {languageLabels.join(', ')}
                  </div>
                </div>
              )}
              {regions.length > 0 && (
                <div className="model-card__info-item">
                  <span className="model-card__info-label">Region</span>
                  <div className="model-card__info-value">
                    {regions.join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="model-card__dl-rows">
            {filesLoading && (
              <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>
                Loading files...
              </div>
            )}
            {!filesLoading && files.length === 0 && (
              <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>
                No GGUF files found.
              </div>
            )}

            {sortedBitGroups.map(([groupName, groups]) => {
              const sortedGroups = [...groups].sort(
                (a, b) => b.totalSizeBytes - a.totalSizeBytes,
              );

              return (
                <div key={groupName} className="model-card__dl-row">
                  <div className="model-card__dl-row-label">{groupName}</div>
                  <div className="model-card__dl-pills">
                    {sortedGroups.map((group) => {
                      const activeDls = group.parts
                        .map((p) => downloads[p.filename])
                        .filter(Boolean);

                      const isDownloading =
                        activeDls.length > 0 &&
                        activeDls.some(
                          (d) =>
                            d.status !== 'cancelled' && d.status !== 'failed',
                        );

                      let percent: number | null = null;

                      if (isDownloading) {
                        const anyStarted = activeDls.some((d) => d.percent > 0);

                        const totalProgress = group.parts.reduce(
                          (sum, part) => {
                            const dl = downloads[part.filename];
                            if (dl) return sum + dl.percent;
                            return sum + (anyStarted ? 100 : 0);
                          },
                          0,
                        );

                        percent = Math.floor(
                          totalProgress / group.parts.length,
                        );
                      }

                      const quantInfo = parseQuantization(
                        group.id,
                        group.displayQuantization,
                        group.bits === -1,
                      );

                      if (group.parts.length > 1) {
                        quantInfo.details.unshift(
                          `Multi-part download (${group.parts.length} files)`,
                        );
                      }

                      // --- MEMORY CAPACITY MATH ---
                      const modelSizeMB = group.totalSizeBytes / (1024 * 1024);
                      const paramsB = parseBillionsOfParams(model.parameters);
                      const arch = guessArchitectureFromParamCount(paramsB);
                      const maxContext = calculateMaxContext(
                        systemMemoryMB,
                        modelSizeMB,
                        arch,
                      );
                      const maxWords = Math.floor(maxContext * 0.75);

                      let pillState: 'normal' | 'warning' | 'error' = 'normal';
                      if (modelSizeMB >= systemMemoryMB) {
                        pillState = 'error';
                      } else if (maxContext < 4096) {
                        pillState = 'warning';
                      }

                      let activePillClass = '';
                      if (isDownloading)
                        activePillClass = 'model-card__dl-pill--active';
                      else if (pillState === 'error')
                        activePillClass = 'model-card__dl-pill--error';
                      else if (pillState === 'warning')
                        activePillClass = 'model-card__dl-pill--warning';

                      return (
                        <div
                          key={group.id}
                          className="model-card__dl-pill-wrapper"
                        >
                          <button
                            type="button"
                            className={`model-card__dl-pill ${activePillClass}`}
                            onClick={() => {
                              if (!isDownloading) {
                                group.parts.forEach((p) =>
                                  onDownload(model.id, p.filename),
                                );
                              }
                            }}
                          >
                            {isDownloading && (
                              <div
                                className="model-card__dl-progress"
                                style={{ width: `${percent}%` }}
                              />
                            )}
                            <div className="model-card__dl-content">
                              <span className="model-card__dl-quant">
                                {group.displayQuantization}
                              </span>
                              <span className="model-card__dl-size">
                                {isDownloading
                                  ? `${percent}%`
                                  : formatBytes(group.totalSizeBytes)}
                              </span>
                            </div>
                          </button>

                          <div className="model-card__dl-tooltip">
                            <div className="model-card__dl-tooltip-title">
                              {quantInfo.filename}
                            </div>

                            {pillState === 'error' && (
                              <div className="model-card__dl-tooltip-alert model-card__dl-tooltip-alert--error">
                                <AlertCircle
                                  size={14}
                                  style={{ flexShrink: 0, marginTop: 2 }}
                                />
                                <span>
                                  Model size (
                                  {formatBytes(group.totalSizeBytes)}) exceeds
                                  your allocated memory (
                                  {(systemMemoryMB / 1024).toFixed(1)} GB). The
                                  model may fail to load or run out of memory
                                  during use. Consider increasing the memory
                                  limit in settings.
                                </span>
                              </div>
                            )}

                            {pillState === 'warning' && (
                              <div className="model-card__dl-tooltip-alert model-card__dl-tooltip-alert--warning">
                                <AlertTriangle
                                  size={14}
                                  style={{ flexShrink: 0, marginTop: 2 }}
                                />
                                <span>
                                  Estimated max context is only ~
                                  {maxContext.toLocaleString()} tokens (~
                                  {maxWords.toLocaleString()} words). Model may
                                  run out of memory during conversations.
                                  Consider increasing the memory limit in
                                  settings.
                                </span>
                              </div>
                            )}

                            {quantInfo.details.length > 0 && (
                              <ul className="model-card__dl-tooltip-list">
                                {quantInfo.details.map((detail) => (
                                  <li key={detail}>{detail}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
