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
  AlertCircle, // 👈 Added Alert icon
} from 'lucide-react';
import type {
  ModelSearchResult,
  LocalModel,
  DownloadProgress,
} from '../preload.d';

import { getCompanyLogoComponent } from '../utils/companyLogos';

// ============================================================================
// AVATAR GENERATION (Fallback for no logo)
// ============================================================================
const AVATAR_COLORS = [
  '#89b4fa', // Blue
  '#f38ba8', // Red
  '#a6e3a1', // Green
  '#f9e2af', // Yellow
  '#cba6f7', // Purple
  '#94e2d5', // Teal
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
    justifyContent: 'center', // Added for alignment
    gap: 6,
    background: 'transparent',
    border: '1px solid transparent', // Keep layout stable
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    padding: '0 8px', // Tweaked padding
    borderRadius: '6px',
    height: 32, // Fixed height for perfect alignment
    lineHeight: '30px', // Forces exact vertical centering
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
    minWidth: 160,
    boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
    zIndex: 10,
  },
  sortOption: {
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: '4px',
    transition: 'all 0.1s ease',
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
    width: 44,
    height: 44,
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
  cardTextCol: { display: 'flex', flexDirection: 'column', gap: 4 },
  modelName: { fontSize: 15, fontWeight: 600 },
  modelMeta: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    display: 'flex',
    gap: 12,
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
  // 👈 New Error Box Styling
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
type SortOption = 'downloads' | 'likes' | 'recent' | 'alphabetical';

const SORT_LABELS: Record<SortOption, string> = {
  downloads: 'Most Downloads',
  likes: 'Most Likes',
  recent: 'Recently Updated',
  alphabetical: 'Alphabetical',
};

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
  const [error, setError] = useState<string | null>(null); // 👈 New error state
  const [results, setResults] = useState<ModelSearchResult[]>([]);

  // Sort State
  const [sortBy, setSortBy] = useState<SortOption>('downloads');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState<ExpandedModel | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>(
    {},
  );

  // Close sort menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Listen for download progress
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

  // Load local models when switching to local tab
  useEffect(() => {
    if (tab === 'local') {
      window.electronAPI
        ?.listLocalModels()
        .then(setLocalModels)
        .catch(console.error);
    }
  }, [tab]);

  // Apply sorting to an array
  const applySort = (data: ModelSearchResult[], sortType: SortOption) => {
    return [...data].sort((a, b) => {
      if (sortType === 'downloads') return b.downloads - a.downloads;
      if (sortType === 'likes') return b.likes - a.likes;
      if (sortType === 'recent') {
        return (
          new Date(b.lastModified).getTime() -
          new Date(a.lastModified).getTime()
        );
      }
      if (sortType === 'alphabetical') return a.id.localeCompare(b.id);
      return 0;
    });
  };

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    setSortMenuOpen(false);
    setResults((prev) => applySort(prev, newSort));
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setExpanded(null);
    setError(null); // Clear previous errors

    try {
      const res = await window.electronAPI.searchModels(query.trim());
      setResults(applySort(res, sortBy));
    } catch (err) {
      console.error('Search failed:', err);
      // Trigger the error state if IPC throws
      setError(
        'Failed to connect to HuggingFace. Please check your internet connection or try again later.',
      );
    } finally {
      setSearching(false);
    }
  };

  const handleExpand = async (repoId: string) => {
    if (expanded?.repoId === repoId) {
      setExpanded(null);
      return;
    }
    setExpanded({ repoId, files: [], loading: true });
    try {
      const files = await window.electronAPI.listModelFiles(repoId);
      setExpanded({ repoId, files, loading: false });
    } catch (err) {
      console.error('Failed to list files:', err);
      setExpanded(null);
    }
  };

  const handleDownload = async (repoId: string, filename: string) => {
    setDownloads((prev) => ({
      ...prev,
      [filename]: { filename, percent: 0 },
    }));
    try {
      await window.electronAPI.downloadModel(repoId, filename);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloads((prev) => {
        const updated = { ...prev };
        delete updated[filename];
        return updated;
      });
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await window.electronAPI.deleteModel(filename);
      const updated = await window.electronAPI.listLocalModels();
      setLocalModels(updated);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  if (!window.electronAPI) {
    return <div style={s.emptyText}>Electron API not available.</div>;
  }

  return (
    <div style={s.page}>
      <h1 style={s.heading}>Models</h1>

      {/* Tabs */}
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

      {/* Browse Tab */}
      {tab === 'browse' && (
        <>
          <div style={s.searchContainer}>
            {/* Top row: Search + Filter + Button */}
            <div style={s.searchRow}>
              <input
                className="input-base"
                style={s.searchInput}
                placeholder="Search HuggingFace for GGUF models..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />

              <button type="button" style={s.filterBtn} title="Filter options">
                <ListFilter size={16} /> Filter
              </button>

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

            {/* Bottom row: Custom Sort Dropdown */}
            <div style={s.sortRow}>
              <span style={s.sortLabel}>
                <ArrowDownUp size={14} /> Sort by:
              </span>

              <div style={s.sortDropdownWrapper} ref={sortRef}>
                <button
                  type="button"
                  style={{
                    ...s.sortTrigger,
                    // Give active state a slight background so it looks like a real control
                    background: sortMenuOpen
                      ? 'var(--bg-hover)'
                      : 'transparent',
                  }}
                  onClick={() => setSortMenuOpen(!sortMenuOpen)}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      transform: 'translateY(-1px)',
                    }}
                  >
                    {SORT_LABELS[sortBy]}
                  </span>
                  <ChevronDown
                    size={14}
                    style={{ marginTop: 2, opacity: 0.8 }}
                  />
                </button>

                {sortMenuOpen && (
                  <div style={s.sortMenu}>
                    {(
                      Object.entries(SORT_LABELS) as [SortOption, string][]
                    ).map(([val, label]) => (
                      <button
                        type="button"
                        key={val}
                        style={{
                          ...s.sortOption,
                          ...(sortBy === val ? s.sortOptionActive : {}),
                        }}
                        onClick={() => handleSortChange(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 👈 The New Error Card */}
          {error && !searching && (
            <div style={s.errorBox}>
              <AlertCircle size={32} style={{ marginBottom: 4 }} />
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                Connection Failed
              </span>
              <span style={{ fontSize: 14, opacity: 0.9 }}>{error}</span>
            </div>
          )}

          {/* Empty State (Hides if error or searching) */}
          {results.length === 0 && !searching && !error && (
            <div style={s.emptyText}>
              Search HuggingFace to find and download GGUF models.
            </div>
          )}

          {results.map((model) => {
            const LogoComponent = getCompanyLogoComponent(model.id);

            return (
              <div key={model.id} style={s.card}>
                <button
                  type="button"
                  style={s.cardHeader}
                  onClick={() => handleExpand(model.id)}
                >
                  <div style={s.cardLeft}>
                    {/* Avatar / Logo Render */}
                    <div
                      style={{
                        ...s.avatar,
                        background: LogoComponent
                          ? '#ffffff'
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
                      <div style={s.modelMeta}>
                        <span>
                          Downloads: {model.downloads.toLocaleString()}
                        </span>
                        <span>Likes: {model.likes.toLocaleString()}</span>
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
                  <div style={s.fileList}>
                    {expanded.loading && (
                      <span className="text-muted">Loading files...</span>
                    )}
                    {!expanded.loading && expanded.files.length === 0 && (
                      <span className="text-muted">No GGUF files found.</span>
                    )}
                    {expanded.files.map((file) => (
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
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Local Tab */}
      {tab === 'local' && (
        <>
          {localModels.length === 0 && (
            <div style={s.emptyText}>
              No models installed yet. Browse and download models first.
            </div>
          )}

          {localModels.map((model) => (
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
