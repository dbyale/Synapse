import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppSettings } from '../../preload.d';

// Wall-clock budgets in seconds: finite positive values pass through,
// anything else (absent, corrupt) falls back to the default.
export function normalizeTimeoutSec(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.floor(value as number)
    : fallback;
}

export function useSettingsBuffer() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const savedAllocationsRef = useRef<{
    allocatedRAM?: number;
    allocatedVRAM?: number;
  }>({});

  const load = useCallback(async () => {
    const loaded = await window.electronAPI.loadSettings();
    const normalized: AppSettings = {
      modelsDirectory: loaded?.modelsDirectory || '',
      backendDirectory: loaded?.backendDirectory || '',
      customBinaryPaths: loaded?.customBinaryPaths ?? [],
      backendDownloads: loaded?.backendDownloads ?? [],
      selectedBackend: loaded?.selectedBackend ?? 'Default',
      openvinoDevice: loaded?.openvinoDevice ?? 'CPU',
      openvinoStateful: loaded?.openvinoStateful ?? false,
      resourceAllocation: loaded?.resourceAllocation ?? 'automatic',
      allocatedRAM: loaded?.allocatedRAM,
      allocatedVRAM: loaded?.allocatedVRAM,
      estimatorTimeoutSec: normalizeTimeoutSec(
        loaded?.estimatorTimeoutSec,
        100,
      ),
      serverTimeoutSec: normalizeTimeoutSec(
        loaded?.serverTimeoutSec,
        200,
      ),
      autoOpenThinking: loaded?.autoOpenThinking ?? true,
      autoCloseThinkingDone: loaded?.autoCloseThinkingDone ?? true,
      corsOrigins: loaded?.corsOrigins ?? 'localhost',
      corsMethods: loaded?.corsMethods ?? '',
      corsHeaders: loaded?.corsHeaders ?? '',
      corsCredentials: loaded?.corsCredentials ?? true,
      disableExternalReadmes: loaded?.disableExternalReadmes ?? false,
      launchServerAutomatically: loaded?.launchServerAutomatically ?? true,
      host: loaded?.host ?? '127.0.0.1',
      port: loaded?.port ?? 9931,
    };
    savedAllocationsRef.current = {
      allocatedRAM: normalized.allocatedRAM,
      allocatedVRAM: normalized.allocatedVRAM,
    };
    setSettings(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return { settings, setSettings, savedAllocationsRef, reload: load };
}
