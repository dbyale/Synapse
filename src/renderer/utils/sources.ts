import type { Source } from '../../shared/chatTypes';

// Sources kept by a search query — an empty query keeps everything. Shared by
// the sources sidebar list and both source counters so they always agree.
export function filterSources(sources: Source[], query: string): Source[] {
  if (!query.trim()) return sources;
  const q = query.toLowerCase();
  return sources.filter(
    (s) => s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q),
  );
}

// Total counter shown in the sources sidebar header and on the chat sources
// button.
export function getSourceCount(sources: Source[], query = ''): number {
  return filterSources(sources, query).length;
}
