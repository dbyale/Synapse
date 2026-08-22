import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import type { Source } from '../../shared/chatTypes';
import { mergeSources } from '../../shared/chatTypes';

interface SourcesContextValue {
  sources: Source[];
  setActiveSession: (sessionId: string | null) => void;
  addSources: (sessionId: string, newSources: Source[]) => void;
  setSources: (sessionId: string, sources: Source[]) => void;
  removeSessionSources: (sessionId: string) => void;
  clearAllSources: () => void;
  isOpen: boolean;
  openSources: () => void;
  closeSources: () => void;
  toggleSources: () => void;
}

const SourcesContext = createContext<SourcesContextValue | null>(null);

export function SourcesProvider({ children }: { children: ReactNode }) {
  const [sourcesBySession, setSourcesBySession] = useState<
    Record<string, Source[]>
  >({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const setActiveSession = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
  }, []);

  const addSources = useCallback((sessionId: string, newSources: Source[]) => {
    if (!sessionId || newSources.length === 0) return;
    setSourcesBySession((prev) => ({
      ...prev,
      [sessionId]: mergeSources(prev[sessionId] ?? [], newSources),
    }));
  }, []);

  const setSources = useCallback((sessionId: string, sources: Source[]) => {
    if (!sessionId) return;
    setSourcesBySession((prev) => ({ ...prev, [sessionId]: sources }));
  }, []);

  const removeSessionSources = useCallback((sessionId: string) => {
    setSourcesBySession((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const clearAllSources = useCallback(() => {
    setSourcesBySession({});
  }, []);

  const openSources = useCallback(() => setIsOpen(true), []);
  const closeSources = useCallback(() => setIsOpen(false), []);
  const toggleSources = useCallback(() => setIsOpen((v) => !v), []);

  const value = useMemo(() => {
    const sources: Source[] = activeSessionId
      ? (sourcesBySession[activeSessionId] ?? [])
      : [];
    return {
      sources,
      setActiveSession,
      addSources,
      setSources,
      removeSessionSources,
      clearAllSources,
      isOpen,
      openSources,
      closeSources,
      toggleSources,
    };
  }, [
    activeSessionId,
    sourcesBySession,
    setActiveSession,
    addSources,
    setSources,
    removeSessionSources,
    clearAllSources,
    isOpen,
    openSources,
    closeSources,
    toggleSources,
  ]);

  return (
    <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>
  );
}

export function useSourcesContext(): SourcesContextValue {
  const ctx = useContext(SourcesContext);
  if (!ctx)
    throw new Error('useSourcesContext must be used within SourcesProvider');
  return ctx;
}
