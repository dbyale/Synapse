import React, { CSSProperties, useEffect, useState, useRef } from 'react';
import {
  Search,
  Download,
  Trash2,
  HardDrive,
  Cloud,
  ChevronDown,
  ChevronUp,
  Loader,
  ListFilter,
  ArrowDownUp,
  AlertCircle,
  Heart,
  Cpu,
  Calendar,
  Globe,
  TrendingUp,
  Clock,
  X,
  Check,
  Tag,
  Package,
} from 'lucide-react';
import type {
  ModelSearchResult,
  LocalModel,
  DownloadProgress,
  SearchFilter,
} from '../preload.d';

import { getCompanyLogoComponent } from '../utils/companyLogos';
import type { Language } from '../../data/languages';
import type { PipelineTagOption } from '../../data/pipelineTags';
import { LANGUAGES } from '../../data/languages';
import { PIPELINE_TAGS } from '../../data/pipelineTags';

// ============================================================================
// AVATAR GENERATION
// ============================================================================
const AVATAR_COLORS = [
  '#89b4fa',
  '#f38ba8',
  '#a6e3a1',
  '#f9e2af',
  '#cba6f7',
  '#94e2d5',
];

function getAvatarColor(name: string): string {
  const hash = name
    .split('')
    .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.substring(0, 2).toUpperCase();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val >= 10 ? `${Math.round(val)}M` : `${val.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val >= 10 ? `${Math.round(val)}K` : `${val.toFixed(1)}K`;
  }
  return n.toString();
}

// ============================================================================
// STYLES
// ============================================================================
const s: Record<string, CSSProperties> = {
  page: {
    maxWidth: 900,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  heading: { fontSize: 24, fontWeight: 600 },
  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid var(--border)',
    paddingBottom: 0,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 20px',
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  tabActive: {
    color: 'var(--text-primary)',
    borderBottom: '2px solid var(--accent)',
  },
  searchContainer: { display: 'flex', flexDirection: 'column', gap: 12 },
  searchRow: { display: 'flex', gap: 8 },
  searchInput: { flex: 1, padding: '10px 14px', fontSize: 14 },

  filterBtnWrapper: { position: 'relative' },
  filterBtn: {
    padding: '0 16px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    height: '100%',
  },
  filterBtnActive: {
    borderColor: 'var(--accent)',
    background: 'rgba(137, 180, 250, 0.08)',
  },
  filterBadge: {
    background: 'var(--accent)',
    color: '#11111b',
    borderRadius: '50%',
    width: 18,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
  },
  filterPanel: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: 16,
    width: 280,
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  filterSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  filterSectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  filterClearBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 4px',
  },
  filterList: {
    maxHeight: 160,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  filterItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    width: '100%',
  },
  filterItemActive: {
    color: 'var(--text-primary)',
    background: 'var(--bg-hover)',
    fontWeight: 500,
  },
  filterSearchInput: {
    padding: '6px 10px',
    fontSize: 12,
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-primary)',
    marginBottom: 4,
    width: '100%',
    outline: 'none',
  },

  filterChipsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterChipFixed: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    background: 'rgba(137, 180, 250, 0.08)',
    border: '1px solid rgba(137, 180, 250, 0.2)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 500,
  },
  filterChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--text-primary)',
  },
  filterChipX: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: 'none',
    padding: 0,
    marginLeft: 2,
  },

  searchBtn: {
    padding: '10px 20px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  sortRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  sortLabel: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sortDropdownWrapper: { position: 'relative' },
  sortTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    padding: '0 8px',
    borderRadius: '6px',
    height: 32,
    lineHeight: '30px',
  },
  sortMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 190,
    boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
    zIndex: 10,
  },
  sortOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: '4px',
  },
  sortOptionActive: {
    color: 'var(--text-primary)',
    background: 'var(--bg-hover)',
    fontWeight: 500,
  },

  card: {
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    width: '100%',
    textAlign: 'left',
  },
  cardLeft: { display: 'flex', alignItems: 'center', gap: 16 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 600,
    color: '#11111b',
    flexShrink: 0,
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    padding: '6px',
  },
  cardTextCol: { display: 'flex', flexDirection: 'column', gap: 6 },
  modelName: { fontSize: 16, fontWeight: 600 },
  modelMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  taskBadge: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'capitalize',
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  expandedPanel: {
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
  },
  detailsSection: {
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  detailsDate: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  tagsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  hfTag: {
    background: 'rgba(255,255,255,0.05)',
    color: 'var(--text-secondary)',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: 11,
    border: '1px solid rgba(255,255,255,0.05)',
  },
  fileList: {
    borderTop: '1px solid var(--border)',
    padding: '12px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: 'var(--bg-input)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 13,
  },
  dlBtn: {
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  localCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    background: 'var(--bg-secondary)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
  },
  localInfo: { display: 'flex', flexDirection: 'column', gap: 4 },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'transparent',
    color: '#f38ba8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    background: 'var(--bg-hover)',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 2,
    transition: 'width 0.2s ease',
  },
  emptyText: {
    textAlign: 'center',
    color: 'var(--text-secondary)',
    padding: 40,
    fontSize: 14,
  },
  errorBox: {
    margin: '40px auto',
    padding: '24px',
    background: 'rgba(243, 139, 168, 0.08)',
    border: '1px solid rgba(243, 139, 168, 0.3)',
    borderRadius: 'var(--radius-md)',
    color: '#f38ba8',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    maxWidth: 450,
  },
};

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================
type Tab = 'browse' | 'local';
type SortOption = 'trending' | 'downloads' | 'likes' | 'recent';

const SORT_CONFIG: {
  key: SortOption;
  label: string;
  icon: React.FC<{ size?: number }>;
}[] = [
  { key: 'trending', label: 'Trending', icon: TrendingUp },
  { key: 'downloads', label: 'Most Downloads', icon: Download },
  { key: 'likes', label: 'Most Likes', icon: Heart },
  { key: 'recent', label: 'Recently Updated', icon: Clock },
];

interface ExpandedModel {
  repoId: string;
  files: string[];
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
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [langSearch, setLangSearch] = useState('');
  const filterRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState<ExpandedModel | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>(
    {},
  );

  const activeFilterCount =
    (selectedLanguage ? 1 : 0) + (selectedPipeline ? 1 : 0);

  const currentSortConfig = SORT_CONFIG.find(
    (c: {
      key: SortOption;
      label: string;
      icon: React.FC<{ size?: number }>;
    }) => c.key === sortBy,
  )!;

  const filteredLanguages = LANGUAGES.filter(
    (l: Language) =>
      l.label.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.code.toLowerCase().includes(langSearch.toLowerCase()),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  useEffect(() => {
    if (tab === 'local') {
      window.electronAPI
        ?.listLocalModels()
        .then(setLocalModels)
        .catch(console.error);
    }
  }, [tab]);

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
    setSortMenuOpen(false);
    setResults((prev) => applySort(prev, newSort));
  };

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

  const doSearch = async (
    q: string,
    lang: string | null,
    pipe: string | null,
  ): Promise<void> => {
    if (!q.trim()) return;
    setSearching(true);
    setExpanded(null);
    setError(null);

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

  const handleClearFilters = (): void => {
    setSelectedLanguage(null);
    setSelectedPipeline(null);
    setLangSearch('');
    if (query.trim()) doSearch(query, null, null);
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
    return <div style={s.emptyText}>Electron API not available.</div>;
  }

  return (
    <div style={s.page}>
      <h1 style={s.heading}>Models</h1>

      <div style={s.tabs}>
        <button
          type="button"
          style={{ ...s.tab, ...(tab === 'browse' ? s.tabActive : {}) }}
          onClick={() => setTab('browse')}
        >
          <Cloud size={16} /> Browse
        </button>
        <button
          type="button"
          style={{ ...s.tab, ...(tab === 'local' ? s.tabActive : {}) }}
          onClick={() => setTab('local')}
        >
          <HardDrive size={16} /> Installed
        </button>
      </div>

      {tab === 'browse' && (
        <>
          <div style={s.searchContainer}>
            <div style={s.searchRow}>
              <input
                className="input-base"
                style={s.searchInput}
                placeholder="Search HuggingFace for GGUF models..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />

              <div style={s.filterBtnWrapper} ref={filterRef}>
                <button
                  type="button"
                  style={{
                    ...s.filterBtn,
                    ...(filterOpen || activeFilterCount > 0
                      ? s.filterBtnActive
                      : {}),
                  }}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  <ListFilter size={16} />
                  Filter
                  {activeFilterCount > 0 && (
                    <span style={s.filterBadge}>{activeFilterCount}</span>
                  )}
                </button>

                {filterOpen && (
                  <div style={s.filterPanel}>
                    <div>
                      <div style={s.filterSectionHeader}>
                        <span style={s.filterSectionTitle}>
                          <Tag size={12} /> Pipeline Tag
                        </span>
                        {selectedPipeline && (
                          <button
                            type="button"
                            style={s.filterClearBtn}
                            onClick={() => handlePipelineSelect(null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div style={s.filterList}>
                        {PIPELINE_TAGS.map((pt: PipelineTagOption) => (
                          <button
                            type="button"
                            key={pt.id}
                            style={{
                              ...s.filterItem,
                              ...(selectedPipeline === pt.id
                                ? s.filterItemActive
                                : {}),
                            }}
                            onClick={() => handlePipelineSelect(pt.id)}
                          >
                            <span>{pt.label}</span>
                            {selectedPipeline === pt.id && (
                              <Check
                                size={14}
                                style={{ color: 'var(--accent)' }}
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div style={s.filterSectionHeader}>
                        <span style={s.filterSectionTitle}>
                          <Globe size={12} /> Language
                        </span>
                        {selectedLanguage && (
                          <button
                            type="button"
                            style={s.filterClearBtn}
                            onClick={() => handleLanguageSelect(null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <input
                        style={s.filterSearchInput}
                        placeholder="Search languages..."
                        value={langSearch}
                        onChange={(e) => setLangSearch(e.target.value)}
                      />
                      <div style={s.filterList}>
                        {filteredLanguages.map((lang: Language) => (
                          <button
                            type="button"
                            key={lang.code}
                            style={{
                              ...s.filterItem,
                              ...(selectedLanguage === lang.code
                                ? s.filterItemActive
                                : {}),
                            }}
                            onClick={() => handleLanguageSelect(lang.code)}
                          >
                            <span>
                              {lang.label}{' '}
                              <span style={{ opacity: 0.5 }}>
                                ({lang.code})
                              </span>
                            </span>
                            {selectedLanguage === lang.code && (
                              <Check
                                size={14}
                                style={{ color: 'var(--accent)' }}
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        style={{
                          ...s.filterClearBtn,
                          fontSize: 12,
                          textAlign: 'center' as const,
                          padding: '6px 0',
                          borderTop: '1px solid var(--border)',
                          marginTop: 4,
                          paddingTop: 12,
                        }}
                        onClick={handleClearFilters}
                      >
                        Clear All Filters
                      </button>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn-accent"
                style={s.searchBtn}
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? <Loader size={16} /> : <Search size={16} />}
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>

            <div style={s.filterChipsRow}>
              <span style={s.filterChipFixed}>
                <Package size={12} /> GGUF
              </span>

              {selectedPipeline && (
                <span style={s.filterChip}>
                  <Tag size={12} />
                  {PIPELINE_TAGS.find(
                    (p: PipelineTagOption) => p.id === selectedPipeline,
                  )?.label ?? selectedPipeline}
                  <button
                    type="button"
                    style={s.filterChipX}
                    onClick={() => handlePipelineSelect(null)}
                  >
                    <X size={12} />
                  </button>
                </span>
              )}

              {selectedLanguage && (
                <span style={s.filterChip}>
                  <Globe size={12} />
                  {LANGUAGES.find((l: Language) => l.code === selectedLanguage)
                    ?.label ?? selectedLanguage}
                  <button
                    type="button"
                    style={s.filterChipX}
                    onClick={() => handleLanguageSelect(null)}
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>

            <div style={s.sortRow}>
              <span style={s.sortLabel}>
                <ArrowDownUp size={14} /> Sort by:
              </span>

              <div style={s.sortDropdownWrapper} ref={sortRef}>
                <button
                  type="button"
                  style={{
                    ...s.sortTrigger,
                    background: sortMenuOpen
                      ? 'var(--bg-hover)'
                      : 'transparent',
                  }}
                  onClick={() => setSortMenuOpen(!sortMenuOpen)}
                >
                  <currentSortConfig.icon size={14} />
                  <span
                    style={{
                      display: 'inline-block',
                      transform: 'translateY(-1px)',
                    }}
                  >
                    {currentSortConfig.label}
                  </span>
                  <ChevronDown
                    size={14}
                    style={{ marginTop: 2, opacity: 0.8 }}
                  />
                </button>

                {sortMenuOpen && (
                  <div style={s.sortMenu}>
                    {SORT_CONFIG.map(({ key, label, icon: Icon }) => (
                      <button
                        type="button"
                        key={key}
                        style={{
                          ...s.sortOption,
                          ...(sortBy === key ? s.sortOptionActive : {}),
                        }}
                        onClick={() => handleSortChange(key)}
                      >
                        <Icon size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && !searching && (
            <div style={s.errorBox}>
              <AlertCircle size={32} style={{ marginBottom: 4 }} />
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                Connection Failed
              </span>
              <span style={{ fontSize: 14, opacity: 0.9 }}>{error}</span>
            </div>
          )}

          {results.length === 0 && !searching && !error && (
            <div style={s.emptyText}>
              Search HuggingFace to find and download GGUF models.
            </div>
          )}

          {results.map((model: ModelSearchResult) => {
            const LogoComponent = getCompanyLogoComponent(model.id);

            return (
              <div key={model.id} style={s.card}>
                <button
                  type="button"
                  style={s.cardHeader}
                  onClick={() => handleExpand(model.id)}
                >
                  <div style={s.cardLeft}>
                    <div
                      style={{
                        ...s.avatar,
                        background: LogoComponent
                          ? '#333333'
                          : getAvatarColor(model.author),
                      }}
                      title={model.author}
                    >
                      {LogoComponent ? (
                        <LogoComponent
                          style={s.avatarImg as React.CSSProperties}
                        />
                      ) : (
                        getInitials(model.author)
                      )}
                    </div>

                    <div style={s.cardTextCol}>
                      <span style={s.modelName}>{model.id}</span>

                      <div style={s.modelMetaRow}>
                        {model.pipelineTag !== 'none' &&
                          model.pipelineTag !== 'unknown' && (
                            <span style={s.taskBadge}>
                              {model.pipelineTag.replace(/-/g, ' ')}
                            </span>
                          )}

                        {model.parameters && (
                          <span style={s.metaItem} title="Parameters">
                            <Cpu size={14} /> {model.parameters}
                          </span>
                        )}

                        <span style={s.metaItem} title="Downloads">
                          <Download size={14} /> {formatCount(model.downloads)}
                        </span>

                        <span style={s.metaItem} title="Likes">
                          <Heart size={14} /> {formatCount(model.likes)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {expanded?.repoId === model.id ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </button>

                {expanded?.repoId === model.id && (
                  <div style={s.expandedPanel}>
                    <div style={s.detailsSection}>
                      <div style={s.detailsDate}>
                        <Calendar size={13} />
                        Last Updated:{' '}
                        {new Date(model.lastModified).toLocaleDateString(
                          undefined,
                          {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          },
                        )}
                      </div>
                    </div>

                    <div style={s.fileList}>
                      {expanded.loading && (
                        <span className="text-muted">Loading files...</span>
                      )}
                      {!expanded.loading && expanded.files.length === 0 && (
                        <span className="text-muted">No GGUF files found.</span>
                      )}
                      {expanded.files.map((file: string) => (
                        <div key={file} style={s.fileRow}>
                          <span>{file}</span>
                          <div>
                            {downloads[file] ? (
                              <div style={{ width: 120 }}>
                                <div style={s.progressBar}>
                                  <div
                                    style={{
                                      ...s.progressFill,
                                      width: `${downloads[file].percent}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--text-secondary)',
                                  }}
                                >
                                  {downloads[file].percent}%
                                </span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn-accent"
                                style={s.dlBtn}
                                onClick={() => handleDownload(model.id, file)}
                              >
                                <Download size={14} /> Download
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === 'local' && (
        <>
          {localModels.length === 0 && (
            <div style={s.emptyText}>
              No models installed yet. Browse and download models first.
            </div>
          )}

          {localModels.map((model: LocalModel) => (
            <div key={model.filename} style={s.localCard}>
              <div style={s.localInfo}>
                <span style={{ fontWeight: 600 }}>{model.filename}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {formatBytes(model.sizeBytes)}
                </span>
              </div>
              <button
                type="button"
                style={s.deleteBtn}
                onClick={() => handleDelete(model.filename)}
                title="Delete model"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
