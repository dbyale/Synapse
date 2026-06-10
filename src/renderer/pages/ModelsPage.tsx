import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  Search,
  Loader,
  HardDrive,
  AlertCircle,
  Lightbulb,
  Plus,
  FolderOpen,
} from 'lucide-react';
import type {
  ModelSearchResult,
  LocalModel,
  DownloadProgress,
  SearchFilter,
  RemoteModelFile,
  Profile,
} from '../preload.d';

import ModelFilterPanel from '../components/models/ModelFilterPanel';
import ModelSortDropdown from '../components/models/ModelSortDropdown';
import type { SortOption } from '../components/models/ModelSortDropdown';
import AddLocalModelModal from '../components/models/AddLocalModel';
import ModelCard from '../components/models/ModelCard';
import LocalModelCard, {
  ExtendedLocalModel,
  LocalModelGroup,
} from '../components/models/LocalModelCard';

import '../styles/ModelsPage.css';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================
type Tab = 'browse' | 'local';

interface ExpandedModel {
  repoId: string;
  files: RemoteModelFile[];
  loading: boolean;
}

interface ActiveDownload {
  modelId?: string;
  filename: string;
  percent: number;
  status?: string;
}

const API_SORT_MAP: Record<SortOption, { sort: string; direction: number }> = {
  trending: { sort: 'trendingScore', direction: -1 },
  downloads: { sort: 'downloads', direction: -1 },
  likes: { sort: 'likes', direction: -1 },
  recent: { sort: 'lastModified', direction: -1 },
};

const RECOMMENDATIONS = [
  {
    id: 'unsloth/Qwen3.5-0.8B-GGUF',
    reason: 'An extremely small and efficient model, works on almost anything.',
  },
  {
    id: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    reason:
      'A Google model balancing power and speed, great for a wide range of tasks.',
  },
  {
    id: 'unsloth/Qwen3.5-35B-A3B-GGUF',
    reason:
      'One of the most popular models ever due to its size and efficiency.',
  },
];

export function createDefaultProfileForModel(
  filename: string,
  displayName: string, // e.g. "Qwen3.5-0.8B (Q4_K_M)"
): Profile | null {
  const stored = localStorage.getItem('profiles');
  const profiles: Profile[] = stored ? JSON.parse(stored) : [];

  // Avoid creating a duplicate for the same model file
  const alreadyExists = profiles.some((p) => p.model === filename);
  if (alreadyExists) return null;

  const newProfile: Profile = {
    id: Date.now().toString(),
    name: displayName,
    model: filename,
    systemPrompt: 'You are a helpful assistant.',
    temperature: 0.7,
    topK: 20,
    topP: 0.8,
    minP: 0.05,
    seed: 0,
    order: Date.now(),
    createdAt: Date.now(),
  };

  const updated = [...profiles, newProfile];
  localStorage.setItem('profiles', JSON.stringify(updated));
  return newProfile;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ModelsPage() {
  const [tab, setTab] = useState<Tab>('local');
  const [query, setQuery] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ModelSearchResult[]>([]);

  // ── Server-side state ──
  const [sortBy, setSortBy] = useState<SortOption>('trending');
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef<HTMLDivElement>(null);

  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);

  const [showAddLocalModal, setShowAddLocalModal] = useState(false);

  const [expanded, setExpanded] = useState<ExpandedModel | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>(
    {},
  );

  // ── Recommendations & Settings State ──
  const [recommendedModels, setRecommendedModels] = useState<
    ModelSearchResult[]
  >([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [systemMemoryMB, setSystemMemoryMB] = useState<number>(8192); // Default fallback 8GB

  // ── Memory Fetching ──
  const fetchSystemMemory = useCallback(async () => {
    try {
      const settings = await window.electronAPI.loadSettings();
      // Explicitly convert to Number to ensure mathematical addition, not string concatenation
      const ram = Number(settings?.allocatedRAM) || 0;
      const vram = Number(settings?.allocatedVRAM) || 0;
      const totalMem = ram + vram;

      if (totalMem > 0) {
        setSystemMemoryMB(totalMem);
      }
    } catch (err) {
      console.error('Failed to load memory settings:', err);
    }
  }, []);

  // ── Build filters ──
  const buildFilters = (
    lang: string | null,
    pipe: string | null,
  ): SearchFilter[] => {
    const filters: SearchFilter[] = [
      { id: 'gguf', label: 'GGUF', type: 'library' },
    ];
    if (lang) filters.push({ id: lang, label: lang, type: 'language' });
    if (pipe) filters.push({ id: pipe, label: pipe, type: 'pipeline_tag' });
    return filters;
  };

  // ── Server-Side API Search function ──
  const doSearch = async (
    q: string,
    lang: string | null,
    pipe: string | null,
    fetchLimit: number,
    sortKey: SortOption,
    isLoadMore: boolean = false,
  ): Promise<ModelSearchResult[]> => {
    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setSearching(true);
      setExpanded(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setError(null);

    try {
      const filters = buildFilters(lang, pipe);
      const apiSort = API_SORT_MAP[sortKey];

      const res = await window.electronAPI.searchModels(
        q.trim(),
        filters,
        apiSort.sort,
        apiSort.direction,
        fetchLimit,
      );

      setHasMore(res.length >= fetchLimit);
      setResults(res);
      return res;
    } catch (searchErr: unknown) {
      console.error('Search failed:', searchErr);
      setError(
        'Failed to connect to HuggingFace. Please check your internet connection.',
      );
      return [];
    } finally {
      setSearching(false);
      setIsLoadingMore(false);
    }
  };

  // ── Initial Load ──
  useEffect(() => {
    fetchSystemMemory();
    doSearch('', null, null, 20, 'trending', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Infinite Scroll Observer ──
  const handleLoadMore = useCallback(() => {
    if (searching || isLoadingMore || !hasMore) return;
    const nextLimit = limit + 20;
    setLimit(nextLimit);
    doSearch(
      query,
      selectedLanguage,
      selectedPipeline,
      nextLimit,
      sortBy,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searching,
    isLoadingMore,
    hasMore,
    limit,
    query,
    selectedLanguage,
    selectedPipeline,
    sortBy,
  ]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 },
    );
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  // ── Download progress listener ──
  useEffect(() => {
    if (!window.electronAPI) return undefined;

    const unsubscribe = window.electronAPI.onDownloadProgress(
      (progress: DownloadProgress & { status?: string }) => {
        setDownloads((prev) => {
          if (progress.status === 'cancelled' || progress.status === 'failed') {
            const next = { ...prev };
            delete next[progress.filename];
            return next;
          }
          return {
            ...prev,
            [progress.filename]: {
              filename: progress.filename,
              percent: progress.percent,
              status: progress.status,
            },
          };
        });

        if (progress.percent >= 100) {
          setTimeout(async () => {
            setDownloads((prev) => {
              const updated = { ...prev };
              delete updated[progress.filename];
              return updated;
            });

            const models = await window.electronAPI.listLocalModels();
            setLocalModels(models);

            // Find the newly downloaded model to get its display name
            const newModel = models.find(
              (m) => m.filename === progress.filename,
            );
            if (newModel && !newModel.isProjector) {
              const quantization = newModel.quantization || 'Unknown';
              const baseName =
                newModel.generalName ||
                progress.filename.replace(/\.gguf$/i, '');
              const displayName = `${baseName} (${quantization.toUpperCase()})`;

              createDefaultProfileForModel(progress.filename, displayName);

              // Optional: notify ProfilesPage to re-read localStorage
              window.dispatchEvent(new CustomEvent('profiles-updated'));
            }
          }, 1000);
        }
      },
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // ── Load local models on tab switch ──
  useEffect(() => {
    if (tab === 'local') {
      fetchSystemMemory(); // Always refresh memory settings on tab focus

      const fetchLocal = async () => {
        try {
          const models = await window.electronAPI.listLocalModels();
          setLocalModels(models);
        } catch (err) {
          console.error(err);
        }
      };
      fetchLocal();
    }
  }, [tab, fetchSystemMemory]);

  // ── Local Model Grouping Logic ──
  const groupedLocalModels = useMemo(() => {
    const mGroups = new Map<string, LocalModelGroup>();

    localModels.forEach((baseModel: LocalModel) => {
      const m = baseModel as ExtendedLocalModel;

      const splitMatch = m.filename.match(
        /^(.*?)(?:-(\d{4,5})-of-(\d{4,5}))?\.gguf$/i,
      );
      const fileBaseName =
        splitMatch && splitMatch[2]
          ? splitMatch[1]
          : m.filename.replace(/\.gguf$/i, '');

      const modelName = m.generalName || fileBaseName;

      if (!mGroups.has(modelName)) {
        mGroups.set(modelName, {
          name: modelName,
          architecture: m.architecture,
          parameters: m.parameters,
          activeParameters: m.activeParameters,
          contextLength: m.contextLength,
          fileGroups: [],
          totalSize: 0,
        });
      }

      const mGroup = mGroups.get(modelName)!;

      let fGroup = mGroup.fileGroups.find((g) => g.id === fileBaseName);
      if (!fGroup) {
        fGroup = {
          id: fileBaseName,
          quantization: m.quantization || 'Unknown',
          isProjector: !!m.isProjector,
          parts: [],
          totalSize: 0,
        };
        mGroup.fileGroups.push(fGroup);
      }

      fGroup.parts.push(m);
      fGroup.totalSize += m.sizeBytes;
      mGroup.totalSize += m.sizeBytes;
    });

    mGroups.forEach((mg) => {
      mg.fileGroups.forEach((fg) => {
        fg.parts.sort((a, b) => a.filename.localeCompare(b.filename));
      });
      mg.fileGroups.sort((a, b) => {
        if (a.isProjector && !b.isProjector) return 1;
        if (!a.isProjector && b.isProjector) return -1;
        return a.id.localeCompare(b.id);
      });
    });

    return Array.from(mGroups.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [localModels]);

  const filteredLocalModels = useMemo(() => {
    if (!localQuery.trim()) return groupedLocalModels;
    const lowerQ = localQuery.toLowerCase();
    return groupedLocalModels.filter((m) =>
      m.name.toLowerCase().includes(lowerQ),
    );
  }, [groupedLocalModels, localQuery]);

  // ── Fetch Recommended Models (if empty) ──
  useEffect(() => {
    let isMounted = true;

    const fetchRecommendations = async () => {
      setIsLoadingRecs(true);
      try {
        const promises = RECOMMENDATIONS.map((rec) =>
          window.electronAPI
            .searchModels(
              rec.id,
              [{ id: 'gguf', label: 'GGUF', type: 'library' }],
              'trendingScore',
              -1,
              5,
            )
            .then((res) => {
              return res.find((m) => m.id === rec.id) || res[0];
            }),
        );

        const fetched = await Promise.all(promises);
        const validResults = fetched.filter(
          (r): r is ModelSearchResult => r !== undefined,
        );

        if (isMounted) setRecommendedModels(validResults);
      } catch (err) {
        console.error('Failed to fetch recommendations:', err);
      } finally {
        if (isMounted) setIsLoadingRecs(false);
      }
    };

    if (
      tab === 'local' &&
      groupedLocalModels.length === 0 &&
      recommendedModels.length === 0 &&
      !isLoadingRecs
    ) {
      fetchRecommendations();
    }

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, groupedLocalModels.length, recommendedModels.length]);

  // ── Interaction Handlers ──
  const handleSearch = (): void => {
    setLimit(20);
    doSearch(query, selectedLanguage, selectedPipeline, 20, sortBy, false);
  };

  const handleLanguageSelect = (code: string | null): void => {
    const newLang = selectedLanguage === code ? null : code;
    setSelectedLanguage(newLang);
    setLimit(20);
    doSearch(query, newLang, selectedPipeline, 20, sortBy, false);
  };

  const handlePipelineSelect = (tag: string | null): void => {
    const newPipe = selectedPipeline === tag ? null : tag;
    setSelectedPipeline(newPipe);
    setLimit(20);
    doSearch(query, selectedLanguage, newPipe, 20, sortBy, false);
  };

  const handleSortChange = (newSort: SortOption): void => {
    setSortBy(newSort);
    setLimit(20);
    doSearch(query, selectedLanguage, selectedPipeline, 20, newSort, false);
  };

  const handleExpand = async (repoId: string): Promise<void> => {
    if (expanded?.repoId === repoId) {
      setExpanded(null);
      return;
    }
    setExpanded({ repoId, files: [], loading: true });
    try {
      const files = await window.electronAPI.listModelFiles(repoId);
      setExpanded({ repoId, files, loading: false });
    } catch (expandErr: unknown) {
      console.error('Failed to list files:', expandErr);
      setExpanded(null);
    }
  };

  const handleSearchLocalModel = async (modelName: string): Promise<void> => {
    setTab('browse');
    setQuery(modelName);
    setLimit(20);

    const fetchRes = await doSearch(
      modelName,
      selectedLanguage,
      selectedPipeline,
      20,
      sortBy,
      false,
    );

    if (fetchRes && fetchRes.length > 0) {
      const firstResultId = fetchRes[0].id;
      setExpanded({ repoId: firstResultId, files: [], loading: true });
      try {
        const files = await window.electronAPI.listModelFiles(firstResultId);
        setExpanded({ repoId: firstResultId, files, loading: false });
      } catch (expandErr: unknown) {
        console.error('Failed to list files:', expandErr);
        setExpanded(null);
      }
    }
  };

  const handleDownload = async (
    repoId: string,
    filename: string,
  ): Promise<void> => {
    window.dispatchEvent(
      new CustomEvent('open-download-manager', { detail: { modelId: repoId, filename } }),
    );

    setDownloads((prev) => ({
      ...prev,
      [filename]: { modelId: repoId, filename, percent: 0, status: 'downloading' },
    }));
    try {
      await window.electronAPI.downloadModel(repoId, filename);
    } catch (dlErr: unknown) {
      console.error('Download failed:', dlErr);
      setDownloads((prev) => {
        const updated = { ...prev };
        delete updated[filename];
        return updated;
      });
    }
  };

  const handleAddLocalModel = async (
    name: string,
    author: string,
    modelPaths: string[],
    projectorPaths: string[],
  ): Promise<void> => {
    try {
      console.log('Adding local model:', {
        name,
        author,
        modelPaths,
        projectorPaths,
      });

      const result = await window.electronAPI.registerLocalModel({
        name,
        author,
        modelPaths,
        projectorPaths,
      });

      console.log('Model registered:', result);

      // Refresh the local model list
      const updated = await window.electronAPI.listLocalModels();
      console.log('Updated models list:', updated);
      setLocalModels(updated);
    } catch (err: any) {
      console.error('Failed to add local model:', err);
      throw err; // Re-throw so the modal can display the error
    }
  };

  const handleDeleteGroup = async (filenames: string[]): Promise<void> => {
    try {
      await Promise.all(
        filenames.map((file) => window.electronAPI.deleteModel(file)),
      );
      const updated = await window.electronAPI.listLocalModels();
      setLocalModels(updated);
    } catch (delErr: unknown) {
      console.error('Delete failed:', delErr);
    }
  };

  if (!window.electronAPI) {
    return <div className="models-empty">Electron API not available.</div>;
  }

  return (
    <div className="models-page">
      <h1 className="models-heading">Models</h1>

      {/* Tabs */}
      <div className="models-tabs">
        <button
          type="button"
          className={`models-tab ${tab === 'local' ? 'models-tab--active' : ''}`}
          onClick={() => setTab('local')}
        >
          <HardDrive size={16} /> Installed
        </button>
        <button
          type="button"
          className={`models-tab ${tab === 'browse' ? 'models-tab--active' : ''}`}
          onClick={() => setTab('browse')}
        >
          <Search size={16} /> Browse
        </button>
      </div>

      {/* Local Tab */}
      {tab === 'local' && (
        <>
          {groupedLocalModels.length > 0 && (
            <div className="local-search-container">
              <Search size={16} className="local-search-icon" />
              <input
                className="input-base search-input local-search-input"
                placeholder="Search installed models..."
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
              />
              <button
                type="button"
                className="local-folder-btn"
                onClick={() => window.electronAPI.openModelsFolder()}
                title="Open models folder"
              >
                <FolderOpen size={16} />
                <span>Open Folder</span>
              </button>
            </div>
          )}

          {groupedLocalModels.length === 0 && (
            <div className="models-empty-state">
              <div className="models-empty" style={{ paddingBottom: '20px' }}>
                No models installed yet. Here are some recommendations to get
                you started:
              </div>

              {isLoadingRecs ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '32px',
                  }}
                >
                  <Loader
                    className="spin"
                    size={24}
                    color="var(--text-secondary)"
                  />
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                  }}
                >
                  {recommendedModels.map((model) => {
                    const recReason = RECOMMENDATIONS.find(
                      (r) => r.id === model.id,
                    )?.reason;
                    return (
                      <div key={model.id} className="recommendation-wrapper">
                        {recReason && (
                          <div className="recommendation-reason">
                            <Lightbulb size={14} /> {recReason}
                          </div>
                        )}
                        <ModelCard
                          model={model}
                          systemMemoryMB={systemMemoryMB}
                          isExpanded={expanded?.repoId === model.id}
                          files={
                            expanded?.repoId === model.id ? expanded.files : []
                          }
                          filesLoading={
                            expanded?.repoId === model.id
                              ? expanded.loading
                              : false
                          }
                          downloads={downloads}
                          onToggleExpand={handleExpand}
                          onDownload={handleDownload}
                          onSearchBaseModel={(bmQuery) => {
                            setTab('browse');
                            setQuery(bmQuery);
                            setLimit(20);
                            doSearch(
                              bmQuery,
                              selectedLanguage,
                              selectedPipeline,
                              20,
                              sortBy,
                              false,
                            );
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {groupedLocalModels.length > 0 &&
            filteredLocalModels.length === 0 && (
              <div className="models-empty">
                No installed models match your search.
              </div>
            )}

          {groupedLocalModels.length > 0 &&
            filteredLocalModels.length > 0 &&
            filteredLocalModels.map((group) => (
              <LocalModelCard
                key={group.name}
                group={group}
                onDelete={handleDeleteGroup}
                onSearchModel={handleSearchLocalModel}
              />
            ))}

          {/* ── Add Local Model Button ── */}
          <div
            className="find-more-container"
            style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}
          >
            <button
              type="button"
              className="alm-upload-btn" // reuses the dashed-border style
              style={{ alignSelf: 'center' }}
              onClick={() => setShowAddLocalModal(true)}
            >
              <Plus size={15} /> Add Local Model
            </button>
          </div>

          {/* ── Modal ── */}
          {showAddLocalModal && (
            <AddLocalModelModal
              onClose={() => setShowAddLocalModal(false)}
              onAdd={handleAddLocalModel}
            />
          )}

          <div className="find-more-container">
            <button
              type="button"
              className="btn-accent find-more-btn"
              onClick={() => {
                setTab('browse');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <Search size={16} /> Find more models
            </button>
          </div>
        </>
      )}

      {/* Browse Tab */}
      {tab === 'browse' && (
        <>
          <div className="search-container">
            <div className="search-row">
              <input
                className="input-base search-input"
                placeholder="Search HuggingFace for GGUF models..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />

              <button
                type="button"
                className="btn-accent search-btn"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? <Loader size={16} /> : <Search size={16} />}
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>

            <ModelFilterPanel
              selectedLanguage={selectedLanguage}
              selectedPipeline={selectedPipeline}
              onLanguageSelect={handleLanguageSelect}
              onPipelineSelect={handlePipelineSelect}
            />

            <ModelSortDropdown
              sortBy={sortBy}
              onSortChange={handleSortChange}
            />
          </div>

          {error && !searching && (
            <div className="models-error">
              <AlertCircle size={32} style={{ marginBottom: 4 }} />
              <span className="models-error__title">Connection Failed</span>
              <span className="models-error__message">{error}</span>
            </div>
          )}

          {results.length === 0 && !searching && !error && (
            <div className="models-empty">
              No GGUF models found matching your filters.
            </div>
          )}

          {results.map((model: ModelSearchResult) => (
            <ModelCard
              key={model.id}
              model={model}
              systemMemoryMB={systemMemoryMB}
              isExpanded={expanded?.repoId === model.id}
              files={expanded?.repoId === model.id ? expanded.files : []}
              filesLoading={
                expanded?.repoId === model.id ? expanded.loading : false
              }
              downloads={downloads}
              onToggleExpand={handleExpand}
              onDownload={handleDownload}
              onSearchBaseModel={(bmQuery) => {
                setQuery(bmQuery);
                setLimit(20);
                doSearch(
                  bmQuery,
                  selectedLanguage,
                  selectedPipeline,
                  20,
                  sortBy,
                  false,
                );
              }}
            />
          ))}

          {results.length > 0 && hasMore && (
            <div ref={loaderRef} className="models-loader">
              <Loader
                size={24}
                className={isLoadingMore ? 'spin' : ''}
                style={{ opacity: isLoadingMore ? 1 : 0 }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
