import { formatCapacityTruncated } from './formatters';

/**
 * Split GGUF downloads need room to merge parts back together, so the real
 * requirement is slightly larger than the download itself. Mirrors the guard in
 * utils/models.ts before a merge.
 */
const MERGE_HEADROOM = 1.05;

/** Downloads that consume this much of the volume are flagged as tight. */
const WARNING_USAGE_RATIO = 0.75;

/** Anything less than this left over is flagged as tight. */
const MIN_FREE_AFTER_BYTES = 10 * 1024 ** 3;

export type SpaceLevel = 'ok' | 'warning' | 'critical' | 'unknown';

export function getSpaceLevel(
  neededBytes: number,
  freeBytes: number,
): SpaceLevel {
  if (
    !Number.isFinite(freeBytes) ||
    freeBytes <= 0 ||
    !Number.isFinite(neededBytes) ||
    neededBytes < 0
  ) {
    return 'unknown';
  }
  const requiredBytes = neededBytes * MERGE_HEADROOM;
  if (requiredBytes > freeBytes) return 'critical';
  const remainingBytes = freeBytes - requiredBytes;
  if (
    requiredBytes > freeBytes * WARNING_USAGE_RATIO ||
    remainingBytes < MIN_FREE_AFTER_BYTES
  ) {
    return 'warning';
  }
  return 'ok';
}

/** Bytes that would have to be freed for the download to fit. */
export function getBytesToFree(neededBytes: number, freeBytes: number): number {
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return 0;
  return Math.max(0, neededBytes * MERGE_HEADROOM - freeBytes);
}

export function getSpaceNote(neededBytes: number, freeBytes: number): string {
  const level = getSpaceLevel(neededBytes, freeBytes);
  if (level === 'critical') {
    return `Not enough space on this drive — free up ${formatCapacityTruncated(
      getBytesToFree(neededBytes, freeBytes),
    )} to fit this download.`;
  }
  if (level === 'warning') {
    const remaining = freeBytes - neededBytes * MERGE_HEADROOM;
    return `Only ${formatCapacityTruncated(
      remaining,
    )} will be free after this download.`;
  }
  return '';
}
