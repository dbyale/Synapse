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

export async function solveMaxConfig(
  modelPath: string,
  vramMB: number,
  ramMB: number
): Promise<MemoryEstimation> {
  const parserPath = getParserPath();

  // 1. Define Safety Buffers
  // LLama.cpp needs 'scratch' memory and the OS needs some overhead.
  const overheadBuffer = 256 * 1024 * 1024; // 256MB hard safety buffer
  const vramLimitBytes = (vramMB * 1024 * 1024) - overheadBuffer;
  const ramLimitBytes = (ramMB * 1024 * 1024) - overheadBuffer;

  // 2. Get Model Metadata
  const { stdout: metaOut } = await execFileAsync(parserPath, ['--path', modelPath, '--json', '--skip-estimate']);
  const meta = JSON.parse(metaOut);
  const modelMaxCtx = meta.architecture?.maximumContextLength || 32768;

  // 3. Get scenarios with a small baseline (512) to calculate KV cost
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
  let finalMemUsage = null;

  // Iterate from Max GPU offload down to 0
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const layers = item.offloadLayers;
    const currentNgl = typeof layers === 'number' ? layers : parseInt(layers.split(' ')[0], 10);

    // Weights sizes
    const weightVram = item.vrams?.[0]?.nonuma ?? item.vrams?.[0]?.uma ?? 0;
    const weightRam = item.ram?.nonuma ?? item.ram?.uma ?? 0;

    // If weights alone exceed our limits, this NGL is impossible
    if (weightVram > vramLimitBytes || weightRam > ramLimitBytes) continue;

    // Calculate KV Cache cost per token
    // We compare the total VRAM usage at 512 context vs the weights
    const totalVramAt512 = item.vrams?.[0]?.nonuma || weightVram;
    const vramFor512Tokens = Math.max(0, totalVramAt512 - weightVram);

    // If vramFor512Tokens is 0, it means the parser thinks context is in RAM
    // or it's a very small model. We'll fallback to a safe estimate if needed.
    const kvBytesPerToken = vramFor512Tokens > 0 ? vramFor512Tokens / 512 : 1024 * 0.5; // default 0.5kb/token fallback

    // Calculate how many more tokens can fit in the REMAINING VRAM
    const remainingVram = vramLimitBytes - weightVram;

    // Total possible tokens = (Remaining VRAM / bytes per token)
    // We add the 512 we already accounted for in the 'totalVramAt512'
    let possibleCtx = Math.floor(remainingVram / (kvBytesPerToken || 1));

    // Clamp to model's architectural limit
    possibleCtx = Math.min(possibleCtx, modelMaxCtx);

    // Round down to a power of 2 or multiple of 512 for stability
    possibleCtx = Math.floor(possibleCtx / 512) * 512;

    // A "usable" context is generally 2048+.
    // If we can't even fit 2048, we'll try the next NGL (fewer layers on GPU)
    if (possibleCtx >= 2048 || i === 0) {
      bestNgl = currentNgl;
      finalCtx = Math.max(512, possibleCtx); // Ensure at least 512
      finalMemUsage = {
        modelVramUsage: weightVram,
        contextVramUsage: finalCtx * kvBytesPerToken,
        modelRamUsage: weightRam,
        contextRamUsage: 0 // In this logic, we prefer VRAM context
      };
      break;
    }
  }

  console.log(`[estimator] NGL: ${bestNgl}, CTX: ${finalCtx}`);

  return {
    ngl: bestNgl,
    ctx: finalCtx,
    memory: finalMemUsage
  };
}
