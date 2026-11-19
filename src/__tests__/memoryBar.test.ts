// Unit tests for the memory-bar composition in src/renderer/utils/memoryBar.ts.
// The rule the panel depends on: every slice is a share of a column the probe
// measured, so the track always sums to the total printed beside it — and a
// slice too thin to draw is still listed in the legend.
import {
  THIN_SEGMENT,
  barSegmentLabel,
  barUsedBytes,
  buildRamBar,
  buildVramBar,
} from '../renderer/utils/memoryBar';
import type {
  MemoryBreakdown,
  MemoryEstimate,
} from '../renderer/types/profile';

function breakdown(overrides: Partial<MemoryBreakdown> = {}): MemoryBreakdown {
  return {
    vram: {
      layers: 300,
      experts: 200,
      ffn: 100,
      output: 100,
      cache: 80,
      mmprojWeights: 200,
      mmprojEncoder: 100,
    },
    ram: {
      layers: 400,
      experts: 600,
      ffn: 50,
      embedding: 150,
      lazy: 0,
      mmprojWeights: 0,
      mmprojEncoder: 0,
    },
    counts: {
      gpuLayers: 40,
      totalLayers: 42,
      expertLayersSpilled: 25,
      ffnLayersSpilled: 3,
      cacheMib: 80,
    },
    ...overrides,
  };
}

// Weights (incl. the projector's device share) 1000, context 300, compute 100.
const estimate: MemoryEstimate = {
  modelVramUsage: 1000,
  contextVramUsage: 300,
  computeOverheadVram: 100,
  modelRamUsage: 1200,
  contextRamUsage: 200,
  computeOverheadRam: 60,
  fileBufferRam: 0,
  breakdown: breakdown(),
};

const bytesOf = (
  segments: ReturnType<typeof buildVramBar>,
  key: string,
): number => segments.find((s) => s.key === key)?.bytes ?? 0;

describe('buildVramBar', () => {
  it('splits the weight column into the layer types a placement can offload', () => {
    const segs = buildVramBar(estimate, 2000);
    expect(segs.map((s) => s.key)).toEqual([
      'layers',
      'experts',
      'ffn',
      'output',
      'cache',
      'mmproj',
      'ctx',
      'compute',
      'free',
    ]);
    // The projector is one slice, weights and encoder together.
    expect(bytesOf(segs, 'mmproj')).toBe(300);
    // Subtracting the projector leaves exactly what the probe measured.
    const weights =
      bytesOf(segs, 'layers') +
      bytesOf(segs, 'experts') +
      bytesOf(segs, 'ffn') +
      bytesOf(segs, 'output');
    expect(weights).toBe(estimate.modelVramUsage - 300);
  });

  it('carves the expert cache out of the KV column instead of adding it', () => {
    // llama.cpp bills --moe-cache-mib inside the context column, so drawing it
    // beside KV would count the same bytes twice.
    const segs = buildVramBar(estimate, 2000);
    expect(bytesOf(segs, 'cache')).toBe(80);
    expect(bytesOf(segs, 'ctx')).toBe(300 - 80);
  });

  it('a cache bigger than the KV column cannot make KV negative', () => {
    const big = {
      ...estimate,
      breakdown: breakdown({
        vram: { ...breakdown().vram, cache: 500 },
      }),
    };
    const segs = buildVramBar(big, 2000);
    expect(bytesOf(segs, 'cache')).toBe(300);
    expect(segs.some((s) => s.key === 'ctx')).toBe(false);
  });

  it('the track sums to the total, free space included', () => {
    const total = 2000;
    const segs = buildVramBar(estimate, total);
    expect(segs.reduce((a, s) => a + s.bytes, 0)).toBe(total);
    expect(segs.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(1, 10);
    expect(bytesOf(segs, 'free')).toBe(total - barUsedBytes(estimate, 'vram'));
  });

  it('a slice too thin to draw stays in the legend', () => {
    const thin = 0.001 * 2000; // 0.1% of the track: a couple of pixels
    const small = {
      ...estimate,
      modelVramUsage: 300 + 200 + thin + 100 + 300,
      breakdown: breakdown({
        vram: { ...breakdown().vram, ffn: thin },
      }),
    };
    const segs = buildVramBar(small, 2000);
    const ffn = segs.find((s) => s.key === 'ffn')!;
    expect(ffn.visible).toBe(false);
    expect(THIN_SEGMENT).toBeGreaterThan(ffn.pct);
    // Still counted: the legend and the total both know about it.
    expect(barUsedBytes(small, 'vram')).toBeCloseTo(
      segs.filter((s) => s.key !== 'free').reduce((a, s) => a + s.bytes, 0),
      6,
    );
  });

  it('without a breakdown the measured columns are drawn whole', () => {
    const coarse = { ...estimate, breakdown: null };
    const segs = buildVramBar(coarse, 2000);
    expect(bytesOf(segs, 'layers')).toBe(coarse.modelVramUsage);
    expect(bytesOf(segs, 'ctx')).toBe(coarse.contextVramUsage);
    expect(segs.some((s) => s.key === 'experts')).toBe(false);
    expect(segs.reduce((a, s) => a + s.bytes, 0)).toBe(2000);
  });

  it('carries the placement counts into the tooltip notes', () => {
    const segs = buildVramBar(estimate, 2000);
    expect(segs.find((s) => s.key === 'layers')!.note).toBe('40/42 layers');
    expect(segs.find((s) => s.key === 'cache')!.note).toBe('80 MiB');
    // The GPU side spilled nothing: the spill happened on the host.
    expect(segs.find((s) => s.key === 'experts')!.note).toBeUndefined();
  });

  it('no estimate, no bar', () => {
    expect(buildVramBar(null, 2000)).toEqual([]);
    // A machine with no reported total must not divide by it.
    expect(buildVramBar(estimate, 0).every((s) => s.pct === 0)).toBe(true);
  });
});

describe('buildRamBar', () => {
  it('separates host layers from the experts and FFN spilled off GPU layers', () => {
    const segs = buildRamBar(estimate, 4000);
    expect(segs.map((s) => s.key)).toEqual([
      'layers',
      'experts',
      'ffn',
      'embedding',
      'ctx',
      'compute',
      'free',
    ]);
    const weights =
      bytesOf(segs, 'layers') +
      bytesOf(segs, 'experts') +
      bytesOf(segs, 'ffn') +
      bytesOf(segs, 'embedding');
    expect(weights).toBe(estimate.modelRamUsage);
  });

  it('a projector kept on the host is its own slice there', () => {
    const hostMmproj = {
      ...estimate,
      modelRamUsage: estimate.modelRamUsage + 250,
      breakdown: breakdown({
        ram: { ...breakdown().ram, mmprojWeights: 200, mmprojEncoder: 50 },
      }),
    };
    const segs = buildRamBar(hostMmproj, 4000);
    expect(bytesOf(segs, 'mmproj')).toBe(250);
    const weights =
      bytesOf(segs, 'layers') +
      bytesOf(segs, 'experts') +
      bytesOf(segs, 'ffn') +
      bytesOf(segs, 'embedding');
    expect(weights).toBe(estimate.modelRamUsage);
  });

  it('the file buffer only appears when mmap is off', () => {
    expect(buildRamBar(estimate, 4000).some((s) => s.key === 'buffer')).toBe(
      false,
    );
    const noMmap = { ...estimate, fileBufferRam: 1000 };
    const segs = buildRamBar(noMmap, 4000);
    expect(bytesOf(segs, 'buffer')).toBe(1000);
    expect(barUsedBytes(noMmap, 'ram')).toBe(
      estimate.modelRamUsage +
        estimate.contextRamUsage +
        1000 +
        estimate.computeOverheadRam,
    );
  });

  it('spilled layer counts are reported on the host side', () => {
    const segs = buildRamBar(estimate, 4000);
    expect(segs.find((s) => s.key === 'experts')!.note).toBe('25 layers');
    expect(segs.find((s) => s.key === 'ffn')!.note).toBe('3 layers');
  });

  it('the track sums to the total', () => {
    const segs = buildRamBar(estimate, 4000);
    expect(segs.reduce((a, s) => a + s.bytes, 0)).toBe(4000);
    expect(bytesOf(segs, 'free')).toBe(4000 - barUsedBytes(estimate, 'ram'));
  });
});

describe('the streamed weights --lazy-mode never holds in RAM', () => {
  // llama.cpp reserves them in its host column and then reads them from the
  // file, so the track gives them room and the printed total does not count
  // them. modelRamUsage is already the resident column: the main process takes
  // the streamed bytes out of it.
  const streamed: MemoryEstimate = {
    ...estimate,
    breakdown: breakdown({ ram: { ...breakdown().ram, lazy: 500 } }),
  };

  it('is its own slice, drawn last before the free space', () => {
    const segs = buildRamBar(streamed, 4000);
    expect(segs.map((s) => s.key)).toEqual([
      'layers',
      'experts',
      'ffn',
      'embedding',
      'ctx',
      'compute',
      'lazy',
      'free',
    ]);
    expect(bytesOf(segs, 'lazy')).toBe(500);
    expect(barSegmentLabel('ram', 'lazy')).toBe('Streamed Weights');
  });

  it('is not in the total the legend prints', () => {
    expect(barUsedBytes(streamed, 'ram')).toBe(barUsedBytes(estimate, 'ram'));
  });

  it('still takes room on the track, so free shrinks by it', () => {
    const segs = buildRamBar(streamed, 4000);
    expect(segs.reduce((a, s) => a + s.bytes, 0)).toBe(4000);
    expect(bytesOf(segs, 'free')).toBe(
      4000 - barUsedBytes(estimate, 'ram') - 500,
    );
  });

  it('is absent when nothing is streamed', () => {
    expect(buildRamBar(estimate, 4000).some((s) => s.key === 'lazy')).toBe(
      false,
    );
  });
});

describe('barSegmentLabel', () => {
  it('names the same bytes differently per side', () => {
    expect(barSegmentLabel('vram', 'layers')).toBe('Layers (GPU)');
    expect(barSegmentLabel('ram', 'layers')).toBe('Layers (RAM)');
    expect(barSegmentLabel('vram', 'cache')).toBe('MoE Cache');
    expect(barSegmentLabel('ram', 'mmproj')).toBe('Projector');
  });
});
