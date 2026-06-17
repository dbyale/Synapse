import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

export interface MemoryEstimation {
  ngl: number;
  ctx: number;
  memory: {
    modelVramUsage: number;
    contextVramUsage: number;
    modelRamUsage: number;
    contextRamUsage: number;
  } | null;
}

function getParserPath(): string {
  const isProd = app.isPackaged;
  const binName =
    process.platform === 'win32' ? 'gguf-parser.exe' : 'gguf-parser';
  const base = isProd
    ? path.join(process.resourcesPath, 'assets', 'bin', 'utils')
    : path.join(__dirname, '../../assets/bin', 'utils');
  return path.join(base, binName);
}

function extractTotals(data: any) {
  if (!data?.estimate?.items?.[0]) return { vram: 0, ram: 0 };
  const item = data.estimate.items[0];
  const ram = item.ram?.nonuma ?? 0;
  const vram = (item.vrams || []).reduce(
    (acc: number, v: any) => acc + (v.nonuma || 0),
    0,
  );
  return { vram, ram };
}

export async function solveMaxConfig(
  modelPath: string,
  vramMB: number,
  ramMB: number,
  ctk: string = 'f16',
  ctv: string = 'f16',
  flashAttention: boolean = false,
  noKvOffload: boolean = false,
  mmap: boolean = true,
  maximizeNGL: boolean = false,
  projectorPath?: string,
): Promise<MemoryEstimation> {
  const vramHardwareMax = vramMB * 1024 * 1024;
  const ramLimitBytes = ramMB * 1024 * 1024;

  async function getParserDataLocal(ngl: number, ctx: number) {
    const args = [
      '--path',
      modelPath,
      '--ngl',
      ngl.toString(),
      '--ctx-size',
      ctx.toString(),
      '--cache-type-k',
      ctk,
      '--cache-type-v',
      ctv,
      '--json',
    ];
    if (flashAttention) args.push('--flash-attention');
    if (noKvOffload) args.push('--no-kv-offload');
    if (mmap) args.push('--mmap');
    else args.push('--no-mmap');
    if (projectorPath) args.push('--mmproj', projectorPath);

    try {
      const { stdout } = await execFileAsync(getParserPath(), args);
      return JSON.parse(stdout);
    } catch (e) {
      console.error('gguf-parser execution failed');
      console.error('Parser path:', getParserPath());
      console.error('Arguments:', args);
      console.error('Error:', e instanceof Error ? e.message : String(e));
      if (e && typeof e === 'object' && 'stderr' in e) {
        console.error('Stderr:', (e as any).stderr);
      }
      return null;
    }
  }

  const meta = await getParserDataLocal(0, 512);
  const totalLayers = meta.architecture.blockCount || 0;
  const maxModelCtx = meta.architecture.maximumContextLength || 4096;

  let bestNgl = 0;
  let bestCtx = 512;
  let finalEstimateTotals = { vram: 0, ram: 0 };

  // 1. Initial Search: Find the highest possible NGL that fits VRAM baseline
  let highNgl = totalLayers;
  let lowNgl = 0;
  while (lowNgl <= highNgl) {
    const midNgl = Math.floor((lowNgl + highNgl) / 2);
    const totals = extractTotals(await getParserDataLocal(midNgl, 512));
    if (totals.vram <= vramHardwareMax && totals.ram <= ramLimitBytes) {
      bestNgl = midNgl;
      lowNgl = midNgl + 1;
    } else {
      highNgl = midNgl - 1;
    }
  }

  console.log(
    `Starting search from NGL: ${bestNgl} (MaximizeNGL: ${maximizeNGL})`,
  );

  // 2. Main Optimization Loop
  for (let currentNgl = bestNgl; currentNgl >= 0; currentNgl--) {
    let tempBestCtx = 512;
    let lowCtx = 512;
    let highCtx = maxModelCtx;
    let tempTotals = { vram: 0, ram: 0 };

    // Binary search for max context at this NGL
    while (lowCtx <= highCtx) {
      let midCtx = Math.floor((lowCtx + highCtx) / 2);
      midCtx = Math.max(512, Math.floor(midCtx / 512) * 512);

      const totals = extractTotals(
        await getParserDataLocal(currentNgl, midCtx),
      );

      if (totals.vram <= vramHardwareMax && totals.ram <= ramLimitBytes) {
        tempBestCtx = midCtx;
        tempTotals = totals;
        lowCtx = midCtx + 512;
      } else {
        highCtx = midCtx - 512;
      }
    }

    bestNgl = currentNgl;
    bestCtx = tempBestCtx;
    finalEstimateTotals = tempTotals;

    // EXIT CRITERIA
    if (maximizeNGL) {
      // If we are maximizing NGL, we stop after the very first valid context search
      console.log(`Maximized NGL at ${bestNgl}. Skipping RAM backtracking.`);
      break;
    }

    const ramUtilization = finalEstimateTotals.ram / ramLimitBytes;
    if (ramUtilization > 0.9 || bestCtx >= maxModelCtx) {
      console.log(
        `Target reached at NGL ${currentNgl} (${(ramUtilization * 100).toFixed(1)}% RAM used).`,
      );
      break;
    }

    if (currentNgl === 0) break; // Cannot drop lower
    console.log(
      `NGL ${currentNgl} only filled RAM to ${(ramUtilization * 100).toFixed(1)}%. Dropping NGL...`,
    );
  }

  // 3. Final Breakdown Calculation
  const modelEst = await getParserDataLocal(bestNgl, 1);
  const modelOnly = extractTotals(modelEst);
  const toGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

  console.log(`
--- Optimization Results ---
Strategy:              ${maximizeNGL ? 'Maximize Speed (NGL)' : 'Maximize Context (RAM)'}
Best GPU Layers (NGL): ${bestNgl}
Best Context (CTX):    ${bestCtx} tokens

Memory Breakdown:
- Model Weights in VRAM:  ${toGB(modelOnly.vram)}
- Context VRAM (Compute): ${toGB(finalEstimateTotals.vram - modelOnly.vram)}
- Context RAM (KV Cache): ${toGB(finalEstimateTotals.ram - modelOnly.ram)}

Hardware Utilization:
- VRAM: ${toGB(finalEstimateTotals.vram)} / ${toGB(vramHardwareMax)} (${((finalEstimateTotals.vram / vramHardwareMax) * 100).toFixed(1)}%)
- RAM:  ${toGB(finalEstimateTotals.ram)} / ${toGB(ramLimitBytes)} (${((finalEstimateTotals.ram / ramLimitBytes) * 100).toFixed(1)}%)
----------------------------------
`);

  return {
    ngl: bestNgl,
    ctx: bestCtx,
    memory: {
      modelVramUsage: modelOnly.vram,
      modelRamUsage: modelOnly.ram,
      contextVramUsage: Math.max(0, finalEstimateTotals.vram - modelOnly.vram),
      contextRamUsage: Math.max(0, finalEstimateTotals.ram - modelOnly.ram),
    },
  };
}

// ── Model Metadata ──

export async function getModelMetadata(
  modelPath: string,
  projectorPath?: string,
): Promise<{ maxLayers: number; maxContext: number } | null> {
  const data = await runGGUFParser(modelPath, 0, 512, projectorPath);
  if (!data?.architecture) return null;
  return {
    maxLayers: data.architecture.blockCount || 0,
    maxContext: data.architecture.maximumContextLength || 4096,
  };
}

// ── Standalone parser call ──

export async function runGGUFParser(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  kvOffload: boolean = true,
  mmap: boolean = true,
  cacheTypeK: string = 'f16',
  cacheTypeV: string = 'f16',
): Promise<any> {
  const args = [
    '--path',
    modelPath,
    '--ngl',
    ngl.toString(),
    '--ctx-size',
    ctx.toString(),
    '--cache-type-k',
    cacheTypeK,
    '--cache-type-v',
    cacheTypeV,
    '--json',
  ];
  if (!kvOffload) args.push('--no-kv-offload');
  if (!mmap) args.push('--no-mmap');
  if (projectorPath) args.push('--mmproj', projectorPath);

  try {
    const { stdout } = await execFileAsync(getParserPath(), args);
    console.log('[gguf-parser]', args.join(' '));
    return JSON.parse(stdout);
  } catch (e) {
    console.error('gguf-parser execution failed');
    console.error('Parser path:', getParserPath());
    console.error('Arguments:', args);
    console.error('Error:', e instanceof Error ? e.message : String(e));
    if (e && typeof e === 'object' && 'stderr' in e) {
      console.error('Stderr:', (e as any).stderr);
    }
    return null;
  }
}

export async function estimateMemoryAtConfig(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  kvOffload: boolean = true,
  mmap: boolean = true,
  cacheTypeK: string = 'f16',
  cacheTypeV: string = 'f16',
): Promise<{
  modelVramUsage: number;
  contextVramUsage: number;
  computeOverheadVram: number;
  modelRamUsage: number;
  contextRamUsage: number;
  computeOverheadRam: number;
  fileBufferRam: number;
}> {
  const [fullData, modelData, baseData] = await Promise.all([
    runGGUFParser(modelPath, ngl, ctx, projectorPath, true, mmap, cacheTypeK, cacheTypeV),
    runGGUFParser(modelPath, ngl, 1, projectorPath, true, mmap, cacheTypeK, cacheTypeV),
    runGGUFParser(modelPath, 0, 1, projectorPath, true, mmap, cacheTypeK, cacheTypeV),
  ]);
  if (!fullData) {
    return {
      modelVramUsage: 0,
      contextVramUsage: 0,
      computeOverheadVram: 0,
      modelRamUsage: 0,
      contextRamUsage: 0,
      computeOverheadRam: 0,
      fileBufferRam: 0,
    };
  }
  const total = extractTotals(fullData);
  const withWeights = modelData ? extractTotals(modelData) : { vram: 0, ram: 0 };
  const base = baseData ? extractTotals(baseData) : { vram: 0, ram: 0 };

  let coV = base.vram;
  let coR = base.vram;
  let mwV = Math.max(0, withWeights.vram - base.vram);
  let mwR = Math.max(0, withWeights.ram - base.vram);
  let kvV = Math.max(0, total.vram - withWeights.vram);
  let kvR = Math.max(0, total.ram - withWeights.ram);

  // When KV cache offload is disabled, move KV cache from VRAM to RAM
  if (!kvOffload) {
    kvR += kvV;
    kvV = 0;
  }

  // With --no-mmap, the OS reads the entire model file into a heap buffer
  // that persists for the process lifetime. The parser's ram.nonuma doesn't
  // track this, so we estimate it from the VRAM model weights.
  const fileBuffer = !mmap ? mwV : 0;

  return {
    computeOverheadVram: coV,
    computeOverheadRam: coR,
    modelVramUsage: mwV,
    modelRamUsage: mwR,
    contextVramUsage: kvV,
    contextRamUsage: kvR,
    fileBufferRam: fileBuffer,
  };
}

// ── Shared estimate cache ──
// Deduplicates in-flight memory estimates and caches results per param set.

const memoryEstimateCache = new Map<string, Promise<any>>();

function estimateCacheKey(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  kvOffload: boolean = true,
  mmap: boolean = true,
  cacheTypeK: string = 'f16',
  cacheTypeV: string = 'f16',
): string {
  return `${modelPath}|${ngl}|${ctx}|${projectorPath ?? ''}|${kvOffload}|${mmap}|${cacheTypeK}|${cacheTypeV}`;
}

export async function getOrEstimateMemory(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  kvOffload: boolean = true,
  mmap: boolean = true,
  cacheTypeK: string = 'f16',
  cacheTypeV: string = 'f16',
) {
  const key = estimateCacheKey(modelPath, ngl, ctx, projectorPath, kvOffload, mmap, cacheTypeK, cacheTypeV);
  const existing = memoryEstimateCache.get(key);
  if (existing) return existing;

  const promise = estimateMemoryAtConfig(modelPath, ngl, ctx, projectorPath, kvOffload, mmap, cacheTypeK, cacheTypeV);
  memoryEstimateCache.set(key, promise);
  try {
    return await promise;
  } finally {
    memoryEstimateCache.delete(key);
  }
}

// ── Shared optimizer state ──
// Allows chat.ts to wait for an in-flight optimization started by the renderer.

const pendingOptimizations = new Map<string, Promise<MemoryEstimation>>();

export async function getOrRunOptimizer(
  modelPath: string,
  vramMB: number,
  ramMB: number,
  maximizeNGL: boolean = false,
  projectorPath?: string,
  kvOffload: boolean = true,
  mmap: boolean = true,
  cacheTypeK: string = 'f16',
  cacheTypeV: string = 'f16',
): Promise<MemoryEstimation> {
  const existing = pendingOptimizations.get(modelPath);
  if (existing) return existing;

  const promise = solveMaxConfig(
    modelPath,
    vramMB,
    ramMB,
    cacheTypeK,
    cacheTypeV,
    undefined,
    !kvOffload,
    mmap,
    maximizeNGL,
    projectorPath,
  );

  pendingOptimizations.set(modelPath, promise);
  try {
    return await promise;
  } finally {
    pendingOptimizations.delete(modelPath);
  }
}
