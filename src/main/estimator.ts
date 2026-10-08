import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import { loadSettings } from './settings';
import type { AppSettings } from './settings';
import { resolveFitBinary } from './backendPaths';
import type { Profile } from '../renderer/types/profile';

const execFileAsync = promisify(execFile);

export interface MemoryEstimation {
  ngl: number;
  ctx: number;
  // Placement triple from the fitter. ngl alone is NOT a complete solution:
  // when the fitter emits -ts/-ot (partial-layer overflow, typically MoE
  // experts spilling to CPU), the server must receive all three together or
  // it will try to hold whole layers resident and blow past VRAM.
  tensorSplit: string | null;
  tensorOverrides: string | null;
  // Host memory beyond the allocated RAM budget. Overflow spills to SSD
  // swap: it still runs, just slower. The optimizer never refuses on RAM.
  hostOverflowBytes: number;
  memory: {
    modelVramUsage: number;
    contextVramUsage: number;
    modelRamUsage: number;
    contextRamUsage: number;
  } | null;
}

const MiB = 1024 * 1024;
const FIT_TIMEOUT_MS = 180000;
const CTX_SNAP = 512;
const CTX_MIN = 512;

// Developer mode: full fit results are dumped to the main-process console.
// Same check as the app menu (menu.ts) so it holds under `npm start` and
// DEBUG_PROD builds, but stays quiet in packaged production.
function isDev(): boolean {
  return (
    process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'
  );
}

function getParallel(profile: Partial<Profile>): number {
  // Server parity (chat.ts buildLlamaServerArgs): -1/undefined means 1 slot.
  const p = profile.parallel;
  if (p === undefined || p === -1) return 1;
  return p;
}

interface FitDeviceRow {
  name: string;
  model: number;
  context: number;
  compute: number;
}

interface FitPrintResult {
  devices: FitDeviceRow[];
  host: { model: number; context: number; compute: number };
}

// ── Capability probe ──
// llama-fit-params shares llama.cpp's common-params surface, but the exact
// flag set varies by build (notably the multimodal/vision flags). Probe once
// per binary and only emit supported flags. Requested-but-unsupported CORE
// flags (model placement) are hard errors; vision refinements only warn.

const helpCache = new Map<string, Set<string>>();

async function getSupportedFlags(fitPath: string): Promise<Set<string>> {
  const cached = helpCache.get(fitPath);
  if (cached) return cached;
  const { stdout } = await execFileAsync(fitPath, ['--help'], {
    timeout: 30000,
    maxBuffer: 16 * MiB,
  });
  const flags = new Set<string>();
  (stdout.match(/--[a-z0-9][a-z0-9-]*/g) ?? []).forEach((f) => flags.add(f));
  helpCache.set(fitPath, flags);
  return flags;
}

async function resolveFitPath(): Promise<string> {
  const settings = loadSettings();
  const { fitParamsPath } = await resolveFitBinary(settings);
  if (!fs.existsSync(fitParamsPath)) {
    throw new Error(
      `llama-fit-params binary not found at ${fitParamsPath}. ` +
        `Re-download the backend (it now ships alongside llama-server).`,
    );
  }
  return fitParamsPath;
}

export function pushIfSupported(
  args: string[],
  supported: Set<string>,
  flag: string,
  value?: string,
  context?: string,
): void {
  if (!supported.has(flag)) {
    // Best-effort by design: every flag is optional. A build that lacks a
    // flag measures without that effect (e.g. no --mmproj means the vision
    // projector is excluded) instead of failing the whole estimate. The
    // warning names what was skipped so the gap stays diagnosable.
    console.warn(
      `[fit-estimator] llama-fit-params does not support ${flag}${
        context ? ` (${context})` : ''
      }. Update the backend binaries. Skipping.`,
    );
    return;
  }
  args.push(flag);
  if (value !== undefined) args.push(value);
}

// ── Shared arg builder (server parity) ──
// Mirrors buildLlamaServerArgs in chat.ts for every memory-relevant flag so
// the estimate measures exactly what the server will launch, including the
// multimodal projector block (--mmproj + supporting vision flags).

export function appendCommonFitArgs(
  args: string[],
  supported: Set<string>,
  profile: Partial<Profile>,
  projectorPath: string | undefined,
): void {
  const p = profile as any;

  // Cache / attention
  pushIfSupported(args, supported, '--cache-type-k', p.cacheTypeK ?? 'f16');
  pushIfSupported(args, supported, '--cache-type-v', p.cacheTypeV ?? 'f16');
  if (p.flashAttn) {
    pushIfSupported(args, supported, '--flash-attn', String(p.flashAttn));
  }
  if (profile.kvOffload === false) {
    pushIfSupported(args, supported, '--no-kv-offload');
  }

  // Parallel slots change KV sizing (n_seq_max) — always explicit like server.
  pushIfSupported(args, supported, '--parallel', String(getParallel(profile)));

  // MoE placement
  if (profile.cpuMoe === true) pushIfSupported(args, supported, '--cpu-moe');
  if (
    profile.nCpuMoe !== undefined &&
    profile.nCpuMoe > 0 &&
    profile.cpuMoe !== true
  ) {
    pushIfSupported(args, supported, '--n-cpu-moe', String(profile.nCpuMoe));
  }

  // Memory mode: fit has no --no-mmap/--mlock pair, only --load-mode.
  const mmap = p.mmap ?? true;
  const mlock = p.mlock ?? false;
  if (mmap === false) {
    pushIfSupported(args, supported, '--load-mode', 'none');
  } else if (mlock === true) {
    pushIfSupported(args, supported, '--load-mode', 'mmap+mlock');
  }
  if (p.repack === false) pushIfSupported(args, supported, '--no-repack');

  // Context scaling (only meaningful with an active method, like server)
  const scaling = p.rope?.scaling;
  if (scaling) {
    pushIfSupported(args, supported, '--rope-scaling', String(scaling));
    if (p.rope?.scale !== undefined && p.rope.scale !== 1.0) {
      pushIfSupported(args, supported, '--rope-scale', String(p.rope.scale));
    }
    if (p.rope?.freqBase !== undefined) {
      pushIfSupported(
        args,
        supported,
        '--rope-freq-base',
        String(p.rope.freqBase),
      );
    }
    if (p.rope?.freqScale !== undefined && p.rope.freqScale !== 1.0) {
      pushIfSupported(
        args,
        supported,
        '--rope-freq-scale',
        String(p.rope.freqScale),
      );
    }
  }
  if (scaling === 'yarn') {
    if (p.yarn?.origCtx !== undefined && p.yarn.origCtx !== 0) {
      pushIfSupported(
        args,
        supported,
        '--yarn-orig-ctx',
        String(p.yarn.origCtx),
      );
    }
    if (p.yarn?.extFactor !== undefined && p.yarn.extFactor !== -1.0) {
      pushIfSupported(
        args,
        supported,
        '--yarn-ext-factor',
        String(p.yarn.extFactor),
      );
    }
    if (p.yarn?.attnFactor !== undefined && p.yarn.attnFactor !== -1.0) {
      pushIfSupported(
        args,
        supported,
        '--yarn-attn-factor',
        String(p.yarn.attnFactor),
      );
    }
    if (p.yarn?.betaSlow !== undefined && p.yarn.betaSlow !== -1.0) {
      pushIfSupported(
        args,
        supported,
        '--yarn-beta-slow',
        String(p.yarn.betaSlow),
      );
    }
    if (p.yarn?.betaFast !== undefined && p.yarn.betaFast !== -1.0) {
      pushIfSupported(
        args,
        supported,
        '--yarn-beta-fast',
        String(p.yarn.betaFast),
      );
    }
  }

  // ── Multimodal projector block (server parity) ──
  // Best-effort: on builds whose fit binary lacks the vision flags the
  // projector is skipped with a warning and the measurement covers the text
  // model only. A build advertising --mmproj includes it automatically.
  if (projectorPath) {
    if (!fs.existsSync(projectorPath)) {
      throw new Error(`Projector file not found at ${projectorPath}.`);
    }
    pushIfSupported(
      args,
      supported,
      '--mmproj',
      projectorPath,
      `vision projector measurement for ${projectorPath}`,
    );
  }
  if (p.mmprojOffload === false) {
    pushIfSupported(
      args,
      supported,
      '--no-mmproj-offload',
      undefined,
      'vision projector placement',
    );
  }
  if (p.imageMinTokens !== undefined && p.imageMinTokens > 0) {
    pushIfSupported(
      args,
      supported,
      '--image-min-tokens',
      String(p.imageMinTokens),
    );
  }
  if (p.imageMaxTokens !== undefined && p.imageMaxTokens > 0) {
    pushIfSupported(
      args,
      supported,
      '--image-max-tokens',
      String(p.imageMaxTokens),
    );
  }
  if (p.mtmdBatchMaxTokens !== undefined && p.mtmdBatchMaxTokens !== 1024) {
    pushIfSupported(
      args,
      supported,
      '--mtmd-batch-max-tokens',
      String(p.mtmdBatchMaxTokens),
    );
  }
}

// Cancellation for superseded fits (e.g. rapid ctx-slider stops). A runId
// identifies one logical run across its sequential probes; cancelFitRun
// kills the in-flight child and every subsequent probe throws immediately.
// Callers distinguish FitCancelledError from real failures and drop it.
export class FitCancelledError extends Error {
  constructor() {
    super('Fit run cancelled');
    this.name = 'FitCancelledError';
  }
}

let fitRunCounter = 0;
const fitRuns = new Map<
  number,
  { cancelled: boolean; child: ChildProcess | null }
>();

export function createFitRun(): number {
  const id = fitRunCounter + 1;
  fitRunCounter = id;
  fitRuns.set(id, { cancelled: false, child: null });
  return id;
}

export function cancelFitRun(id: number): void {
  const rec = fitRuns.get(id);
  if (!rec) return;
  rec.cancelled = true;
  try {
    rec.child?.kill();
  } catch {
    // Already exited — the cancelled flag still stops later probes.
  }
}

function endFitRun(id: number): void {
  fitRuns.delete(id);
}

function fitFailure(
  args: string[],
  reason: string,
  stderrTail: string,
): Error {
  return new Error(
    `llama-fit-params failed (${args.join(' ')}): ${reason}${
      stderrTail ? `\n${stderrTail}` : ''
    }`,
  );
}

async function runFit(
  fitPath: string,
  args: string[],
  runId?: number,
): Promise<{ stdout: string; stderr: string }> {
  const rec = runId !== undefined ? fitRuns.get(runId) : undefined;
  if (rec?.cancelled) throw new FitCancelledError();
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rec) rec.child = null;
      fn();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already exited.
      }
    }, FIT_TIMEOUT_MS);
    const child = spawn(fitPath, args);
    if (rec) rec.child = child;
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < 16 * MiB) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 16 * MiB) stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      finish(() =>
        reject(fitFailure(args, err.message, stderr.slice(-4000))),
      );
    });
    child.on('close', (code: number | null) => {
      if (rec?.cancelled) {
        finish(() => reject(new FitCancelledError()));
      } else if (timedOut) {
        finish(() =>
          reject(
            fitFailure(
              args,
              `timed out after ${FIT_TIMEOUT_MS}ms`,
              stderr.slice(-4000),
            ),
          ),
        );
      } else if (code !== 0) {
        finish(() =>
          reject(
            fitFailure(
              args,
              `exit code ${code}`,
              stderr.slice(-4000),
            ),
          ),
        );
      } else {
        finish(() => resolve({ stdout, stderr }));
      }
    });
  });
}

export function parseFittedArgs(stdout: string): {
  ctx: number;
  ngl: number;
  tensorSplit?: string;
  overrides?: string;
} {
  // ngl may be negative: -1 is the fitter's full-offload sentinel.
  const m = stdout.match(/-c\s+(\d+)\s+-ngl\s+(-?\d+)/);
  if (!m) {
    throw new Error(
      `Could not parse fitted arguments from llama-fit-params output: ${JSON.stringify(stdout.slice(0, 500))}`,
    );
  }
  const ts = stdout.match(/-ts\s+([\d.,]+)/);
  const ot = stdout.match(/-ot\s+"([^"]*)"/);
  return {
    ctx: parseInt(m[1], 10),
    ngl: parseInt(m[2], 10),
    tensorSplit: ts?.[1],
    overrides: ot?.[1],
  };
}

export function parseFitPrint(stdout: string): FitPrintResult {
  const devices: FitDeviceRow[] = [];
  let host = { model: 0, context: 0, compute: 0 };
  stdout.split('\n').forEach((line) => {
    const t = line.trim();
    if (!t) return;
    // "<devName> <modelMiB> <contextMiB> <computeMiB>" or "Host …"
    const m = t.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!m) return;
    const row = {
      name: m[1],
      model: parseInt(m[2], 10) * MiB,
      context: parseInt(m[3], 10) * MiB,
      compute: parseInt(m[4], 10) * MiB,
    };
    if (m[1].toLowerCase() === 'host') {
      host = { model: row.model, context: row.context, compute: row.compute };
    } else {
      devices.push(row);
    }
  });
  if (devices.length === 0 && host.model === 0 && host.context === 0) {
    throw new Error(
      `Could not parse --fit-print output: ${JSON.stringify(stdout.slice(0, 500))}`,
    );
  }
  return { devices, host };
}

interface DeviceBudget {
  total: number;
  margin: number;
}

export function parseListDevices(
  stderrOrStdout: string,
): { name: string; total: number }[] {
  // "Vulkan0: <desc> (<total> MiB, <free> MiB free)" — be lenient, some
  // shared-memory devices report odd totals.
  const out: { name: string; total: number }[] = [];
  stderrOrStdout.split('\n').forEach((line) => {
    const m = line.match(/^\s*(\S+):.*\((\d+)\s*MiB\s*,\s*(\d+)\s*MiB\s*free/);
    if (m) {
      out.push({ name: m[1], total: parseInt(m[2], 10) * MiB });
      return;
    }
    const fallback = line.match(/(\d+)\s*MiB\s*,\s*(\d+)\s*MiB\s*free/);
    if (fallback)
      out.push({ name: '', total: parseInt(fallback[1], 10) * MiB });
  });
  return out;
}

// Device totals are static per machine/backend build — probe once per binary.
// (Only totals are cached; live free VRAM is always read fresh by the fitter.)
const deviceTotalsCache = new Map<string, { name: string; total: number }[]>();

async function getDeviceTotals(
  fitPath: string,
): Promise<{ name: string; total: number }[]> {
  const cached = deviceTotalsCache.get(fitPath);
  if (cached) return cached;
  try {
    const { stdout, stderr } = await execFileAsync(
      fitPath,
      ['--list-devices'],
      { timeout: 30000, maxBuffer: 4 * MiB },
    );
    const devices = parseListDevices(`${stdout}\n${stderr}`);
    if (devices.length > 0) deviceTotalsCache.set(fitPath, devices);
    return devices;
  } catch (e) {
    console.warn(
      '[fit-estimator] --list-devices probe failed.',
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

// Translates the user's allocatedVRAM cap into per-device --fit-target
// margins (memory to LEAVE free), in the order of usedNames. Proportional
// split across those devices so a multi-GPU list stays meaningful.
// IMPORTANT: margins only make sense for the devices the fitter will
// actually use (llama.cpp often picks a subset, e.g. discrete GPU only).
// Callers must discover that set first (one fit-print probe) and pin it via
// --device so margin order matches the fitter's device order.
async function computeFitMargins(
  fitPath: string,
  vramMB: number | undefined,
  usedNames: string[],
): Promise<number[]> {
  // Automatic allocation (no cap): flat llama.cpp default margin per device —
  // fit purely to live free memory.
  if (vramMB === undefined) {
    const n = Math.max(1, usedNames.length);
    return Array.from({ length: n }, () => 1024 * MiB);
  }
  const allocated = vramMB * MiB;
  const all = await getDeviceTotals(fitPath);
  const byName = new Map(all.map((d) => [d.name, d.total]));
  const totals = usedNames.map((n, i) => {
    const t = byName.get(n);
    if (t !== undefined && t > 0) return t;
    // Fall back to positional mapping when names don't line up.
    const p = all[i]?.total ?? 0;
    if (p > 0) return p;
    return 0;
  });
  const known = totals.filter((t) => t > 0);
  if (known.length === 0) return usedNames.map(() => 1024 * MiB);
  const sum = known.reduce((a, t) => a + t, 0);
  return totals.map((t) => {
    if (t <= 0) return 1024 * MiB;
    const share = allocated * (t / sum);
    // Floor: a zero margin ("leave nothing free") overpacks past what the
    // driver needs headroom for. Matches llama.cpp's own 1024 default.
    return Math.max(1024 * MiB, Math.round(t - share));
  });
}

function marginsForCli(margins: number[]): string {
  return margins.map((m) => String(Math.round(m / MiB))).join(',');
}

export interface ResolvedBudgets {
  mode: 'automatic' | 'manual';
  // Undefined in automatic mode: fit to live free memory (flat 1024 MiB
  // margins) with no fixed caps. Defined in manual mode from the sliders.
  vramMB?: number;
  ramMB?: number;
}

// Single translation from stored settings to optimizer budgets, shared by
// the runOptimizer/maxSpeedCtx IPC handlers and chat loadProfile.
export function resolveBudgets(settings: AppSettings): ResolvedBudgets {
  if ((settings.resourceAllocation ?? 'automatic') === 'automatic') {
    return { mode: 'automatic', vramMB: undefined, ramMB: undefined };
  }
  return {
    mode: 'manual',
    vramMB: settings.allocatedVRAM ?? 4096,
    ramMB: settings.allocatedRAM ?? 8192,
  };
}

// ── Minimal GGUF header reader (replaces parser metadata) ──
// Walks the KV store at the start of the file to find
// <arch>.block_count and <arch>.context_length.

const GGUF_TYPE_SIZES: Record<number, number> = {
  0: 1, // uint8
  1: 1, // int8
  2: 2, // uint16
  3: 2, // int16
  4: 4, // uint32
  5: 4, // int32
  6: 4, // float32
  7: 1, // bool
  10: 8, // uint64
  11: 8, // int64
  12: 8, // float64
};

export async function readGgufMetadata(
  modelPath: string,
): Promise<{ maxLayers: number; maxContext: number }> {
  const fh = await fs.promises.open(modelPath, 'r');
  try {
    const stat = await fh.stat();
    const CHUNK = 256 * 1024;
    let buf = Buffer.alloc(0);
    let pos = 0;
    // Serial chunk reads: each read advances the file cursor.
    /* eslint-disable no-await-in-loop */
    const ensure = async (need: number) => {
      while (buf.length < need && pos < stat.size) {
        const toRead = Math.min(CHUNK, stat.size - pos);
        const chunk = Buffer.alloc(toRead);
        const { bytesRead } = await fh.read(chunk, 0, toRead, pos);
        pos += bytesRead;
        buf = Buffer.concat([buf, chunk.slice(0, bytesRead)]);
        if (bytesRead === 0) break;
      }
      if (buf.length < need) throw new Error('Unexpected EOF in GGUF header.');
    };
    /* eslint-enable no-await-in-loop */
    let off = 0;
    const take = (n: number): Buffer => {
      const s = buf.slice(off, off + n);
      off += n;
      return s;
    };
    const u64 = (): bigint => {
      const v = buf.readBigUInt64LE(off);
      off += 8;
      return v;
    };
    const readStr = async (): Promise<string> => {
      await ensure(off + 8);
      const len = Number(u64());
      if (len > 256 * MiB) throw new Error('Implausible GGUF string length.');
      await ensure(off + len);
      return take(len).toString('utf8');
    };

    await ensure(4 + 4 + 8 + 8);
    if (take(4).toString('ascii') !== 'GGUF') {
      throw new Error(`Not a GGUF file: ${modelPath}`);
    }
    take(4); // version
    u64(); // tensor count (not needed for estimation)
    const nKv = Number(u64());

    let arch = '';
    let blockCount: number | null = null;
    let contextLength: number | null = null;

    // Sequential by necessity: GGUF KV entries are variable-length back to
    // back, so each entry must be parsed to find the next.
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < nKv; i += 1) {
      const key = await readStr();
      await ensure(off + 4);
      const type = buf.readUInt32LE(off);
      off += 4;
      if (key === 'general.architecture') {
        if (type !== 8)
          throw new Error('general.architecture is not a string.');
        arch = await readStr();
      } else if (type === 4) {
        await ensure(off + 4);
        const v = buf.readUInt32LE(off);
        off += 4;
        if (key === `${arch}.block_count`) blockCount = v;
        else if (key === `${arch}.context_length`) contextLength = v;
      } else if (type === 8) {
        await readStr();
      } else if (type === 9) {
        await ensure(off + 12);
        const arrType = buf.readUInt32LE(off);
        off += 4;
        const arrLen = Number(u64());
        if (arrType === 8) {
          for (let j = 0; j < arrLen; j += 1) {
            await readStr();
          }
        } else {
          const sz = GGUF_TYPE_SIZES[arrType];
          if (sz === undefined)
            throw new Error(`Unsupported GGUF array type ${arrType}.`);
          await ensure(off + arrLen * sz);
          off += arrLen * sz;
        }
      } else {
        const sz = GGUF_TYPE_SIZES[type];
        if (sz === undefined)
          throw new Error(
            `Unsupported GGUF metadata type ${type} for key ${key}.`,
          );
        await ensure(off + sz);
        off += sz;
      }
      if (blockCount !== null && contextLength !== null) break;
      // Keep the window sliding to bound memory on huge KV stores.
      if (off > 128 * 1024) {
        buf = buf.slice(off);
        off = 0;
      }
    }
    /* eslint-enable no-await-in-loop */

    return {
      maxLayers: blockCount ?? 0,
      maxContext: contextLength ?? 4096,
    };
  } finally {
    await fh.close();
  }
}

export async function getModelMetadata(
  modelPath: string,
  // Kept for caller compatibility (the old parser accepted a projector here);
  // the header read never needs it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _projectorPath?: string,
): Promise<{ maxLayers: number; maxContext: number } | null> {
  try {
    return await readGgufMetadata(modelPath);
  } catch (e) {
    console.error(
      '[fit-estimator] GGUF header read failed:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ── Measurement oracle: single no_alloc probe ──

async function measureAtConfig(
  fitPath: string,
  supported: Set<string>,
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath: string | undefined,
  profile: Partial<Profile>,
  opts?: {
    device?: string;
    tensorSplit?: string | null;
    overrides?: string | null;
    runId?: number;
  },
): Promise<FitPrintResult> {
  const args = ['-m', modelPath, '-c', String(ctx), '-ngl', String(ngl)];
  appendCommonFitArgs(args, supported, profile, projectorPath);
  if (opts?.device) {
    pushIfSupported(args, supported, '--device', opts.device);
  }
  // Placement triple: measuring WITH the fitter's -ts/-ot reports the true
  // launch-time split. Without them a partial-overflow plan reads as whole
  // layers resident and wildly overstates device memory.
  if (opts?.tensorSplit) args.push('-ts', opts.tensorSplit);
  if (opts?.overrides) args.push('-ot', opts.overrides);
  args.push('--fit-print', 'on');
  const { stdout } = await runFit(fitPath, args, opts?.runId);
  return parseFitPrint(stdout);
}

function vramFits(m: FitPrintResult, budgets: DeviceBudget[]): boolean {
  if (m.devices.length === 0) return true;
  if (m.devices.length !== budgets.length) {
    const used = m.devices.reduce(
      (a, d) => a + d.model + d.context + d.compute,
      0,
    );
    const budget = budgets.reduce((a, b) => a + (b.total - b.margin), 0);
    return used <= budget;
  }
  return m.devices.every((d, i) => {
    const used = d.model + d.context + d.compute;
    return used <= budgets[i].total - budgets[i].margin;
  });
}

// ── Optimizer ──

// Shared preparation: binary, flags, header, device discovery, budgets.
// Returned as one object so fitLayersForContext and maxFullOffloadCtx stay
// consistent (same device set, same margins, same order).
interface FitPrep {
  fitPath: string;
  supported: Set<string>;
  maxLayers: number;
  maxModelCtx: number;
  usedNames: string[];
  deviceArg: string | undefined;
  marginsMiB: number[];
  budgets: DeviceBudget[];
}

async function prepareFit(
  modelPath: string,
  vramMB: number | undefined,
  projectorPath: string | undefined,
  profile: Partial<Profile>,
  discoveryCtx: number,
  runId?: number,
): Promise<FitPrep> {
  const fitPath = await resolveFitPath();
  const supported = await getSupportedFlags(fitPath);

  const meta = await readGgufMetadata(modelPath);
  const maxModelCtx = meta.maxContext || 4096;

  // Discover which devices llama.cpp actually selects for this model
  // (often a subset, e.g. discrete GPU only). Margins are only meaningful
  // for that set, in that order — so pin it via --device for every later
  // probe. The server uses the same default selection, so this stays
  // representative of launch-time placement.
  const discoveryNgl = meta.maxLayers > 0 ? meta.maxLayers : 9999;
  const discovery = await measureAtConfig(
    fitPath,
    supported,
    modelPath,
    discoveryNgl,
    discoveryCtx,
    projectorPath,
    profile,
    { runId },
  );
  const usedNames = discovery.devices.map((d) => d.name);
  const deviceArg = usedNames.length > 0 ? usedNames.join(',') : undefined;
  if (isDev()) {
    console.log(
      `[fit-estimator] devices in use: ${usedNames.length > 0 ? usedNames.join(',') : '(host only)'}`,
    );
  }

  const marginsMiB = await computeFitMargins(fitPath, vramMB, usedNames);
  const deviceTotals = await getDeviceTotals(fitPath);
  const byName = new Map(deviceTotals.map((d) => [d.name, d.total]));
  const budgets: DeviceBudget[] = marginsMiB.map((margin, i) => ({
    total:
      byName.get(usedNames[i]) ??
      deviceTotals[i]?.total ??
      // Last resort when totals are unknown: manual assumes the margin
      // leaves the requested budget usable; automatic (no budget) does not
      // gate on VRAM at all.
      (vramMB !== undefined ? margin + vramMB * MiB : Number.POSITIVE_INFINITY),
    margin,
  }));
  return {
    fitPath,
    supported,
    maxLayers: meta.maxLayers,
    maxModelCtx,
    usedNames,
    deviceArg,
    marginsMiB,
    budgets,
  };
}

// Parameter order is positional API shared with chat.ts/ipc.ts callers.
/* eslint-disable default-param-last */
export async function fitLayersForContext(
  modelPath: string,
  ctxInput: number,
  vramMB: number | undefined,
  ramMB: number | undefined,
  projectorPath?: string,
  profile: Partial<Profile> = {},
  runId?: number,
): Promise<MemoryEstimation> {
  /* eslint-enable default-param-last */
  // Automatic mode (no caps): overflow is measured against total physical
  // RAM — the only true SSD-spill signal when nothing is reserved.
  const totalSystemRAM = os.totalmem();
  const ramLimitBytes = ramMB !== undefined ? ramMB * MiB : totalSystemRAM;
  const ramBudgetLabel =
    ramMB !== undefined
      ? `${(ramMB / 1024).toFixed(2)} GB allocated`
      : `${(totalSystemRAM / 1024 ** 3).toFixed(2)} GB total system RAM`;

  const prep = await prepareFit(
    modelPath,
    vramMB,
    projectorPath,
    profile,
    CTX_MIN,
    runId,
  );
  const {
    fitPath,
    supported,
    maxLayers,
    maxModelCtx,
    usedNames,
    deviceArg,
    marginsMiB,
    budgets,
  } = prep;
  const measureBase = deviceArg ? { device: deviceArg, runId } : { runId };
  // Clamp the requested ctx into the valid snapped range.
  const ctx = Math.min(
    maxModelCtx,
    Math.max(CTX_MIN, Math.floor(ctxInput / CTX_SNAP) * CTX_SNAP),
  );
  // 1. Let the fitter solve at the requested ctx: max layers (+triple) for
  // exactly this context size. With explicit -c the fitter never shrinks
  // ctx itself, so the returned triple is self-consistent by construction —
  // no search loop, no reconciliation needed.
  const fitArgs = ['-m', modelPath, '-c', String(ctx), '-ngl', 'auto'];
  appendCommonFitArgs(fitArgs, supported, profile, projectorPath);
  if (deviceArg) {
    pushIfSupported(fitArgs, supported, '--device', deviceArg);
  }
  fitArgs.push('--fit', 'on', '--fit-target', marginsForCli(marginsMiB));
  const { stdout, stderr } = await runFit(fitPath, fitArgs, runId);
  const fitted = parseFittedArgs(stdout);

  // The fitter echoes -ngl -1 (full-offload sentinel, verified identical to
  // -ngl 99) when everything fits untouched. Normalize to the model's layer
  // count for the profile/UI; the shared arg parser accepts -1 regardless.
  const normalizeNgl = (ngl: number): number =>
    ngl < 0 && maxLayers > 0 ? maxLayers : ngl;
  const bestNgl = normalizeNgl(fitted.ngl);
  // Placement triple: ngl alone is not a complete solution when the fitter
  // emits -ts/-ot (partial-layer overflow). The triple travels together from
  // here on, through measurement and all the way to the server launch flags.
  const triple = {
    tensorSplit: fitted.tensorSplit ?? null,
    overrides: fitted.overrides ?? null,
  };

  if (isDev()) {
    console.log(
      `[fit-estimator] fitted -c ${fitted.ctx} -ngl ${fitted.ngl}` +
        `${fitted.tensorSplit ? ` -ts ${fitted.tensorSplit}` : ''}` +
        `${fitted.overrides ? ` -ot "${fitted.overrides}"` : ''}`,
    );
  }

  const finalOpts = {
    ...measureBase,
    tensorSplit: triple.tensorSplit,
    overrides: triple.overrides,
  };
  const finalMeasure = await measureAtConfig(
    fitPath,
    supported,
    modelPath,
    bestNgl,
    ctx,
    projectorPath,
    profile,
    finalOpts,
  );

  // 2. Breakdown: weights vs context from a ctx=1 probe at bestNgl.
  const modelOnly = await measureAtConfig(
    fitPath,
    supported,
    modelPath,
    bestNgl,
    1,
    projectorPath,
    profile,
    finalOpts,
  );
  const sumDev = (r: FitPrintResult) =>
    r.devices.reduce((a, d) => a + d.model + d.context + d.compute, 0);
  const sumHost = (r: FitPrintResult) =>
    r.host.model + r.host.context + r.host.compute;
  const totalVram = sumDev(finalMeasure);
  const totalRam = sumHost(finalMeasure);
  const modelVram = sumDev(modelOnly);
  const modelRam = sumHost(modelOnly);
  const toGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  const vramDisplay =
    vramMB !== undefined
      ? `${(vramMB / 1024).toFixed(2)} GB allocated`
      : `${(budgets.reduce((a, b) => a + b.total, 0) / 1024 ** 3).toFixed(2)} GB total device`;

  // Host overflow spills to SSD swap: still runs, just slower. Warn (always,
  // all environments) instead of refusing or silently degrading.
  const hostOverflowBytes = Math.max(0, totalRam - ramLimitBytes);
  if (hostOverflowBytes > 0) {
    console.warn(
      `[fit-estimator] ctx ${ctx} needs ${toGB(totalRam)} host memory vs ` +
        `${ramBudgetLabel} — overflow will spill to SSD swap. ` +
        `It will still run, but slower.`,
    );
  }

  if (isDev()) {
    console.log(`
--- Optimization Results (llama-fit-params) ---
Requested Context:   ${ctx} tokens
Best GPU Layers (NGL): ${bestNgl}

Memory Breakdown:
- Model Weights in VRAM:  ${toGB(modelVram)}
- Context VRAM (Compute): ${toGB(Math.max(0, totalVram - modelVram))}
- Context RAM (KV Cache): ${toGB(Math.max(0, totalRam - modelRam))}

Hardware Utilization:
- VRAM: ${toGB(totalVram)} / ${vramDisplay}
- RAM:  ${toGB(totalRam)} / ${ramBudgetLabel} (${toGB(hostOverflowBytes)} over budget)
----------------------------------
`);
  }

  if (isDev()) {
    const toMiB = (bytes: number) => Math.round(bytes / MiB);
    const rowMiB = (r: {
      model: number;
      context: number;
      compute: number;
    }) => ({
      modelMiB: toMiB(r.model),
      contextMiB: toMiB(r.context),
      computeMiB: toMiB(r.compute),
      totalMiB: toMiB(r.model + r.context + r.compute),
    });
    console.debug(
      '[fit-estimator:full-result]',
      JSON.stringify(
        {
          strategy: 'synapse',
          modelPath,
          projectorPath: projectorPath ?? null,
          budgetsMiB: { vramMB, ramMB },
          devicesInUse: usedNames,
          marginsMiB: marginsMiB.map((m) => Math.round(m / MiB)),
          deviceBudgetsMiB: budgets.map((b) => ({
            totalMiB: toMiB(b.total),
            marginMiB: toMiB(b.margin),
          })),
          maxModelCtx,
          requestedCtx: ctxInput,
          fitCommand: [fitPath, ...fitArgs].join(' '),
          fitStdout: stdout.trim(),
          fitStderrTail: stderr.slice(-2048),
          fitted: {
            ctx: fitted.ctx,
            ngl: fitted.ngl,
            normalizedNgl: bestNgl,
            tensorSplit: fitted.tensorSplit ?? null,
            overrides: fitted.overrides ?? null,
          },
          hostOverflowMiB: toMiB(hostOverflowBytes),
          final: {
            ngl: bestNgl,
            ctx,
            devices: finalMeasure.devices.map((d) => ({
              name: d.name,
              ...rowMiB(d),
            })),
            host: rowMiB(finalMeasure.host),
          },
          modelOnlyAtCtx1: {
            devices: modelOnly.devices.map((d) => ({
              name: d.name,
              ...rowMiB(d),
            })),
            host: rowMiB(modelOnly.host),
          },
        },
        null,
        2,
      ),
    );
  }

  return {
    ngl: bestNgl,
    ctx,
    tensorSplit: triple.tensorSplit,
    tensorOverrides: triple.overrides,
    hostOverflowBytes,
    memory: {
      modelVramUsage: modelVram,
      modelRamUsage: modelRam,
      contextVramUsage: Math.max(0, totalVram - modelVram),
      contextRamUsage: Math.max(0, totalRam - modelRam),
    },
  };
}

// ── Single-point estimate (memory panel) ──

export async function estimateMemoryAtConfig(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
): Promise<{
  modelVramUsage: number;
  contextVramUsage: number;
  computeOverheadVram: number;
  modelRamUsage: number;
  contextRamUsage: number;
  computeOverheadRam: number;
  fileBufferRam: number;
}> {
  const zero = {
    modelVramUsage: 0,
    contextVramUsage: 0,
    computeOverheadVram: 0,
    modelRamUsage: 0,
    contextRamUsage: 0,
    computeOverheadRam: 0,
    fileBufferRam: 0,
  };
  try {
    const fitPath = await resolveFitPath();
    const supported = await getSupportedFlags(fitPath);
    // Forward the caller's real kvOffload: --no-kv-offload natively moves KV
    // to host in the measurement (no manual fixup needed).
    // Apply the stored placement triple when the caller provides one (the
    // optimizer panel passes it for the exact values it was solved for).
    // Without it a partial-overflow plan reads as whole layers resident.
    const m = await measureAtConfig(
      fitPath,
      supported,
      modelPath,
      ngl,
      ctx,
      projectorPath,
      profile,
      {
        tensorSplit: profile.tensorSplit ?? null,
        overrides: profile.tensorOverrides ?? null,
      },
    );
    const modelVramUsage = m.devices.reduce((a, d) => a + d.model, 0);
    const contextVramUsage = m.devices.reduce((a, d) => a + d.context, 0);
    const computeOverheadVram = m.devices.reduce((a, d) => a + d.compute, 0);
    const mmap = (profile as any).mmap ?? true;
    // With --load-mode none the OS keeps the whole file in a heap buffer for
    // the process lifetime; approximate it from the measured weights.
    const fileBufferRam = !mmap ? modelVramUsage + m.host.model : 0;
    return {
      modelVramUsage,
      contextVramUsage,
      computeOverheadVram,
      modelRamUsage: m.host.model,
      contextRamUsage: m.host.context,
      computeOverheadRam: m.host.compute,
      fileBufferRam,
    };
  } catch (e) {
    // Estimate panel must never break the modal; optimizer stays strict.
    console.error(
      '[fit-estimator] estimate failed:',
      e instanceof Error ? e.message : e,
    );
    return zero;
  }
}

// ── Shared estimate cache ──

const memoryEstimateCache = new Map<string, Promise<any>>();

function fitRelevantKey(profile: Partial<Profile> = {}): string {
  const p = profile as any;
  return JSON.stringify({
    kvOffload: profile.kvOffload ?? true,
    mmap: p.mmap ?? true,
    mlock: p.mlock ?? false,
    repack: p.repack ?? true,
    cacheTypeK: profile.cacheTypeK ?? 'f16',
    cacheTypeV: profile.cacheTypeV ?? 'f16',
    flashAttn: p.flashAttn ?? 'auto',
    parallel: getParallel(profile),
    cpuMoe: profile.cpuMoe ?? false,
    nCpuMoe: profile.nCpuMoe ?? 0,
    mmprojOffload: p.mmprojOffload ?? true,
    imageMinTokens: p.imageMinTokens ?? 0,
    imageMaxTokens: p.imageMaxTokens ?? 0,
    mtmdBatchMaxTokens: p.mtmdBatchMaxTokens ?? 1024,
    rope: p.rope ?? null,
    yarn: p.yarn ?? null,
    tensorSplit: profile.tensorSplit ?? null,
    tensorOverrides: profile.tensorOverrides ?? null,
  });
}

function estimateCacheKey(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
): string {
  return `${modelPath}|${ngl}|${ctx}|${projectorPath ?? ''}|${fitRelevantKey(profile)}`;
}

export async function getOrEstimateMemory(
  modelPath: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
) {
  const key = estimateCacheKey(modelPath, ngl, ctx, projectorPath, profile);
  const existing = memoryEstimateCache.get(key);
  if (existing) return existing;

  const promise = estimateMemoryAtConfig(
    modelPath,
    ngl,
    ctx,
    projectorPath,
    profile,
  );
  memoryEstimateCache.set(key, promise);
  try {
    return await promise;
  } finally {
    memoryEstimateCache.delete(key);
  }
}

// ── Shared optimizer state ──
// Newest request wins per model: starting a run cancels any in-flight run
// for the same model (rapid ctx-slider stops, profile switches). Cancelled
// runs reject with FitCancelledError, which callers must tolerate — the UI
// ignores stale responses by request id.

const activeOptimizations = new Map<
  string,
  { key: string; runId: number; promise: Promise<MemoryEstimation> }
>();

function optimizerCacheKey(
  modelPath: string,
  vramMB: number | undefined,
  ramMB: number | undefined,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
): string {
  // Undefined budgets (automatic mode) stringify distinctly from numbers,
  // so mode switches never collide in the key.
  return `${modelPath}|${vramMB ?? 'auto'}|${ramMB ?? 'auto'}|${ctx}|${projectorPath ?? ''}|${fitRelevantKey(profile)}`;
}

// Parameter order is positional API shared with chat.ts/ipc.ts callers.
/* eslint-disable default-param-last */
export async function getOrRunOptimizer(
  modelPath: string,
  vramMB: number | undefined,
  ramMB: number | undefined,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
): Promise<MemoryEstimation> {
  /* eslint-enable default-param-last */
  const key = optimizerCacheKey(
    modelPath,
    vramMB,
    ramMB,
    ctx,
    projectorPath,
    profile,
  );
  const active = activeOptimizations.get(modelPath);
  if (active && active.key === key) return active.promise;
  if (active) cancelFitRun(active.runId);

  const runId = createFitRun();
  const promise = fitLayersForContext(
    modelPath,
    ctx,
    vramMB,
    ramMB,
    projectorPath,
    profile,
    runId,
  );

  activeOptimizations.set(modelPath, { key, runId, promise });
  try {
    return await promise;
  } finally {
    if (activeOptimizations.get(modelPath)?.promise === promise) {
      activeOptimizations.delete(modelPath);
    }
    endFitRun(runId);
  }
}

// ── Maximum-speed line ──
// Strict whole-layer answer to "how far can ctx grow before anything spills
// off the GPU": largest ctx with maxLayers and NO -ot. Interpolated from two
// probes (KV cache scales linearly with ctx), verified, then bisected on
// miss. Returns null when even CTX_MIN spills (line hidden in that case).

const speedLineCache = new Map<string, number | null>();

export async function maxFullOffloadCtx(
  modelPath: string,
  vramMB: number | undefined,
  projectorPath?: string,
  profile: Partial<Profile> = {},
  runId?: number,
): Promise<number | null> {
  const key = `${modelPath}|${vramMB}|${projectorPath ?? ''}|${fitRelevantKey(profile)}`;
  const cached = speedLineCache.get(key);
  if (cached !== undefined) return cached;

  const prep = await prepareFit(
    modelPath,
    vramMB,
    projectorPath,
    profile,
    CTX_MIN,
    runId,
  );
  const {
    fitPath,
    supported,
    maxLayers,
    maxModelCtx,
    deviceArg,
    budgets,
  } = prep;
  if (maxLayers <= 0) {
    speedLineCache.set(key, null);
    return null;
  }
  const measureOpts = deviceArg ? { device: deviceArg, runId } : { runId };
  const devTotal = (m: FitPrintResult): number[] =>
    m.devices.map((d) => d.model + d.context + d.compute);

  // Fast path: train max fits whole → line at the top.
  const atMax = await measureAtConfig(
    fitPath,
    supported,
    modelPath,
    maxLayers,
    maxModelCtx,
    projectorPath,
    profile,
    measureOpts,
  );
  if (vramFits(atMax, budgets)) {
    speedLineCache.set(key, maxModelCtx);
    return maxModelCtx;
  }
  // Floor spills too → no full-offload ctx exists.
  const atMin = await measureAtConfig(
    fitPath,
    supported,
    modelPath,
    maxLayers,
    CTX_MIN,
    projectorPath,
    profile,
    measureOpts,
  );
  if (!vramFits(atMin, budgets)) {
    speedLineCache.set(key, null);
    return null;
  }
  // Interpolate per device, take the binding (smallest) ctx, verify, bisect.
  const loTotals = devTotal(atMin);
  const hiTotals = devTotal(atMax);
  const perToken = hiTotals.map((hi, i) =>
    Math.max(1, (hi - loTotals[i]) / (maxModelCtx - CTX_MIN)),
  );
  const perDeviceBudget = budgets.map((b, i) => b.total - b.margin);
  let guess = maxModelCtx;
  if (atMax.devices.length === budgets.length) {
    guess = Math.min(
      ...loTotals.map((lo, i) =>
        CTX_MIN + (perDeviceBudget[i] - lo) / perToken[i],
      ),
    );
  } else {
    const totalBudget = perDeviceBudget.reduce((a, b) => a + b, 0);
    const totalLo = loTotals.reduce((a, t) => a + t, 0);
    const totalPerToken = perToken.reduce((a, t) => a + t, 0);
    guess = CTX_MIN + (totalBudget - totalLo) / totalPerToken;
  }
  let candidate = Math.min(
    maxModelCtx,
    Math.max(
      CTX_MIN,
      Math.floor(guess / CTX_SNAP) * CTX_SNAP,
    ),
  );
  // At most a few bisection steps: each probe halves the uncertainty.
  let verified: number | null = null;
  for (let step = 0; step < 6; step += 1) {
    const m = await measureAtConfig(
      fitPath,
      supported,
      modelPath,
      maxLayers,
      candidate,
      projectorPath,
      profile,
      measureOpts,
    );
    if (vramFits(m, budgets)) {
      verified = candidate;
      if (candidate >= maxModelCtx) break;
      candidate = Math.min(
        maxModelCtx,
        Math.floor((candidate + maxModelCtx) / 2 / CTX_SNAP) * CTX_SNAP,
      );
      if (candidate <= verified) break;
    } else {
      candidate =
        Math.floor((CTX_MIN + candidate) / 2 / CTX_SNAP) * CTX_SNAP;
      candidate = Math.max(CTX_MIN, candidate);
      if (verified !== null && candidate <= verified) break;
    }
  }
  const answer = verified;
  speedLineCache.set(key, answer);
  return answer;
}
