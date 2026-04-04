import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Download,
  ChevronDown,
  ChevronUp,
  Heart,
  Cpu,
  Search,
  ExternalLink,
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

// ── Lightweight Markdown Summary Extractor ──
function getMarkdownSummary(md: string): string {
  // 1. Remove YAML frontmatter & HTML comments
  let content = md.replace(/^---[\s\S]*?---\n/, '');
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Remove code blocks
  content = content.replace(/```[\s\S]*?```/g, '');

  // 3. Remove HTML tags completely (this handles <img src="..." />)
  content = content.replace(/<[^>]+>/g, '');

  // 4. Remove Markdown Images: ![alt](url)
  content = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // 5. Remove empty links: [](url) - This cleans up badge links where the image was stripped
  content = content.replace(/\[\s*\]\([^)]+\)/g, '');

  const lines = content.split('\n').map((l) => l.trim());
  const summaryLines: string[] = [];

  lines.every((line) => {
    // Skip empty lines, headers (#), blockquotes (>), or table dividers (|)
    if (!line || line.match(/^[#|>]/)) {
      // If we already have a decent chunk of text, stop looking
      if (summaryLines.length > 0 && summaryLines.join(' ').length > 100) {
        return false; // Break loop
      }
      return true; // Continue searching
    }

    summaryLines.push(line);

    // Stop gathering if we hit 8 lines or about 400 characters
    if (summaryLines.length >= 8 || summaryLines.join(' ').length > 400) {
      return false; // Break loop
    }
    return true; // Continue loop
  });

  let summary = summaryLines.join(' ').trim();

  // Strip basic formatting (**, __, ~~) but leave links intact
  summary = summary.replace(/\*\*/g, '');
  summary = summary.replace(/__/g, '');
  summary = summary.replace(/~~/g, '');
  summary = summary.replace(/`/g, '');

  return summary || 'No description available.';
}

// ── Render Markdown Links into React Elements ──
function renderSummaryWithLinks(text: string): React.ReactNode[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  // Execute regex without assigning inside the condition (Fixes ESLint no-cond-assign)
  let match = linkRegex.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    parts.push(
      <a
        key={`link-${match.index}`}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="model-card__summary-link"
        onClick={(e) => e.stopPropagation()} // Prevents the card from collapsing when clicked
        title={match[2]}
      >
        {match[1]}
      </a>,
    );

    lastIndex = linkRegex.lastIndex;
    match = linkRegex.exec(text); // Fetch next match
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
  onToggleExpand,
  onDownload,
  onSearchBaseModel,
}: ModelCardProps) {
  const LogoComponent = getCompanyLogoComponent(model.id);

  // ── README Fetching State ──
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

  // ── Detail extraction & Deduplication ──
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

  // ── Process and Group Splits ──
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
                : `${getAvatarColor(model.author)}25`, // Tinted dark background
              color: LogoComponent ? '#ffffff' : getAvatarColor(model.author), // Bright solid text
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
                <span className="model-card__pipeline" title="Pipeline">
                  <pipelineTag.icon size={13} />
                  {pipelineTag.label}
                </span>
              )}

              {model.parameters && (
                <span className="model-card__meta-item" title="Parameters">
                  <Cpu size={14} /> {model.parameters}
                </span>
              )}

              <span className="model-card__meta-item" title="Downloads">
                <Download size={14} /> {formatCount(model.downloads)}
              </span>

              <span className="model-card__meta-item" title="Likes">
                <Heart size={14} /> {formatCount(model.likes)}
              </span>
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
                {readmeSummary ? renderSummaryWithLinks(readmeSummary) : ''}
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
                    {baseModels.map((bm) => (
                      <button
                        type="button"
                        key={bm}
                        className="model-card__link-base"
                        onClick={() => onSearchBaseModel(bm)}
                        title="Search base model"
                      >
                        {bm} <Search size={12} style={{ opacity: 0.6 }} />
                      </button>
                    ))}
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

                      return (
                        <div
                          key={group.id}
                          className="model-card__dl-pill-wrapper"
                        >
                          <button
                            type="button"
                            className={`model-card__dl-pill ${isDownloading ? 'model-card__dl-pill--active' : ''}`}
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
