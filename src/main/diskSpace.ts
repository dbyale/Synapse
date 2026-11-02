import fs from 'fs';
import path from 'path';
import si from 'systeminformation';
import { getModelsDirectory } from './settings';

export interface DiskSpace {
  /** Directory the measurement was taken for. */
  path: string;
  /** Total capacity of the volume holding that directory. */
  totalBytes: number;
  /** Bytes actually available to the current user on that volume. */
  freeBytes: number;
}

/**
 * statfs fails when a path does not exist yet, which happens the first time a
 * models directory is created. Walk up to the nearest existing ancestor so the
 * volume can still be measured.
 */
function resolveExistingAncestor(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    try {
      fs.accessSync(current, fs.constants.R_OK);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function fromStatfs(dir: string): DiskSpace | null {
  const target = resolveExistingAncestor(dir);
  if (!target) return null;
  try {
    const stats = fs.statfsSync(target);
    if (!stats.bsize || !stats.blocks) return null;
    return {
      path: target,
      totalBytes: stats.blocks * stats.bsize,
      // bavail excludes blocks reserved by the filesystem, unlike bfree.
      freeBytes: Math.max(0, stats.bavail * stats.bsize),
    };
  } catch {
    return null;
  }
}

function normalizeMount(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

type Volume = Awaited<ReturnType<typeof si.fsSize>>[number];

function matchesVolume(volume: Volume, target: string): boolean {
  const mount = normalizeMount(volume.mount);
  // The root mount normalizes to an empty string and matches everything.
  if (!mount) return true;
  return target === mount || target.startsWith(`${mount}/`);
}

/** Longest matching mount wins so extra drives are measured correctly. */
function mountDepth(volume: Volume): number {
  return normalizeMount(volume.mount).length;
}

async function fromSystemInformation(dir: string): Promise<DiskSpace | null> {
  try {
    const volumes = await si.fsSize();
    const target = normalizeMount(path.resolve(dir));
    const matches = volumes
      .filter((volume) => matchesVolume(volume, target))
      .sort((a, b) => mountDepth(b) - mountDepth(a));
    const best = matches[0];
    if (!best) return null;
    return {
      path: dir,
      totalBytes: best.size,
      freeBytes: Math.max(0, best.size - best.used),
    };
  } catch {
    return null;
  }
}

/**
 * Free space on the volume a directory lives on. Defaults to the configured
 * models directory, which is where model downloads are written.
 */
export async function getDiskSpace(dir?: string): Promise<DiskSpace | null> {
  const target = dir || getModelsDirectory();
  const direct = fromStatfs(target);
  if (direct) return direct;
  return fromSystemInformation(target);
}
