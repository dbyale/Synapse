import { useMemo, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  Search,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  X,
} from 'lucide-react';
import type { ModelSearchResult, RemoteModelFile } from '../../preload.d';
import { formatBytes } from '../../utils/formatters';
import { parseQuantization } from '../../utils/quantizationDescriptions';
import { LANGUAGES } from '../../../data/languages';
import MarkdownRenderer from '../MarkdownRenderer';
import { ModelCardHeader } from './ModelCard';

interface ActiveDownload {
  filename: string;
  percent: number;
  status?: 'downloading' | 'cancelled' | 'failed' | string;
}

interface FileGroup {
  id: string;
  displayQuantization: string;
  bits: number;
  totalSizeBytes: number;
  parts: RemoteModelFile[];
}

interface ModelDetailPanelProps {
  model: ModelSearchResult;
  files: RemoteModelFile[];
  filesLoading: boolean;
  downloads: Record<string, ActiveDownload>;
  localModelKeys: Set<string>;
  systemMemoryMB: number;
  onDownload: (repoId: string, filename: string) => void;
  onSearchBaseModel: (query: string) => void;
  onClose: () => void;
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
  // Check for letter-prefixed format (e.g., E4B)
  const letterPrefixedMatch = upper.match(/^([A-Z])([0-9.]+[BM])$/);
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
  if (letterPrefixedMatch) {
    // Effective parameter size (e.g. E4B → 4)
    return parseFloat(letterPrefixedMatch[2]);
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

// ── Download Options (quantization pills) ──
function DownloadOptions({
  model,
  files,
  filesLoading,
  downloads,
  localModelKeys,
  systemMemoryMB,
  onDownload,
}: {
  model: ModelSearchResult;
  files: RemoteModelFile[];
  filesLoading: boolean;
  downloads: Record<string, ActiveDownload>;
  localModelKeys: Set<string>;
  systemMemoryMB: number;
  onDownload: (repoId: string, filename: string) => void;
}) {
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
                  .map((p) => downloads[`${model.id}:${p.filename}`])
                  .filter(Boolean);

                const isDownloading =
                  activeDls.length > 0 &&
                  activeDls.some(
                    (d) => d.status !== 'cancelled' && d.status !== 'failed',
                  );

                let percent: number | null = null;

                if (isDownloading) {
                  const anyStarted = activeDls.some((d) => d.percent > 0);

                  const totalProgress = group.parts.reduce((sum, part) => {
                    const dl = downloads[`${model.id}:${part.filename}`];
                    if (dl) return sum + dl.percent;
                    return sum + (anyStarted ? 100 : 0);
                  }, 0);

                  percent = Math.floor(totalProgress / group.parts.length);
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

                const allLocal = group.parts.every((p) =>
                  localModelKeys.has(`${model.id}:${p.filename}`),
                );

                let activePillClass = '';
                if (isDownloading)
                  activePillClass = 'model-card__dl-pill--active';
                else if (pillState === 'error')
                  activePillClass = 'model-card__dl-pill--error';
                else if (pillState === 'warning')
                  activePillClass = 'model-card__dl-pill--warning';

                if (allLocal) {
                  activePillClass += ' model-card__dl-pill--downloaded';
                }

                return (
                  <div key={group.id} className="model-card__dl-pill-wrapper">
                    <button
                      type="button"
                      className={`model-card__dl-pill ${activePillClass}`}
                      disabled={allLocal}
                      onClick={() => {
                        if (!isDownloading && !allLocal) {
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
                          {allLocal && (
                            <Check size={12} className="model-card__dl-check" />
                          )}
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
                            Model size ({formatBytes(group.totalSizeBytes)})
                            exceeds your allocated memory (
                            {(systemMemoryMB / 1024).toFixed(1)} GB). The model
                            may fail to load or run out of memory during use.
                            Consider increasing the memory limit in settings.
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
                            {maxWords.toLocaleString()} words). Model may run
                            out of memory during conversations. Consider
                            increasing the memory limit in settings.
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
  );
}

export default function ModelDetailPanel({
  model,
  files,
  filesLoading,
  downloads,
  localModelKeys,
  systemMemoryMB,
  onDownload,
  onSearchBaseModel,
  onClose,
}: ModelDetailPanelProps) {
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [readmeDisabled, setReadmeDisabled] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setReadme(null);
    setReadmeDisabled(false);

    const loadReadme = async () => {
      try {
        const settings = await window.electronAPI.loadSettings();
        if (!isMounted) return;
        if (settings.disableExternalReadmes) {
          setReadmeDisabled(true);
          setReadmeLoading(false);
          return;
        }

        setReadmeLoading(true);
        try {
          const res = await fetch(
            `https://huggingface.co/${model.id}/resolve/main/README.md`,
          );
          if (!res.ok) throw new Error('Not found');
          const text = await res.text();
          if (isMounted) setReadme(text);
        } catch {
          if (isMounted) setReadme('');
        } finally {
          if (isMounted) setReadmeLoading(false);
        }
      } catch {
        if (isMounted) setReadmeLoading(false);
      }
    };

    loadReadme();

    return () => {
      isMounted = false;
    };
  }, [model.id]);

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

  let readmeBody: ReactNode;
  if (readmeLoading) {
    readmeBody = (
      <span className="model-card__summary-loading">Loading README...</span>
    );
  } else if (readme) {
    readmeBody = (
      <MarkdownRenderer
        content={readme}
        baseUrl={`https://huggingface.co/${model.id}/resolve/main`}
        allowHtml
      />
    );
  } else {
    readmeBody = 'No description available.';
  }

  return (
    <div className="model-detail-panel">
      <div className="model-detail-panel__header">
        <ModelCardHeader model={model} />
        <button
          type="button"
          className="model-detail-panel__close"
          onClick={onClose}
          title="Close model details"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Download Options (top) ── */}
      <div className="model-detail-panel__section model-detail-panel__downloads">
        <div className="model-detail-panel__section-title">Download</div>
        <DownloadOptions
          model={model}
          files={files}
          filesLoading={filesLoading}
          downloads={downloads}
          localModelKeys={localModelKeys}
          systemMemoryMB={systemMemoryMB}
          onDownload={onDownload}
        />
      </div>

      {/* ── Details Grid ── */}
      {hasDetails && (
        <div className="model-detail-panel__section model-detail-panel__details">
          <div className="model-detail-panel__section-title">Details</div>
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
        </div>
      )}

      {/* ── Full README ── */}
      <div className="model-detail-panel__section model-detail-panel__readme">
        <div className="model-detail-panel__section-title">README</div>
        {readmeDisabled ? (
          <p className="model-detail-panel__readme-disabled">
            README downloads are disabled in Security settings.
          </p>
        ) : (
          <div className="model-detail-panel__readme-body">{readmeBody}</div>
        )}
      </div>
    </div>
  );
}
