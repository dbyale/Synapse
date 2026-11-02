import { useCallback, useEffect, useState } from 'react';

export interface DiskSpaceState {
  freeBytes: number;
  totalBytes: number;
  loading: boolean;
  refresh: () => void;
}

/**
 * Free space on the volume models are downloaded to. Fetched once per mount;
 * call refresh after anything that can change the number.
 */
export function useDiskSpace(): DiskSpaceState {
  const [freeBytes, setFreeBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    window.electronAPI
      .getDiskSpace()
      .then((result) => {
        if (cancelled) return undefined;
        if (result) {
          setFreeBytes(result.freeBytes);
          setTotalBytes(result.totalBytes);
        }
        setLoading(false);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const refresh = useCallback(() => setRequestId((current) => current + 1), []);

  return { freeBytes, totalBytes, loading, refresh };
}
