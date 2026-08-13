import { useState, useMemo } from 'react';
import { FileText, Globe, X, Search } from 'lucide-react';

export interface Source {
  title: string;
  url: string;
  kind?: 'top' | 'other';
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Globe size={16} className="sources-sidebar__favicon-fallback" />;
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${getDomain(url)}&sz=16`}
      alt=""
      width={16}
      height={16}
      className="sources-sidebar__favicon"
      onError={() => setFailed(true)}
    />
  );
}

function isWebUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function handleOpen(source: Source) {
  if (isWebUrl(source.url)) {
    window.electronAPI.openExternal(source.url);
  } else {
    window.electronAPI.openPath(source.url);
  }
}

function SourceItem({ source }: { source: Source }) {
  return (
    <button
      type="button"
      key={source.url}
      className="sources-sidebar__item"
      onClick={() => handleOpen(source)}
      title={source.url}
    >
      <div className="sources-sidebar__item-icon">
        {isWebUrl(source.url) ? (
          <Favicon url={source.url} />
        ) : (
          <FileText size={16} className="sources-sidebar__favicon-fallback" />
        )}
      </div>
      <div className="sources-sidebar__item-content">
        <span className="sources-sidebar__item-title">{source.title}</span>
        <span className="sources-sidebar__item-url">{source.url}</span>
      </div>
    </button>
  );
}

export default function SourcesSidebar({
  sources,
  onClose,
  isOpen,
}: {
  sources: Source[];
  onClose: () => void;
  isOpen: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSources = useMemo(() => {
    if (!searchQuery.trim()) return sources;
    const q = searchQuery.toLowerCase();
    return sources.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q),
    );
  }, [sources, searchQuery]);

  const topSources = filteredSources.filter((s) => s.kind === 'top');
  const otherSources = filteredSources.filter((s) => s.kind !== 'top');

  return (
    <div
      className="sources-sidebar-wrapper"
      style={{
        width: isOpen ? 320 : 0,
        minWidth: isOpen ? 320 : 0,
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
      }}
    >
      <div className="sources-sidebar" style={{ width: 320, minWidth: 320 }}>
        <div className="sources-sidebar__header">
          <span className="sources-sidebar__title">Sources</span>
          <button
            type="button"
            className="sources-sidebar__close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="sources-sidebar__search">
          <Search size={14} className="sources-sidebar__search-icon" />
          <input
            type="text"
            className="sources-sidebar__search-input"
            placeholder="Search sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="sources-sidebar__list">
          {filteredSources.length === 0 ? (
            <div className="sources-sidebar__empty">
              {searchQuery ? 'No matching sources' : 'No sources found'}
            </div>
          ) : (
            <>
              {topSources.length > 0 && (
                <>
                  <div className="sources-sidebar__group-title">
                    Top Sources
                  </div>
                  {topSources.map((source) => (
                    <SourceItem key={`top-${source.url}`} source={source} />
                  ))}
                  {otherSources.length > 0 && (
                    <>
                      <div className="sources-sidebar__group-title">
                        Other Sources
                      </div>
                      {otherSources.map((source) => (
                        <SourceItem
                          key={`other-${source.url}`}
                          source={source}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
              {topSources.length === 0 &&
                otherSources.map((source) => (
                  <SourceItem key={source.url} source={source} />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
