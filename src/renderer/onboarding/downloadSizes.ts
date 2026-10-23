import { useEffect, useMemo, useState } from 'react';
import type { RemoteModelFile } from '../preload.d';
import { getDownloadKey, type DownloadTarget } from '../utils/downloadLinks';

const CACHE_KEY = 'huggingfaceFileSizes';
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  sizeBytes: number;
  cachedAt: number;
}

interface SizeCache {
  version: number;
  entries: Record<string, CacheEntry>;
}

let cache: SizeCache | null = null;

function loadCache(): SizeCache {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SizeCache>;
      if (parsed.version === CACHE_VERSION && parsed.entries) {
        cache = { version: CACHE_VERSION, entries: parsed.entries };
        return cache;
      }
    }
  } catch {
    // Ignore malformed cache data.
  }
  cache = { version: CACHE_VERSION, entries: {} };
  return cache;
}

function readEntry(key: string): CacheEntry | undefined {
  return loadCache().entries[key];
}

function writeEntry(key: string, sizeBytes: number) {
  const current = loadCache();
  current.entries[key] = { sizeBytes, cachedAt: Date.now() };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {
    // Cache writes are best-effort.
  }
}

function isFresh(entry: CacheEntry | undefined): boolean {
  return !!entry && Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

function findRemoteFile(
  files: readonly RemoteModelFile[],
  filename: string,
): RemoteModelFile | undefined {
  return files.find(
    (file) =>
      file.filename === filename || file.filename.endsWith(`/${filename}`),
  );
}

export async function resolveDownloadSizes(
  targets: readonly DownloadTarget[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const byRepo = new Map<string, DownloadTarget[]>();

  targets.forEach((target) => {
    const entries = byRepo.get(target.repoId) ?? [];
    entries.push(target);
    byRepo.set(target.repoId, entries);
  });

  await Promise.all(
    Array.from(byRepo.entries()).map(async ([repoId, repoTargets]) => {
      const needsFetch = repoTargets.some(
        (target) => !isFresh(readEntry(getDownloadKey(target))),
      );

      let files: RemoteModelFile[] | undefined;
      if (needsFetch) {
        try {
          files = await window.electronAPI.listModelFiles(repoId);
        } catch {
          files = undefined;
        }
      }

      repoTargets.forEach((target) => {
        const key = getDownloadKey(target);
        const remoteFile = files
          ? findRemoteFile(files, target.filename)
          : undefined;

        if (remoteFile && remoteFile.sizeBytes > 0) {
          result.set(key, remoteFile.sizeBytes);
          writeEntry(key, remoteFile.sizeBytes);
          return;
        }

        const cached = readEntry(key);
        if (cached) result.set(key, cached.sizeBytes);
      });
    }),
  );

  return result;
}

function getCachedSizes(
  targets: readonly DownloadTarget[],
): Map<string, number> {
  const sizes = new Map<string, number>();
  targets.forEach((target) => {
    const cached = readEntry(getDownloadKey(target));
    if (cached) sizes.set(getDownloadKey(target), cached.sizeBytes);
  });
  return sizes;
}

function uniqueTargets(targets: readonly DownloadTarget[]): DownloadTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = getDownloadKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useDownloadSizes(targets: readonly DownloadTarget[]): {
  sizes: Map<string, number>;
  loading: boolean;
} {
  const stableTargets = useMemo(() => uniqueTargets(targets), [targets]);
  const [sizes, setSizes] = useState(() => getCachedSizes(stableTargets));
  const [loading, setLoading] = useState(() =>
    stableTargets.some((target) => !sizes.has(getDownloadKey(target))),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(getCachedSizes(stableTargets).size < stableTargets.length);

    resolveDownloadSizes(stableTargets)
      .then((resolved) => {
        if (cancelled) return undefined;
        setSizes(resolved);
        setLoading(
          stableTargets.some((target) => !resolved.has(getDownloadKey(target))),
        );
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stableTargets]);

  return { sizes, loading };
}
