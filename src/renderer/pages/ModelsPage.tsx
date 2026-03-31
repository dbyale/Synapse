import React, { useEffect, useState } from 'react';
import { Search, Loader, Cloud, HardDrive, AlertCircle } from 'lucide-react';
import type {
  ModelSearchResult,
  LocalModel,
  DownloadProgress,
  SearchFilter,
  RemoteModelFile,
} from '../preload.d';
import type { Language } from '../../data/languages';
import type { PipelineTagOption } from '../../data/pipelineTags';
import { LANGUAGES } from '../../data/languages';
import { PIPELINE_TAGS } from '../../data/pipelineTags';

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
  files: RemoteModelFile[]; // <- changed from string[]
  loading: boolean;
}

interface ActiveDownload {
  filename: string;
  percent: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ModelsPage() {
  const [tab, setTab] = useState<Tab>('browse');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ModelSearchResult[]>([]);

  const [sortBy, setSortBy] = useState<SortOption>('trending');

  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<ExpandedModel | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>(
    {},
  );

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

  // ── Sort ──
  const applySort = (
    data: ModelSearchResult[],
    sortType: SortOption,
  ): ModelSearchResult[] => {
    return [...data].sort((a: ModelSearchResult, b: ModelSearchResult) => {
      switch (sortType) {
        case 'trending':
          return (b.trendingScore ?? 0) - (a.trendingScore ?? 0);
        case 'downloads':
          return b.downloads - a.downloads;
        case 'likes':
          return b.likes - a.likes;
        case 'recent':
          return (
            new Date(b.lastModified).getTime() -
            new Date(a.lastModified).getTime()
          );
        default:
          return 0;
      }
    });
  };

  const handleSortChange = (newSort: SortOption): void => {
    setSortBy(newSort);
    setResults((prev) => applySort(prev, newSort));
  };

  // ── Build filters ──
  const buildFilters = (
    lang: string | null,
    pipe: string | null,
  ): SearchFilter[] => {
    const filters: SearchFilter[] = [
      { id: 'gguf', label: 'GGUF', type: 'library' },
    ];
    if (lang) {
      const langObj = LANGUAGES.find((l: Language) => l.code === lang);
      filters.push({
        id: lang,
        label: langObj?.label ?? lang,
        type: 'language',
      });
    }
    if (pipe) {
      const pipeObj = PIPELINE_TAGS.find(
        (p: PipelineTagOption) => p.id === pipe,
      );
      filters.push({
        id: pipe,
        label: pipeObj?.label ?? pipe,
        type: 'pipeline_tag',
      });
    }
    return filters;
  };

  // ── Search ──
  const doSearch = async (
    q: string,
    lang: string | null,
    pipe: string | null,
  ): Promise<void> => {
    if (!q.trim()) return;
    setSearching(true);
    setExpanded(null);
    setError(null);

    // Automatically scroll to the top of the window when a new search starts
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const filters = buildFilters(lang, pipe);
      const res = await window.electronAPI.searchModels(q.trim(), 20, filters);
      setResults(applySort(res, sortBy));
    } catch (searchErr: unknown) {
      console.error('Search failed:', searchErr);
      setError(
        'Failed to connect to HuggingFace. Please check your internet connection or try again later.',
      );
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = (): void => {
    doSearch(query, selectedLanguage, selectedPipeline);
  };

  // ── Filter handlers ──
  const handleLanguageSelect = (code: string | null): void => {
    const newLang = selectedLanguage === code ? null : code;
    setSelectedLanguage(newLang);
    if (query.trim()) doSearch(query, newLang, selectedPipeline);
  };

  const handlePipelineSelect = (tag: string | null): void => {
    const newPipe = selectedPipeline === tag ? null : tag;
    setSelectedPipeline(newPipe);
    if (query.trim()) doSearch(query, selectedLanguage, newPipe);
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
    setDownloads((prev) => ({
      ...prev,
      [filename]: { filename, percent: 0 },
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
              Search HuggingFace to find and download GGUF models.
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
              // ── New Search handler ──
              onSearchBaseModel={(bmQuery) => {
                setQuery(bmQuery);
                doSearch(bmQuery, selectedLanguage, selectedPipeline);
                // scroll to top after triggering search
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          ))}
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
