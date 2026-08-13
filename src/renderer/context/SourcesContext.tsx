import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Source } from '../components/SourcesSidebar';

interface SourcesContextValue {
  sources: Source[];
  addSources: (newSources: Source[]) => void;
  clearSources: () => void;
  isOpen: boolean;
  openSources: () => void;
  closeSources: () => void;
  toggleSources: () => void;
}

const SourcesContext = createContext<SourcesContextValue | null>(null);

let persistentSources: Source[] = [];

export function SourcesProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Source[]>(persistentSources);
  const [isOpen, setIsOpen] = useState(false);

  const addSources = useCallback((newSources: Source[]) => {
    setSources((prev) => {
      const existingUrls = new Set<string>();
      const kept: Source[] = [];
      for (const s of prev) {
        if (!existingUrls.has(s.url)) {
          kept.push(s);
          existingUrls.add(s.url);
        }
      }
      const seen = new Set(existingUrls);
      const toPrepend: Source[] = [];
      for (const s of newSources) {
        if (!seen.has(s.url)) {
          toPrepend.push(s);
          seen.add(s.url);
        }
      }
      const updated = [
        ...toPrepend,
        ...kept.map((k) => {
          const promoted = newSources.find(
            (s) => s.url === k.url && s.kind === 'top',
          );
          return promoted ? { ...promoted } : k;
        }),
      ];
      persistentSources = updated;
      return updated;
    });
  }, []);

  const clearSources = useCallback(() => {
    persistentSources = [];
    setSources([]);
  }, []);

  const openSources = useCallback(() => setIsOpen(true), []);
  const closeSources = useCallback(() => setIsOpen(false), []);
  const toggleSources = useCallback(() => setIsOpen((v) => !v), []);

  return (
    <SourcesContext.Provider
      value={{ sources, addSources, clearSources, isOpen, openSources, closeSources, toggleSources }}
    >
      {children}
    </SourcesContext.Provider>
  );
}

export function useSourcesContext(): SourcesContextValue {
  const ctx = useContext(SourcesContext);
  if (!ctx) throw new Error('useSourcesContext must be used within SourcesProvider');
  return ctx;
}
