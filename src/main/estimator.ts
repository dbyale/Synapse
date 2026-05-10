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
  const binName = process.platform === 'win32' ? 'gguf-parser.exe' : 'gguf-parser';
  const base = isProd
    ? path.join(process.resourcesPath, 'assets', 'bin', 'utils')
    : path.join(__dirname, '../../assets/bin', 'utils');
  return path.join(base, binName);
}

function extractTotals(data: any) {
  if (!data?.estimate?.items?.[0]) return { vram: 0, ram: 0 };
  const item = data.estimate.items[0];
  const ram = item.ram?.nonuma ?? 0;
  const vram = (item.vrams || []).reduce((acc: number, v: any) => acc + (v.nonuma || 0), 0);
  return { vram, ram };
}

export async function solveMaxConfig(
  modelPath: string,
  vramMB: number,
  ramMB: number,
  ctk: string = 'f16',
  ctv: string = 'f16',
  flashAttention: boolean = false,
  noKvOffload: boolean = true,
  mmap: boolean = false,
  maximizeNGL: boolean = true
): Promise<MemoryEstimation> {
  const vramHardwareMax = vramMB * 1024 * 1024;
  const ramLimitBytes = ramMB * 1024 * 1024;

  async function getParserDataLocal(ngl: number, ctx: number) {
    const args = [
      '--path', modelPath,
      '--ngl', ngl.toString(),
      '--ctx-size', ctx.toString(),
      '--cache-type-k', ctk,
      '--cache-type-v', ctv,
      '--json'
    ];
    if (flashAttention) args.push('--flash-attention');
    if (noKvOffload) args.push('--no-kv-offload');
    if (mmap) args.push('--mmap'); else args.push('--no-mmap');

    try {
      const { stdout } = await execFileAsync(getParserPath(), args);
      return JSON.parse(stdout);
    } catch (e) { return null; }
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
    let midNgl = Math.floor((lowNgl + highNgl) / 2);
    const totals = extractTotals(await getParserDataLocal(midNgl, 512));
    if (totals.vram <= vramHardwareMax && totals.ram <= ramLimitBytes) {
      bestNgl = midNgl;
      lowNgl = midNgl + 1;
    } else {
      highNgl = midNgl - 1;
    }
  }

  console.log(`Starting search from NGL: ${bestNgl} (MaximizeNGL: ${maximizeNGL})`);

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

      const totals = extractTotals(await getParserDataLocal(currentNgl, midCtx));

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
    if (ramUtilization > 0.90 || bestCtx >= maxModelCtx) {
      console.log(`Target reached at NGL ${currentNgl} (${(ramUtilization * 100).toFixed(1)}% RAM used).`);
      break;
    }

    if (currentNgl === 0) break; // Cannot drop lower
    console.log(`NGL ${currentNgl} only filled RAM to ${(ramUtilization * 100).toFixed(1)}%. Dropping NGL...`);
  }

  // 3. Final Breakdown Calculation
  const modelEst = await getParserDataLocal(bestNgl, 1);
  const modelOnly = extractTotals(modelEst);
  const toGB = (bytes: number) => (bytes / (1024 ** 3)).toFixed(2) + " GB";

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
      contextRamUsage: Math.max(0, finalEstimateTotals.ram - modelOnly.ram)
    }
  };
}
