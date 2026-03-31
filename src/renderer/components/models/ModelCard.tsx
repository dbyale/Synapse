import React from 'react';
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
import { PIPELINE_TAG_MAP } from '../../../data/pipelineTags';
import { LANGUAGES } from '../../../data/languages';

interface ActiveDownload {
  filename: string;
  percent: number;
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

  const pipelineTag =
    model.pipelineTag !== 'none' && model.pipelineTag !== 'unknown'
      ? (PIPELINE_TAG_MAP[model.pipelineTag] ?? null)
      : null;

  // ── Detail extraction & Deduplication ──
  const datasets = Array.from(
    new Set(
      model.tags
        .filter((t) => t.startsWith('dataset:'))
        .map((t) => t.substring(8)) // cleanly removes 'dataset:'
        .filter((t): t is string => Boolean(t)),
    ),
  );

  const baseModels = Array.from(
    new Set(
      model.tags
        .filter((t) => t.startsWith('base_model:'))
        .map((t) => t.split(':').pop()) // gets the repo part
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

  // ── Group files by bit-size ──
  const bitGroups = files.reduce(
    (acc, file) => {
      let key = 'Other';
      if (file.bits === -1) {
        key = 'Projectors';
      } else if (file.bits > 0) {
        key = `${file.bits}-bit`;
      }

      if (!acc[key]) acc[key] = [];
      acc[key].push(file);
      return acc;
    },
    {} as Record<string, RemoteModelFile[]>,
  );

  // Sort groups: Highest bits first, then 'Other', then 'Projectors' at the very bottom
  const sortedBitGroups = Object.entries(bitGroups).sort(([a], [b]) => {
    if (a === b) return 0;
    if (a === 'Projectors') return 1;
    if (b === 'Projectors') return -1;
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0);
  });

  return (
    <div className="model-card">
      <button
        type="button"
        className="model-card__header"
        onClick={() => onToggleExpand(model.id)}
      >
        <div className="model-card__left">
          <div
            className="model-card__avatar"
            style={{
              background: LogoComponent
                ? '#333333'
                : getAvatarColor(model.author),
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
          {/* Detailed Info Grid */}
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

          {/* Grouped Download Pills */}
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

            {sortedBitGroups.map(([groupName, groupFiles]) => {
              // Sort smallest to largest inside the group
              const sortedFiles = [...groupFiles].sort(
                (a, b) => b.sizeBytes - a.sizeBytes,
              );

              return (
                <div key={groupName} className="model-card__dl-row">
                  <div className="model-card__dl-row-label">{groupName}</div>
                  <div className="model-card__dl-pills">
                    {sortedFiles.map((file) => {
                      const isDownloading = !!downloads[file.filename];
                      const percent = isDownloading
                        ? downloads[file.filename].percent
                        : null;

                      return (
                        <button
                          key={file.filename}
                          type="button"
                          className={`model-card__dl-pill ${isDownloading ? 'model-card__dl-pill--active' : ''}`}
                          onClick={() =>
                            !isDownloading &&
                            onDownload(model.id, file.filename)
                          }
                          title={file.filename}
                        >
                          {isDownloading && (
                            <div
                              className="model-card__dl-progress"
                              style={{ width: `${percent}%` }}
                            />
                          )}
                          <div className="model-card__dl-content">
                            <span className="model-card__dl-quant">
                              {file.quantization}
                            </span>
                            <span className="model-card__dl-size">
                              {isDownloading
                                ? `${percent}%`
                                : formatBytes(file.sizeBytes)}
                            </span>
                          </div>
                        </button>
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
