import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Search, Loader, Cloud, HardDrive, AlertCircle } from 'lucide-react';
import type {
  ModelSearchResult,
  LocalModel,
  DownloadProgress,
  SearchFilter,
  RemoteModelFile,
} from '../preload.d';

import ModelFilterPanel from '../components/models/ModelFilterPanel';
import ModelSortDropdown from '../components/models/ModelSortDropdown';
import type { SortOption } from '../components/models/ModelSortDropdown';
import ModelCard from '../components/models/ModelCard';
import LocalModelCard from '../components/models/LocalModelCard';

import '../styles/ModelsPage.css';

// ============================================================================
// TYPES
// ============================================================================
type Tab = 'browse' | 'local';

interface ExpandedModel {
  repoId: string;
  files: RemoteModelFile[];
  loading: boolean;
}

interface ActiveDownload {
  filename: string;
  percent: number;
}

const API_SORT_MAP: Record<SortOption, { sort: string; direction: number }> = {
  trending: { sort: 'trendingScore', direction: -1 },
  downloads: { sort: 'downloads', direction: -1 },
  likes: { sort: 'likes', direction: -1 },
  recent: { sort: 'lastModified', direction: -1 },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ModelsPage() {
  const [tab, setTab] = useState<Tab>('browse');
  const [query, setQuery] = useState('');
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

  const [expanded, setExpanded] = useState<ExpandedModel | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>(
    {},
  );

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
  ): Promise<void> => {
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

      // Exact 5 arguments to match preload
      const res = await window.electronAPI.searchModels(
        q.trim(),
        filters,
        apiSort.sort,
        apiSort.direction,
        fetchLimit,
      );

      // If we got exactly as many as we asked for, there might be more
      setHasMore(res.length >= fetchLimit);
      setResults(res);
    } catch (searchErr: unknown) {
      console.error('Search failed:', searchErr);
      setError(
        'Failed to connect to HuggingFace. Please check your internet connection.',
      );
    } finally {
      setSearching(false);
      setIsLoadingMore(false);
    }
  };

  // ── Initial Load (No empty query return) ──
  useEffect(() => {
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

    window.electronAPI.onDownloadProgress((progress: DownloadProgress) => {
      setDownloads((prev) => ({
        ...prev,
        [progress.filename]: {
          filename: progress.filename,
          percent: progress.percent,
        },
      }));

      if (progress.percent >= 100) {
        setTimeout(() => {
          setDownloads((prev) => {
            const updated = { ...prev };
            delete updated[progress.filename];
            return updated;
          });
          window.electronAPI
            .listLocalModels()
            .then(setLocalModels)
            .catch(console.error);
        }, 1000);
      }
    });

    return () => {
      window.electronAPI.removeDownloadProgressListener();
    };
  }, []);

  // ── Load local models on tab switch ──
  useEffect(() => {
    if (tab === 'local') {
      window.electronAPI
        ?.listLocalModels()
        .then(setLocalModels)
        .catch(console.error);
    }
  }, [tab]);

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

  // ── Expand ──
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

  // ── Download / Delete ──
  const handleDownload = async (
    repoId: string,
    filename: string,
  ): Promise<void> => {
    setDownloads((prev) => ({ ...prev, [filename]: { filename, percent: 0 } }));
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

  const handleDelete = async (filename: string): Promise<void> => {
    try {
      await window.electronAPI.deleteModel(filename);
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
          className={`models-tab ${tab === 'browse' ? 'models-tab--active' : ''}`}
          onClick={() => setTab('browse')}
        >
          <Cloud size={16} /> Browse
        </button>
        <button
          type="button"
          className={`models-tab ${tab === 'local' ? 'models-tab--active' : ''}`}
          onClick={() => setTab('local')}
        >
          <HardDrive size={16} /> Installed
        </button>
      </div>

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

            {/* Filter chips row */}
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

          {/* Error */}
          {error && !searching && (
            <div className="models-error">
              <AlertCircle size={32} style={{ marginBottom: 4 }} />
              <span className="models-error__title">Connection Failed</span>
              <span className="models-error__message">{error}</span>
            </div>
          )}

          {/* Empty */}
          {results.length === 0 && !searching && !error && (
            <div className="models-empty">
              No GGUF models found matching your filters.
            </div>
          )}

          {/* Results */}
          {results.map((model: ModelSearchResult) => (
            <ModelCard
              key={model.id}
              model={model}
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

          {/* Infinite Scroll Loader Anchor */}
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

      {/* Local Tab */}
      {tab === 'local' && (
        <>
          {localModels.length === 0 && (
            <div className="models-empty">
              No models installed yet. Browse and download models first.
            </div>
          )}

          {localModels.map((model: LocalModel) => (
            <LocalModelCard
              key={model.filename}
              model={model}
              onDelete={handleDelete}
            />
          ))}
        </>
      )}
    </div>
  );
}
