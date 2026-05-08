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

/**
 * THE SOLVER
 * This finds the highest NGL that allows for a "useful" context,
 * then pushes that context to the absolute VRAM/RAM limit.
 */
export async function solveMaxConfig(
  modelPath: string,
  vramMB: number,
  ramMB: number
): Promise<MemoryEstimation> {
  const parserPath = getParserPath();
  const vramLimitBytes = vramMB * 1024 * 1024;
  const ramLimitBytes = ramMB * 1024 * 1024;

  // 1. Get Model Metadata
  const { stdout: metaOut } = await execFileAsync(parserPath, ['--path', modelPath, '--json', '--skip-estimate']);
  const meta = JSON.parse(metaOut);
  const modelMaxCtx = meta.architecture?.maximumContextLength || 32768;

  // 2. Get all offload scenarios for a baseline context (e.g., 512)
  // We use the parser's step logic to see weight distribution per layer
  const { stdout: stepOut } = await execFileAsync(parserPath, [
    '--path', modelPath,
    '--ctx-size', '512',
    '--gpu-layers-step', '1',
    '--json'
  ]);

  const stepData = JSON.parse(stepOut);
  const items = stepData.estimate?.items || [];

  let bestNgl = 0;
  let finalCtx = 512;
  let finalMem = null;

  /**
   * 3. THE OPTIMIZATION LOOP
   * We look at every NGL scenario from Max down to 0.
   * For each NGL, we see how much VRAM is left and fill it with Context.
   */
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const layers = item.offloadLayers;
    const currentNgl = typeof layers === 'number' ? layers : parseInt(layers.split(' ')[0], 10);

    // Weight sizes for this NGL
    const weightVram = item.vrams?.[0]?.nonuma ?? item.vrams?.[0]?.uma ?? 0;
    const weightRam = item.ram?.nonuma ?? item.ram?.uma ?? 0;

    // If weights alone don't fit in RAM/VRAM, skip
    if (weightVram > vramLimitBytes * 0.9 || weightRam > ramLimitBytes * 0.9) continue;

    // How much VRAM is left for KV Cache?
    const availableVramForKV = (vramLimitBytes * 0.9) - weightVram;

    // estimate context size based on available VRAM
    // KV Cache is roughly proportional to context size.
    // We'll use a binary search or a simple multiplier if the parser supported it,
    // but here we can estimate: (Total VRAM / Baseline VRAM) * Baseline Context
    const kvPerToken = (item.vrams?.[0]?.nonuma - weightVram) / 512; // bytes per token
    let possibleCtx = Math.floor(availableVramForKV / kvPerToken);

    // Clamp to model limits
    possibleCtx = Math.min(possibleCtx, modelMaxCtx);
    // Round to nearest 512
    possibleCtx = Math.max(512, Math.floor(possibleCtx / 512) * 512);

    // If we found a configuration that allows at least 2048 context, we take it.
    // This prioritizes Speed (NGL) as long as Context is usable.
    if (possibleCtx >= 2048 || i === 0) {
      bestNgl = currentNgl;
      finalCtx = possibleCtx;
      finalMem = item;
      break;
    }
  }

  console.log(`[estimator] Final Decision -> NGL: ${bestNgl}, CTX: ${finalCtx}`);

  return {
    ngl: bestNgl,
    ctx: finalCtx,
    memory: finalMem ? {
      modelVramUsage: finalMem.vrams?.[0]?.nonuma || 0,
      contextVramUsage: 0,
      modelRamUsage: finalMem.ram?.nonuma || 0,
      contextRamUsage: 0
    } : null
  };
}
