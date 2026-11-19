import {
  planSummaryLines,
  type OptimizerPlan,
} from '../renderer/utils/planSummary';

const GiB = 1024 ** 3;

const plan = (over: Partial<OptimizerPlan> = {}): OptimizerPlan => ({
  kind: 'moe',
  ngl: 49,
  gpuLayers: 48,
  totalLayers: 48,
  maxCtx: 25600,
  clampedBy: 'vram',
  ...over,
});

const has = (lines: string[], re: RegExp): string | undefined =>
  lines.find((l) => re.test(l));

describe('planSummaryLines reads the solved placement out loud', () => {
  it('says what a pinned MoE did: layers up, experts pinned, no cache', () => {
    const lines = planSummaryLines(plan());
    expect(has(lines, /GPU layers: 48 of 48 blocks \(-ngl 49/)).toBeDefined();
    expect(has(lines, /Expert weights: on the GPU\./)).toBeDefined();
    expect(
      has(
        lines,
        /Expert cache: not used, because no experts are in system RAM/,
      ),
    ).toBeDefined();
    expect(has(lines, /Dense FFN weights: on the GPU\./)).toBeDefined();
    // No --cpu-moe and no pool means no cache line about room running out.
    expect(has(lines, /--cpu-moe/)).toBeUndefined();
  });

  it('names --cpu-moe and the size of the pool it funded', () => {
    const lines = planSummaryLines(
      plan({ cpuMoe: true, nCpuMoe: 48, moeCacheMib: 18668 }),
    );
    expect(
      has(lines, /Expert weights: every layer's experts in system RAM/),
    ).toBeDefined();
    expect(has(lines, /--cpu-moe/)).toBeDefined();
    const cache = has(lines, /Expert cache:/);
    expect(cache).toBeDefined();
    // 18,668 MiB is 18.23 GiB: the pool is big enough that GiB is the readable unit.
    expect(cache).toContain('18.23 GiB');
  });

  it('says so when the plan is spilled but there is no room for a pool', () => {
    const lines = planSummaryLines(plan({ cpuMoe: true, moeCacheMib: 0 }));
    expect(
      has(lines, /Expert weights: every layer's experts in system RAM/),
    ).toBeDefined();
    expect(
      has(lines, /Expert cache: none — the GPU has no room left for one/),
    ).toBeDefined();
  });

  it('keeps a small pool in MiB, where GiB would round it away', () => {
    const lines = planSummaryLines(plan({ cpuMoe: true, moeCacheMib: 16 }));
    expect(has(lines, /Expert cache: 16 MiB of GPU memory/)).toBeDefined();
  });

  it('marks a spill the optimizer did not choose as the user’s own', () => {
    const lines = planSummaryLines(plan({ nCpuMoe: 17, nCpuFfn: 4 }));
    const experts = has(lines, /Expert weights:/);
    expect(experts).toContain('the first 17 layers in system RAM');
    expect(experts).toContain('not chosen by the optimizer');
    const ffn = has(lines, /Dense FFN weights:/);
    expect(ffn).toContain('the first 4 layers in system RAM');
    expect(ffn).toContain('--n-cpu-ffn');
  });

  it('reports the context ceiling and what capped it', () => {
    expect(
      has(
        planSummaryLines(plan({ maxCtx: 77312, clampedBy: 'vram' })),
        /Largest context this holds: 77,312 tokens \(limited by GPU memory\)/,
      ),
    ).toBeDefined();
    expect(
      has(
        planSummaryLines(plan({ clampedBy: 'host' })),
        /limited by system memory/,
      ),
    ).toBeDefined();
    expect(
      has(
        planSummaryLines(plan({ clampedBy: 'model' })),
        /limited by the model's own maximum context/,
      ),
    ).toBeDefined();
    // An unknown reason still reports the number rather than dropping the line.
    expect(
      has(planSummaryLines(plan({ clampedBy: 'train' })), /77,312 tokens/),
    ).toBeUndefined();
    expect(
      has(planSummaryLines(plan({ clampedBy: 'train' })), /25,600 tokens/),
    ).toBeDefined();
  });

  it('warns when nothing fit, and when system memory pages to disk', () => {
    const lines = planSummaryLines(
      plan({ forced: true, hostOverflowBytes: 10.74 * GiB }),
    );
    expect(
      has(
        lines,
        /Nothing fit the GPU memory: this is the option that overflows/,
      ),
    ).toBeDefined();
    expect(has(lines, /System memory: 10\.7 GiB over budget/)).toBeDefined();
    expect(has(lines, /page file/)).toBeDefined();
  });

  it('leaves out the page-file line when host memory is not over budget', () => {
    const lines = planSummaryLines(plan({ hostOverflowBytes: 0 }));
    expect(has(lines, /System memory:/)).toBeUndefined();
    expect(has(lines, /Nothing fit/)).toBeUndefined();
  });

  it('says which bytes the run reads from the file instead of holding', () => {
    const lines = planSummaryLines(plan({ streamedHostBytes: 26.82 * GiB }));
    expect(
      has(lines, /Streamed weights: 26\.8 GiB read from the file on demand/),
    ).toBeDefined();
    expect(has(lines, /--lazy-mode/)).toBeDefined();
  });

  it('leaves out the streamed line when nothing is streamed', () => {
    const lines = planSummaryLines(plan({ streamedHostBytes: 0 }));
    expect(has(lines, /Streamed/)).toBeUndefined();
  });

  it('a dense plan says nothing about experts or their cache', () => {
    const lines = planSummaryLines(
      plan({ kind: 'dense', ngl: 66, gpuLayers: 65, totalLayers: 65 }),
    );
    expect(has(lines, /Expert/)).toBeUndefined();
    expect(has(lines, /GPU layers: 65 of 65 blocks \(-ngl 66/)).toBeDefined();
    expect(has(lines, /Dense FFN weights: on the GPU\./)).toBeDefined();
  });

  it('handles -ngl 0 and a plan without layer counts', () => {
    expect(
      has(
        planSummaryLines(plan({ ngl: 0, gpuLayers: 0 })),
        /GPU layers: none — the whole model runs in system memory/,
      ),
    ).toBeDefined();
    expect(
      has(planSummaryLines({ kind: 'moe', ngl: 42 }), /GPU layers: -ngl 42\./),
    ).toBeDefined();
  });
});
