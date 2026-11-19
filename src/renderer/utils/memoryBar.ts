// Memory bar composition.
//
// The estimate arrives as measured columns (weights / context / compute) plus an
// analytic breakdown of what those columns are made of. This module turns them
// into ordered, non-overlapping slices: every slice is a share of a column the
// probe measured, so the track always sums to the total printed beside it.
//
// One slice is outside that rule on purpose: the streamed weights (--lazy-mode)
// are billed to the host column by llama.cpp but never held in RAM, so the track
// draws them (hatched) and the printed total does not count them.
import type { MemoryBreakdown, MemoryEstimate } from '../types/profile';

export type BarSide = 'vram' | 'ram';

export type BarSegmentKey =
  | 'layers'
  | 'experts'
  | 'ffn'
  | 'output'
  | 'embedding'
  | 'lazy'
  | 'cache'
  | 'mmproj'
  | 'ctx'
  | 'compute'
  | 'buffer'
  | 'free';

export interface BarSegment {
  key: BarSegmentKey;
  bytes: number;
  /** Fraction of the track total, 0..1. */
  pct: number;
  /** False when the slice is too thin to see. It stays in the legend. */
  visible: boolean;
  /** Placement detail worth putting in the tooltip, e.g. "17 layers". */
  note?: string;
}

/** Below this share of the track a slice is a couple of pixels at best. It is
 *  still real, so it stays in the legend rather than disappearing. */
export const THIN_SEGMENT = 0.005;

const ORDER_VRAM: BarSegmentKey[] = [
  'layers',
  'experts',
  'ffn',
  'output',
  'cache',
  'mmproj',
  'ctx',
  'compute',
];

const ORDER_RAM: BarSegmentKey[] = [
  'layers',
  'experts',
  'ffn',
  'embedding',
  'mmproj',
  'ctx',
  'buffer',
  'compute',
  // Last, beside the free space: it is the one slice the RAM total does not
  // count, so drawing it among the resident bytes would read as part of them.
  'lazy',
];

export function barSegmentLabel(side: BarSide, key: BarSegmentKey): string {
  switch (key) {
    case 'layers':
      return side === 'vram' ? 'Layers (GPU)' : 'Layers (RAM)';
    case 'experts':
      return side === 'vram' ? 'Experts (GPU)' : 'Experts (RAM)';
    case 'ffn':
      return side === 'vram' ? 'Dense FFN (GPU)' : 'Dense FFN (RAM)';
    case 'output':
      return 'Output Head';
    case 'embedding':
      return 'Embedding';
    case 'lazy':
      return 'Streamed Weights';
    case 'cache':
      return 'MoE Cache';
    case 'mmproj':
      return 'Projector';
    case 'ctx':
      return 'KV Cache';
    case 'compute':
      return 'Compute Overhead';
    case 'buffer':
      return 'File Buffer';
    case 'free':
      return 'Free';
    default:
      // Every BarSegmentKey is handled above; this branch only keeps the
      // function total if the union grows.
      return key;
  }
}

function notes(
  side: BarSide,
  key: BarSegmentKey,
  counts: MemoryBreakdown['counts'] | undefined,
): string | undefined {
  if (!counts) return undefined;
  switch (key) {
    case 'layers':
      return `${counts.gpuLayers}/${counts.totalLayers} layers`;
    case 'experts':
      return side === 'ram' && counts.expertLayersSpilled > 0
        ? `${counts.expertLayersSpilled} layers`
        : undefined;
    case 'ffn':
      return side === 'ram' && counts.ffnLayersSpilled > 0
        ? `${counts.ffnLayersSpilled} layers`
        : undefined;
    case 'cache':
      return counts.cacheMib > 0 ? `${counts.cacheMib} MiB` : undefined;
    default:
      return undefined;
  }
}

function assemble(
  side: BarSide,
  parts: Partial<Record<BarSegmentKey, number>>,
  counts: MemoryBreakdown['counts'] | undefined,
  total: number,
): BarSegment[] {
  const ordered = side === 'vram' ? ORDER_VRAM : ORDER_RAM;
  const slices = ordered
    .map((key) => ({ key, bytes: parts[key] ?? 0 }))
    .filter((s) => s.bytes > 0);
  const used = slices.reduce((a, s) => a + s.bytes, 0);
  const out: BarSegment[] = slices.map(({ key, bytes }) => {
    const pct = total > 0 ? bytes / total : 0;
    return {
      key,
      bytes,
      pct,
      visible: pct >= THIN_SEGMENT,
      note: notes(side, key, counts),
    };
  });
  const free = Math.max(0, total - used);
  if (free > 0) {
    const pct = total > 0 ? free / total : 0;
    out.push({ key: 'free', bytes: free, pct, visible: true });
  }
  return out;
}

/**
 * VRAM slices. With a breakdown the weight column splits into the layer types a
 * placement can offload, and the expert cache is carved out of the KV column —
 * llama.cpp bills the cache there, so drawing it beside KV would count it twice.
 * Without one, the measured columns are drawn whole.
 */
export function buildVramBar(
  estimate: MemoryEstimate | null,
  total: number,
): BarSegment[] {
  if (!estimate) return [];
  const b = estimate.breakdown;
  if (!b) {
    return assemble(
      'vram',
      {
        layers: estimate.modelVramUsage,
        ctx: estimate.contextVramUsage,
        compute: estimate.computeOverheadVram,
      },
      undefined,
      total,
    );
  }
  const cache = Math.min(b.vram.cache, estimate.contextVramUsage);
  return assemble(
    'vram',
    {
      layers: b.vram.layers,
      experts: b.vram.experts,
      ffn: b.vram.ffn,
      output: b.vram.output,
      cache,
      mmproj: b.vram.mmprojWeights + b.vram.mmprojEncoder,
      ctx: estimate.contextVramUsage - cache,
      compute: estimate.computeOverheadVram,
    },
    b.counts,
    total,
  );
}

/** RAM slices, same rules: the projector is analytic on both sides, the file
 *  buffer only exists when mmap is off, and the streamed tables are drawn
 *  hatched because they cost the track room without costing the machine RAM. */
export function buildRamBar(
  estimate: MemoryEstimate | null,
  total: number,
): BarSegment[] {
  if (!estimate) return [];
  const b = estimate.breakdown;
  if (!b) {
    return assemble(
      'ram',
      {
        layers: estimate.modelRamUsage,
        ctx: estimate.contextRamUsage,
        buffer: estimate.fileBufferRam,
        compute: estimate.computeOverheadRam,
      },
      undefined,
      total,
    );
  }
  return assemble(
    'ram',
    {
      layers: b.ram.layers,
      experts: b.ram.experts,
      ffn: b.ram.ffn,
      embedding: b.ram.embedding,
      lazy: b.ram.lazy,
      mmproj: b.ram.mmprojWeights + b.ram.mmprojEncoder,
      ctx: estimate.contextRamUsage,
      buffer: estimate.fileBufferRam,
      compute: estimate.computeOverheadRam,
    },
    b.counts,
    total,
  );
}

/** What the legend's "Total" prints: everything the placement occupies. The
 *  streamed tables are already out of these columns — the main process keeps
 *  them out of modelRamUsage — so nothing here has to subtract them. */
export function barUsedBytes(estimate: MemoryEstimate, side: BarSide): number {
  return side === 'vram'
    ? estimate.modelVramUsage +
        estimate.contextVramUsage +
        estimate.computeOverheadVram
    : estimate.modelRamUsage +
        estimate.contextRamUsage +
        estimate.fileBufferRam +
        estimate.computeOverheadRam;
}
