import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import { loadSettings } from './settings';
import type { AppSettings } from './settings';
import { resolveFitBinary } from './backendPaths';
import type { MemoryBreakdown, Profile } from '../renderer/types/profile';
import { planSummaryLines } from '../renderer/utils/planSummary';
import {
  clearGgufInfoCache,
  firstSplitPart,
  ggufArchNumber,
  readGgufInfoCached,
} from './estimator/gguf';
import {
  classifyModel,
  decideMoePlacement,
  effectivePlacement,
  firstGpuLayer,
  lazyBytes,
  moeCacheFloorBytes,
  probeDeviceTotal,
  shrinkMoeCache,
  spilledExpertLayers,
  spilledFfnLayers,
  weightBreakdown,
  weightSplit,
  type FitRow,
  type ModelClass,
  type Placement,
  type Probe,
} from './estimator/model';
import {
  checkProjectionDim,
  mmprojReserve,
  readMmprojInfo,
  type MmprojReserve,
} from './estimator/mmproj';

// Re-exported for the launch path: llama-server, like every probe, only loads
// the first part of a split GGUF.
export { firstSplitPart } from './estimator/gguf';

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
  // Expert residency the optimizer chose for a MoE. These travel with the
  // plan the same way the -ts/-ot triple does: they are part of the placement,
  // and llama.cpp's cache is capped by the spill, so they only make sense
  // together.
  nCpuMoe: number | null;
  cpuMoe: boolean;
  nCpuFfn: number | null;
  moeCacheMib: number | null;
  // Human-readable summary of the plan (optimizer path, knobs, headroom) for
  // the UI's explanation line.
  plan?: {
    kind: 'dense' | 'moe';
    label: string;
    /** Largest context this placement holds at these budgets. */
    maxCtx: number;
    /** What capped that number: VRAM, RAM, or the model's trained length. */
    clampedBy: string;
    /** True when nothing fit the device budgets and this plan is the least-bad
     *  option. Host memory is not part of it: a --cpu-moe plan is allowed to
     *  need more system RAM than the machine has. */
    forced: boolean;
    /** Bytes of the placement that exceed the system-memory budget and will be
     *  served from the page file. Reported, never used to reject a plan. */
    hostOverflowBytes: number;
    /** Bytes --lazy-mode reads from the file instead of holding in RAM: in
     *  neither the RAM total nor the overflow above. */
    streamedHostBytes?: number;
    /** Blocks the device holds, and how many the file has: -ngl counts the
     *  output tensor (and any draft layers), so it is not a block count. */
    gpuLayers: number;
    totalLayers: number;
  };
}

const MiB = 1024 * 1024;
const CTX_SNAP = 512;
const CTX_MIN = 512;

// Wall-clock budget for a single fit-process run, from settings
// (estimatorTimeoutSec, default 100s). Read fresh per invocation so a
// settings change applies to the next run without a restart.
function fitTimeoutMs(): number {
  const sec = loadSettings().estimatorTimeoutSec ?? 100;
  return (Number.isFinite(sec) && sec > 0 ? sec : 100) * 1000;
}

// Free VRAM left untouched per GPU when fitting, from settings
// (vramHeadroomMB, default 512). Read fresh per call so edits apply to the
// next run without a restart.
function vramHeadroomMB(): number {
  const mb = loadSettings().vramHeadroomMB ?? 512;
  return Number.isFinite(mb) && mb >= 0 ? Math.floor(mb) : 512;
}

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
// the estimate measures exactly what the server will launch.
//
// Two probe modes exist and they are never mixed:
//   'measure' — --fit-print on. The fitter is skipped, so ANY placement is
//               legal, and every placement pin the profile carries (-ngl, -ts,
//               -ot, --cpu-moe, …) is passed because the point is to read the
//               cost of exactly that placement.
//   'solve'   — --fit on. The fitter picks the placement, so every pin has to
//               be stripped: llama.cpp aborts with "model_params::
//               tensor_buft_overrides already set by user" as soon as it is
//               asked to overflow a model whose overrides are already pinned,
//               a hard failure for any profile using --cpu-moe.

export type FitProbeMode = 'measure' | 'solve';

// llama.cpp has no --no-mmap/--mlock pair: how a model is loaded is one enum,
// -lm/--load-mode (auto|none|mmap|mlock|mmap+mlock|dio). The optimizer probe and
// the server launch both resolve it here, so a profile can never be measured
// under one load mode and launched under another. null = leave llama.cpp's own
// default in place.
export function loadModeFor(
  mmap: boolean | undefined,
  mlock: boolean | undefined,
): 'none' | 'mlock' | 'mmap+mlock' | null {
  if (mmap === false) {
    // No mmap, but the user still wants the weights pinned in RAM.
    return mlock === true ? 'mlock' : 'none';
  }
  if (mlock === true) return 'mmap+mlock';
  return null;
}

export function appendCommonFitArgs(
  args: string[],
  supported: Set<string>,
  profile: Partial<Profile>,
  projectorPath: string | undefined,
  mode: FitProbeMode = 'measure',
): void {
  const p = profile as any;
  const solve = mode === 'solve';

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

  // MoE placement. In solve mode these are stripped: they are overrides, and a
  // profile that pins them while asking the fitter to overflow is exactly the
  // combination llama.cpp refuses.
  if (!solve) {
    if (profile.cpuMoe === true) pushIfSupported(args, supported, '--cpu-moe');
    if (
      profile.nCpuMoe !== undefined &&
      profile.nCpuMoe > 0 &&
      profile.cpuMoe !== true
    ) {
      pushIfSupported(args, supported, '--n-cpu-moe', String(profile.nCpuMoe));
    }
    if (p.nCpuFfn !== undefined && p.nCpuFfn > 0) {
      // Long form only: getSupportedFlags records --long names, so "-ncffn"
      // would read as unsupported and be silently dropped.
      pushIfSupported(args, supported, '--n-cpu-ffn', String(p.nCpuFfn));
    }
    if (p.moeCacheMib !== undefined && p.moeCacheMib > 0) {
      // Unconditional, like the server launch: the probe and the server come
      // from one pinned bundle, so gating this on the fit binary's --help only
      // models a version nobody runs — and when it did miss, the probe would
      // measure a plan whose cache the launch then spends, silently.
      args.push('--moe-cache-mib', String(p.moeCacheMib));
      // Qualifies the cache, like the server emits it: without a cache there is
      // no miss to route, and formatting must match toFixed(2) exactly.
      if (p.moeCacheCpuShare !== undefined && p.moeCacheCpuShare > 0) {
        args.push(
          '--moe-cache-cpu-share',
          Number(p.moeCacheCpuShare).toFixed(2),
        );
      }
    }
  }

  // Lazy tensors are a load behaviour, not a tensor placement: the fitter is
  // allowed to see it in solve mode. Same rule as buildLlamaServerArgs: auto is
  // llama.cpp's own default, so the probe must not model an effect the launch
  // will not have.
  if (p.lazyMode && p.lazyMode !== 'auto') {
    pushIfSupported(args, supported, '--lazy-mode', String(p.lazyMode));
  }

  // Memory mode: fit has no --no-mmap/--mlock pair, only --load-mode.
  const loadMode = loadModeFor(p.mmap, p.mlock);
  if (loadMode) pushIfSupported(args, supported, '--load-mode', loadMode);
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

  // ── Multimodal projector block ──
  // The pinned llama-fit-params has no --mmproj at all ("invalid argument"), so
  // no probe can ever include the projector. Its cost is added analytically
  // instead (see estimator/mmproj.ts: exact weights, exact tokens per image,
  // reserved encoder buffers). Builds that do advertise the flag keep the
  // server-parity behaviour.
  if (projectorPath && !fs.existsSync(projectorPath)) {
    throw new Error(`Projector file not found at ${projectorPath}.`);
  }
  if (projectorPath && !solve && supported.has('--mmproj')) {
    pushIfSupported(args, supported, '--mmproj', projectorPath);
    if (p.mmprojOffload !== true) {
      pushIfSupported(args, supported, '--no-mmproj-offload');
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

// Single choke point for cancellation logging: one exact line per kill,
// greppable, no stack. Context names which entry point owned the run.
export function logFitCancelled(
  context: 'optimizer' | 'speed-line' | 'chat-load',
): void {
  console.log(`[fit-estimator] Fit Run Cancelled (${context})`);
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

export function endFitRun(id: number): void {
  fitRuns.delete(id);
}

function fitFailure(args: string[], reason: string, stderrTail: string): Error {
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
    const timeoutMs = fitTimeoutMs();
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already exited.
      }
    }, timeoutMs);
    const child = spawn(fitPath, args);
    if (rec) rec.child = child;
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < 16 * MiB) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 16 * MiB) stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      finish(() => reject(fitFailure(args, err.message, stderr.slice(-4000))));
    });
    child.on('close', (code: number | null) => {
      if (rec?.cancelled) {
        finish(() => reject(new FitCancelledError()));
      } else if (timedOut) {
        finish(() =>
          reject(
            fitFailure(
              args,
              `timed out after ${timeoutMs}ms (estimator timeout setting)`,
              stderr.slice(-4000),
            ),
          ),
        );
      } else if (code !== 0) {
        finish(() =>
          reject(fitFailure(args, `exit code ${code}`, stderr.slice(-4000))),
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
  // Automatic allocation (no cap): flat headroom margin per device — fit
  // purely to live free memory.
  const headroom = vramHeadroomMB() * MiB;
  if (vramMB === undefined) {
    const n = Math.max(1, usedNames.length);
    return Array.from({ length: n }, () => headroom);
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
  if (known.length === 0) return usedNames.map(() => headroom);
  const sum = known.reduce((a, t) => a + t, 0);
  return totals.map((t) => {
    if (t <= 0) return headroom;
    const share = allocated * (t / sum);
    // Floor: a zero margin ("leave nothing free") overpacks past what the
    // driver needs headroom for.
    return Math.max(headroom, Math.round(t - share));
  });
}

function marginsForCli(margins: number[]): string {
  return margins.map((m) => String(Math.round(m / MiB))).join(',');
}

export interface ResolvedBudgets {
  mode: 'automatic' | 'manual';
  // Undefined in automatic mode: fit to live free memory (flat headroom
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

// ── Model metadata ──
// The full GGUF read (metadata plus the tensor-info table) lives in
// estimator/gguf.ts and is cached per file. This is the cheap header-only
// path behind the UI's max-layers / max-context display.
export async function readGgufMetadata(
  modelPath: string,
): Promise<{ maxLayers: number; maxContext: number }> {
  const info = await readGgufInfoCached(modelPath, { tensors: false });
  return {
    maxLayers: ggufArchNumber(info, 'block_count') ?? 0,
    maxContext: ggufArchNumber(info, 'context_length') ?? 4096,
  };
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

// ── Measurement oracle ──
//
// probeAt() below is the oracle: one `--fit-print` run for one placement at one
// context. Nothing else measures memory in this file.

// ── Probing a placement ─────────────────────────────────────────────────────
//
// A probe is `llama-fit-params --fit-print`: llama.cpp loads the file's
// metadata, applies its own tensor-placement rules to the flags it is given, and
// prints what each device and the host would spend. No weights are read, so the
// probe is legal for placements that could never fit — which is how the MoE rule
// gets to ask whether they can.
//
// That print is the only memory measurement the optimizer has. There is no
// second model of memory in this file to disagree with it.

/**
 * The profile a probe runs under: the placement's own knobs replace whatever
 * the user's profile carries, so a probe always measures exactly the placement
 * being priced, and never inherits stale -ot/--cpu-moe pins from a previous
 * optimizer run.
 */
function probeProfile(
  profile: Partial<Profile>,
  pl: Placement,
  pins?: { tensorSplit?: string | null; overrides?: string | null },
): Partial<Profile> {
  return {
    ...profile,
    cpuMoe: pl.cpuMoeAll === true ? true : undefined,
    nCpuMoe: (pl.nCpuMoe ?? 0) > 0 && !pl.cpuMoeAll ? pl.nCpuMoe : undefined,
    nCpuFfn: (pl.nCpuFfn ?? 0) > 0 ? pl.nCpuFfn : undefined,
    moeCacheMib: (pl.moeCacheMib ?? 0) > 0 ? pl.moeCacheMib : undefined,
    moeCacheCpuShare:
      (pl.moeCacheCpuShare ?? 0) > 0 ? pl.moeCacheCpuShare : undefined,
    lazyMode: pl.lazyMode ?? profile.lazyMode,
    tensorSplit: pins?.tensorSplit ?? null,
    tensorOverrides: pins?.overrides ?? null,
  };
}

/** One --fit-print probe at an explicit placement. The projector is never
 *  passed: the pinned fit binary has no --mmproj, and its cost is accounted for
 *  analytically, so a build that accepted it here would be double-counted. */
async function probeAt(
  fitPath: string,
  supported: Set<string>,
  modelPath: string,
  profile: Partial<Profile>,
  ctx: number,
  placement: Placement,
  opts: {
    runId?: number;
    deviceArg?: string;
    tensorSplit?: string | null;
    overrides?: string | null;
  } = {},
): Promise<Probe> {
  const args = [
    '-m',
    modelPath,
    '-c',
    String(ctx),
    '-ngl',
    String(placement.ngl),
  ];
  appendCommonFitArgs(
    args,
    supported,
    probeProfile(profile, placement, opts),
    undefined,
    'measure',
  );
  if (opts.deviceArg) {
    pushIfSupported(args, supported, '--device', opts.deviceArg);
  }
  if (opts.tensorSplit) args.push('-ts', opts.tensorSplit);
  if (opts.overrides) args.push('-ot', opts.overrides);
  args.push('--fit-print', 'on');
  const { stdout } = await runFit(fitPath, args, opts.runId);
  const r = parseFitPrint(stdout);
  return {
    ctx,
    devices: r.devices,
    host: { name: 'Host', ...r.host },
    placement,
  };
}

// ── Preparation shared by every optimizer entry point ──
//
// One probe does the discovery: `-ngl` full at the smallest context tells us
// which devices llama.cpp selects for this model, and in which order the
// budgets are indexed by. Every later probe pins that same set with --device,
// and the server uses the same default selection, so the three agree.

interface FitPrep {
  fitPath: string;
  supported: Set<string>;
  model: ModelClass;
  /** Usable bytes per device, in probe row order. */
  deviceBudget: number[];
  usedNames: string[];
  deviceArg: string | undefined;
  marginsMiB: number[];
  maxModelCtx: number;
  ramLimitBytes: number;
  ramBudgetLabel: string;
  mmprojReserveResult: MmprojReserve | null;
  /** Bytes the profile's --lazy-mode reads from the file on demand instead of
   *  holding in RAM. The probe still bills them to the host column, so every
   *  host total in this file takes them back out: they are never resident. */
  streamedHostBytes: number;
}

async function prepareFit(
  modelPathIn: string,
  vramMB: number | undefined,
  ramMB: number | undefined,
  projectorPath: string | undefined,
  profile: Partial<Profile>,
  discoveryCtx: number,
  runId?: number,
): Promise<FitPrep> {
  const fitPath = await resolveFitPath();
  const supported = await getSupportedFlags(fitPath);

  const info = await readGgufInfoCached(modelPathIn);
  if (info.splitTable) {
    throw new Error(
      `${modelPathIn} describes more tensor bytes than the file holds, so it is a ` +
        'byte-chunked GGUF rather than a llama.cpp split. llama.cpp cannot load ' +
        'this either — merge the parts into one file first.',
    );
  }
  // Split models are probed through their first part: llama.cpp refuses the
  // others ("model must be loaded with the first split"). readGgufInfoCached
  // already put that path in info.path and merged every part's tensor table.
  const modelPath = info.path;
  const model = classifyModel(info);

  const mmproj = projectorPath ? await readMmprojInfo(projectorPath) : null;
  if (mmproj) {
    const mismatch = checkProjectionDim(
      mmproj,
      ggufArchNumber(info, 'embedding_length') ?? 0,
    );
    // llama.cpp aborts on this pair, so no plan is worth building.
    if (mismatch) throw new Error(mismatch);
  }

  const discovery = await probeAt(
    fitPath,
    supported,
    modelPath,
    profile,
    discoveryCtx,
    { ngl: model.fullOffloadNgl },
    { runId },
  );
  const usedNames = discovery.devices.map((d) => d.name);
  const deviceArg = usedNames.length > 0 ? usedNames.join(',') : undefined;
  if (isDev()) {
    console.log(
      `[fit-estimator] devices in use: ${usedNames.join(',') || '(host only)'}`,
    );
  }

  const marginsMiB = await computeFitMargins(fitPath, vramMB, usedNames);
  const deviceTotals = await getDeviceTotals(fitPath);
  const byName = new Map(deviceTotals.map((d) => [d.name, d.total]));
  const deviceBudget = marginsMiB.map((margin, i) => {
    const total =
      byName.get(usedNames[i]) ??
      deviceTotals[i]?.total ??
      // Last resort when totals are unknown: manual assumes the margin leaves
      // the requested budget usable; automatic does not gate on VRAM at all.
      (vramMB !== undefined ? margin + vramMB * MiB : Number.POSITIVE_INFINITY);
    return total - margin;
  });

  const totalSystemRAM = os.totalmem();
  const mmprojReserveResult = mmproj
    ? mmprojReserve(mmproj, {
        offload: (profile as any).mmprojOffload === true,
        images: 1,
        imageMaxTokens: (profile as any).imageMaxTokens,
        imageMinTokens: (profile as any).imageMinTokens,
        flashAttn: (profile as any).flashAttn !== 'off',
      })
    : null;

  return {
    fitPath,
    supported,
    model,
    deviceBudget,
    usedNames,
    deviceArg,
    marginsMiB,
    maxModelCtx: model.modelMaxContext || 4096,
    ramLimitBytes: ramMB !== undefined ? ramMB * MiB : totalSystemRAM,
    ramBudgetLabel:
      ramMB !== undefined
        ? `${(ramMB / 1024).toFixed(2)} GB allocated`
        : `${(totalSystemRAM / 1024 ** 3).toFixed(2)} GB total system RAM`,
    mmprojReserveResult,
    streamedHostBytes: lazyBytes(model, profile.lazyMode),
  };
}

/** The projector is never in a probe (the pinned llama-fit-params has no
 *  --mmproj), so it is booked onto the measurement beside the row it lands on. */
const mmprojFor = (prep: FitPrep) => ({
  device: prep.mmprojReserveResult?.deviceBytes ?? 0,
  host: prep.mmprojReserveResult?.hostBytes ?? 0,
  ctxTokens: prep.mmprojReserveResult?.ctxTokens ?? 0,
});

/** Host bytes a probe row bills that the run will never hold: the --lazy-mode
 *  tables, which llama.cpp reserves in its host column and then reads from the
 *  file on demand. Clamped to the row, because a probe that did not bill them
 *  has nothing to give back. */
function residentHost(prep: FitPrep, row: FitRow): number {
  return Math.max(0, probeDeviceTotal(row) - prep.streamedHostBytes);
}

/** Bytes a probe says this placement puts past a device budget. Negative means
 *  it fits, and by how much: the same number is the pool's budget. */
function overBudget(prep: FitPrep, p: Probe, mmprojDevice: number): number {
  if (p.devices.length === 0) return 0;
  const cap = (i: number) =>
    prep.deviceBudget[i] ??
    prep.deviceBudget[prep.deviceBudget.length - 1] ??
    Number.POSITIVE_INFINITY;
  if (p.devices.length !== prep.deviceBudget.length) {
    const used =
      p.devices.reduce((a, d) => a + probeDeviceTotal(d), 0) + mmprojDevice;
    return used - prep.deviceBudget.reduce((a, b) => a + b, 0);
  }
  return Math.max(
    ...p.devices.map(
      (d, i) => probeDeviceTotal(d) + (i === 0 ? mmprojDevice : 0) - cap(i),
    ),
  );
}

/** Flags of a placement in reading order, for the UI's explanation line. */
function placementLabel(pl: Placement): string {
  return [
    `ngl=${pl.ngl}`,
    pl.cpuMoeAll ? '--cpu-moe' : '',
    (pl.nCpuMoe ?? 0) > 0 ? `--n-cpu-moe=${pl.nCpuMoe}` : '',
    (pl.nCpuFfn ?? 0) > 0 ? `--n-cpu-ffn=${pl.nCpuFfn}` : '',
    (pl.moeCacheMib ?? 0) > 0 ? `cache=${pl.moeCacheMib}MiB` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** 0 and unset are the same thing to the caller: no flag to emit. */
function spillFlag(n: number | undefined): number | null {
  return (n ?? 0) > 0 ? n! : null;
}

/** Next -ngl guess for a measured overshoot: whole layers come off the bottom
 *  of the GPU range and the GGUF table says what each one is worth. A guess
 *  only — the caller re-measures, and the measurement is the verdict. */
function nglForOver(model: ModelClass, ngl: number, over: number): number {
  let freed = 0;
  let next = ngl;
  while (next > 0 && freed < over) {
    // -ngl full also holds the output slot; below full, each step drops the
    // lowest GPU layer.
    freed +=
      next >= model.fullOffloadNgl
        ? model.outputDeviceBytes
        : (model.layerBytes[model.nLayerAll + 1 - next] ?? 0);
    next -= 1;
  }
  return Math.max(0, next);
}

/** Largest context the placement holds, from two probes of it: the requested
 *  ctx and ctx 1. Their difference is what a context token costs, so the limit
 *  is one division — measured, never modelled. */
function ctxLimit(
  prep: FitPrep,
  atCtx: Probe,
  atOne: Probe,
  probeCtx: number,
  mmproj: { device: number; host: number; ctxTokens: number },
): { maxCtx: number; clampedBy: string } {
  const span = Math.max(1, probeCtx - 1);
  const limits: { ctx: number; by: string }[] = [];
  // A budget the placement already exceeds at ctx 1 is not a "largest context
  // that fits": nothing fits, and the plan is reported as forced with its
  // overflow instead. Only a budget that still has room caps this number.
  atOne.devices.forEach((one, i) => {
    const budget =
      prep.deviceBudget[i] ??
      prep.deviceBudget[prep.deviceBudget.length - 1] ??
      Number.POSITIVE_INFINITY;
    if (!Number.isFinite(budget)) return;
    const used = probeDeviceTotal(one) + (i === 0 ? mmproj.device : 0);
    if (used >= budget) return;
    const grown =
      probeDeviceTotal(atCtx.devices[i] ?? one) - probeDeviceTotal(one);
    if (grown <= 0) return;
    limits.push({ ctx: 1 + (budget - used) / (grown / span), by: 'vram' });
  });
  if (Number.isFinite(prep.ramLimitBytes)) {
    // The streamed tables cancel out of `grown` (both rows bill them), so only
    // the starting point needs them taken back out.
    const used = residentHost(prep, atOne.host) + mmproj.host;
    const grown = probeDeviceTotal(atCtx.host) - probeDeviceTotal(atOne.host);
    if (grown > 0 && used < prep.ramLimitBytes) {
      limits.push({
        ctx: 1 + (prep.ramLimitBytes - used) / (grown / span),
        by: 'host',
      });
    }
  }
  limits.push({ ctx: prep.maxModelCtx, by: 'model' });
  const binding = limits.reduce((a, b) => (b.ctx < a.ctx ? b : a));
  const imgTokens = mmproj.ctxTokens;
  return {
    maxCtx: Math.max(
      CTX_MIN,
      Math.floor(Math.min(binding.ctx, prep.maxModelCtx) / CTX_SNAP) *
        CTX_SNAP -
        imgTokens,
    ),
    clampedBy: binding.by,
  };
}

/** Shared tail of both optimizer paths: the two breakdown probes, the host
 *  overflow report, and the shape the caller launches with. */
async function reportPlacement(
  prep: FitPrep,
  modelPath: string,
  ctx: number,
  projectorPath: string | undefined,
  profile: Partial<Profile>,
  placement: Placement,
  measured: Probe,
  extra: {
    label: string;
    forced: boolean;
    tensorSplit?: string | null;
    tensorOverrides?: string | null;
    runId?: number;
  },
): Promise<MemoryEstimation> {
  const mmproj = mmprojFor(prep);
  const atOne = await probeAt(
    prep.fitPath,
    prep.supported,
    modelPath,
    profile,
    1,
    placement,
    { runId: extra.runId, deviceArg: prep.deviceArg },
  );
  const totalVram =
    measured.devices.reduce((a, d) => a + probeDeviceTotal(d), 0) +
    mmproj.device;
  const totalRam = residentHost(prep, measured.host) + mmproj.host;
  const modelVram =
    atOne.devices.reduce((a, d) => a + d.model + d.compute, 0) + mmproj.device;
  const modelRam =
    Math.max(
      0,
      atOne.host.model + atOne.host.compute - prep.streamedHostBytes,
    ) + mmproj.host;

  // Host memory spills to the page file: still runs, just slower. Reported,
  // never a reason to refuse a plan — a --cpu-moe plan is allowed to want more
  // RAM than the machine has. The streamed tables are already out of totalRam:
  // they are read from the file, so they never occupy RAM to overflow it.
  const hostOverflowBytes = Math.max(0, totalRam - prep.ramLimitBytes);
  if (hostOverflowBytes > 0) {
    console.warn(
      `[fit-estimator] ctx ${ctx} needs ${(totalRam / 1024 ** 3).toFixed(2)} GB ` +
        `host memory vs ${prep.ramBudgetLabel} — overflow will spill to the ` +
        `page file. It will still run, but slower.`,
    );
  }
  const limit = ctxLimit(prep, measured, atOne, measured.ctx, mmproj);
  // -ngl counts the output slot (and any draft layers), so the block count the
  // UI reports comes from the placement rule, not from ngl itself.
  const gpuLayers = Math.max(
    0,
    Math.min(
      prep.model.baseLayers,
      prep.model.baseLayers - firstGpuLayer(prep.model, placement.ngl),
    ),
  );
  const plan: NonNullable<MemoryEstimation['plan']> = {
    kind: prep.model.kind,
    label: extra.label,
    maxCtx: limit.maxCtx,
    clampedBy: limit.clampedBy,
    forced: extra.forced,
    hostOverflowBytes,
    streamedHostBytes: prep.streamedHostBytes,
    gpuLayers,
    totalLayers: prep.model.baseLayers,
  };
  if (isDev()) {
    // The run ends by saying what it decided, in the same words the profile
    // modal prints: these flags are the plan, and this is the plan read out.
    console.log(
      `[fit-estimator] plan for ctx ${ctx}:\n  ${planSummaryLines({
        ...plan,
        ngl: placement.ngl,
        cpuMoe: placement.cpuMoeAll === true,
        nCpuMoe: spillFlag(placement.nCpuMoe) ?? undefined,
        nCpuFfn: spillFlag(placement.nCpuFfn) ?? undefined,
        moeCacheMib: spillFlag(placement.moeCacheMib) ?? undefined,
      }).join('\n  ')}`,
    );
  }
  return {
    ngl: placement.ngl,
    ctx,
    tensorSplit: extra.tensorSplit ?? null,
    tensorOverrides: extra.tensorOverrides ?? null,
    hostOverflowBytes,
    // The plan is what the launch carries (see buildLlamaServerArgs): a
    // --cpu-moe plan reports every expert layer as spilled, and a manual
    // override travels through unchanged so it survives a re-solve.
    nCpuMoe:
      placement.cpuMoeAll === true
        ? prep.model.baseLayers
        : spillFlag(placement.nCpuMoe),
    cpuMoe: placement.cpuMoeAll === true,
    nCpuFfn: spillFlag(placement.nCpuFfn),
    moeCacheMib: spillFlag(placement.moeCacheMib),
    memory: {
      modelVramUsage: modelVram,
      modelRamUsage: modelRam,
      contextVramUsage: Math.max(0, totalVram - modelVram),
      contextRamUsage: Math.max(0, totalRam - modelRam),
    },
    plan,
  };
}
// ── Optimizer entry point ──
//
// Every number the optimizer reports comes from a probe: llama.cpp's own
// accounting for the exact flags the server will launch with. The GGUF table is
// used for two things only — the memory bar's subdivision of a measured column,
// and llama.cpp's own minimum pool size — never to decide a placement. A second
// model of memory next to the binary is what produced every plan that measured
// differently than it was priced.
//
//   dense, or more than one device: llama.cpp's fitter (-ngl auto --fit on)
//     solves the placement and its -ts/-ot triple, and probes report the result.
//   MoE, one device: Synapse's rule, two probes deep — pinned if the experts fit
//     in VRAM, otherwise every expert in host RAM with the rest of VRAM as the
//     expert pool. See decideMoePlacement.

/* eslint-disable default-param-last */
export async function fitLayersForContext(
  modelPathIn: string,
  ctxInput: number,
  vramMB: number | undefined,
  ramMB: number | undefined,
  projectorPath?: string,
  profile: Partial<Profile> = {},
  runId?: number,
): Promise<MemoryEstimation> {
  /* eslint-enable default-param-last */
  // Split GGUF: llama.cpp only loads the first part, and the reader sizes the
  // whole model from all of them, so probe the first part.
  const modelPath = firstSplitPart(modelPathIn);
  const prep = await prepareFit(
    modelPath,
    vramMB,
    ramMB,
    projectorPath,
    profile,
    CTX_MIN,
    runId,
  );
  const ctx = Math.min(
    prep.maxModelCtx,
    Math.max(CTX_MIN, Math.floor(ctxInput / CTX_SNAP) * CTX_SNAP),
  );

  // Multi-device: llama.cpp's fitter owns the whole placement. Its -ts/-ot
  // splits interact with per-layer pins in ways that overfill one device while
  // underfilling another, so the MoE rule only runs on a single device.
  /* eslint-disable no-use-before-define -- the entry point reads first; the two
   *  paths it chooses between are what follows it. */
  if (prep.model.kind === 'moe' && prep.usedNames.length <= 1) {
    return fitMoe(prep, modelPath, ctx, projectorPath, profile, runId);
  }
  return fitWithFitter(prep, modelPath, ctx, projectorPath, profile, runId);
  /* eslint-enable no-use-before-define */
}

/** Ask llama.cpp's own fitter for the largest placement that fits this context,
 *  then measure what it answered. With an explicit -c the fitter never shrinks
 *  the context itself, so the -ngl/-ts/-ot triple it echoes is self-consistent —
 *  no search loop, no reconciliation. This is also the multi-device path. */
async function fitWithFitter(
  prep: FitPrep,
  modelPath: string,
  ctx: number,
  projectorPath: string | undefined,
  profile: Partial<Profile>,
  runId?: number,
): Promise<MemoryEstimation> {
  const fitArgs = ['-m', modelPath, '-c', String(ctx), '-ngl', 'auto'];
  appendCommonFitArgs(fitArgs, prep.supported, profile, projectorPath, 'solve');
  if (prep.deviceArg) {
    pushIfSupported(fitArgs, prep.supported, '--device', prep.deviceArg);
  }
  fitArgs.push('--fit', 'on', '--fit-target', marginsForCli(prep.marginsMiB));
  const { stdout } = await runFit(prep.fitPath, fitArgs, runId);
  const fitted = parseFittedArgs(stdout);
  // The fitter echoes -ngl -1 (the full-offload sentinel) when everything fits
  // untouched; the profile and the UI want the layer count.
  const ngl = fitted.ngl < 0 ? prep.model.fullOffloadNgl : fitted.ngl;
  if (isDev()) {
    console.log(
      `[fit-estimator] fitted -c ${fitted.ctx} -ngl ${fitted.ngl}` +
        `${fitted.tensorSplit ? ` -ts ${fitted.tensorSplit}` : ''}` +
        `${fitted.overrides ? ` -ot "${fitted.overrides}"` : ''}`,
    );
  }
  const placement: Placement = {
    ngl,
    nCpuFfn: (profile as any).nCpuFfn,
  };
  const measured = await probeAt(
    prep.fitPath,
    prep.supported,
    modelPath,
    profile,
    ctx,
    placement,
    {
      runId,
      deviceArg: prep.deviceArg,
      tensorSplit: fitted.tensorSplit ?? null,
      overrides: fitted.overrides ?? null,
    },
  );
  const forced = overBudget(prep, measured, mmprojFor(prep).device) > 0;
  if (isDev()) {
    console.log(
      `[fit-estimator] dense plan: ${placementLabel(placement)} ` +
        `over=${Math.round(overBudget(prep, measured, mmprojFor(prep).device) / MiB)}MiB`,
    );
  }
  return reportPlacement(
    prep,
    modelPath,
    ctx,
    projectorPath,
    profile,
    placement,
    measured,
    {
      label: placementLabel(placement),
      forced,
      tensorSplit: fitted.tensorSplit ?? null,
      tensorOverrides: fitted.overrides ?? null,
      runId,
    },
  );
}

/** MoE on one device: the rule, answered by probes.
 *
 *   probe 1  -ngl full                       -> does everything fit? launch it
 *   probe 2  -ngl full --cpu-moe             -> the alternative, and its headroom
 *   probe 3  ... --moe-cache-mib <headroom>  -> the pool the launch will get
 *
 * plus one probe at ctx 1 for the weights/context split. Host memory is never
 * part of the decision: the --cpu-moe plan is allowed to want more RAM than the
 * machine has, and the overflow is reported instead. */
async function fitMoe(
  prep: FitPrep,
  modelPath: string,
  ctx: number,
  projectorPath: string | undefined,
  profile: Partial<Profile>,
  runId?: number,
): Promise<MemoryEstimation> {
  const mmproj = mmprojFor(prep);
  // Image tokens are part of what a context value has to hold: one image is
  // what the memory panel promises a chat can attach without re-solving.
  const probeCtx = ctx + mmproj.ctxTokens;
  const full = prep.model.fullOffloadNgl;
  const probed: string[] = [];
  const probe = async (pl: Placement): Promise<Probe> => {
    const p = await probeAt(
      prep.fitPath,
      prep.supported,
      modelPath,
      profile,
      probeCtx,
      pl,
      { runId, deviceArg: prep.deviceArg },
    );
    probed.push(
      `${placementLabel(pl)} over=${Math.round(overBudget(prep, p, mmproj.device) / MiB)}MiB`,
    );
    return p;
  };
  const over = (p: Probe) => overBudget(prep, p, mmproj.device);
  // A manual --n-cpu-moe / --n-cpu-ffn is a raw override: the optimizer never
  // proposes one, but a probe that ignores it prices a launch nobody runs.
  const raw = {
    nCpuMoe: profile.nCpuMoe,
    nCpuFfn: (profile as any).nCpuFfn,
  };

  // 1. Pinned. One probe answers the whole first half of the rule.
  const pinned = await probe({ ...raw, ngl: full });
  const pinnedOver = over(pinned);
  let placement: Placement = {
    ...raw,
    ...decideMoePlacement({
      ngl: full,
      pinnedOver,
      cacheHeadroom: 0,
      cacheFloor: 0,
    }),
  };
  let measured = pinned;
  let forced = pinnedOver > 0;

  if (pinnedOver > 0) {
    // 2. It does not fit: every expert to host RAM, everything else still at
    //    -ngl full. No partial spill, no per-layer bargain.
    let ngl = full;
    let spilled = await probe({ ...raw, ngl, cpuMoeAll: true });
    let spilledOver = over(spilled);
    // Even with the experts gone the device is full, so whole layers have to
    // come back. The GGUF table only says how far to reach for the next guess.
    /* eslint-disable no-await-in-loop -- sequential by design: each probe is
     *  what decides the next placement, and they share one cancellation run. */
    for (let step = 0; spilledOver > 0 && ngl > 0 && step < 4; step += 1) {
      ngl = nglForOver(prep.model, ngl, spilledOver);
      spilled = await probe({ ...raw, ngl, cpuMoeAll: true });
      spilledOver = over(spilled);
    }
    forced = spilledOver > 0;

    // 3. The pool takes whatever the spill left on the device.
    placement = {
      ...raw,
      ...decideMoePlacement({
        ngl,
        pinnedOver,
        cacheHeadroom: -spilledOver,
        cacheFloor: moeCacheFloorBytes(prep.model),
        maxCacheMib:
          profile.moeCacheMib !== undefined && profile.moeCacheMib > 0
            ? profile.moeCacheMib
            : undefined,
      }),
    };
    measured = await probe(placement);
    // The pool is allocated in whole expert slots, so the size the measurement
    // leaves room for can still print a few MiB over. Take it back out of the
    // pool: it is the plan's only device allocation that is not a layer.
    let poolOver = over(measured);
    for (let step = 0; poolOver > 0 && step < 3; step += 1) {
      const next = shrinkMoeCache(placement, poolOver);
      if (!next) break;
      placement = next;
      measured = await probe(placement);
      poolOver = over(measured);
    }
    /* eslint-enable no-await-in-loop */
    forced = poolOver > 0;
  }

  if (isDev()) {
    console.debug(
      '[fit-estimator:plan]',
      JSON.stringify(
        {
          model: prep.model.name,
          kind: prep.model.kind,
          nLayerAll: prep.model.nLayerAll,
          draftLayers: prep.model.draftLayers,
          budgetsMiB: {
            devices: prep.deviceBudget.map((b) => Math.round(b / MiB)),
            host: Math.round(prep.ramLimitBytes / MiB),
          },
          requestedCtx: ctx,
          imgTokens: mmproj.ctxTokens,
          plan: placementLabel(placement),
          placement,
          forced,
          probed,
        },
        null,
        2,
      ),
    );
  }
  return reportPlacement(
    prep,
    modelPath,
    ctx,
    projectorPath,
    profile,
    placement,
    measured,
    {
      label: placementLabel(placement),
      forced,
      runId,
    },
  );
}
// ── Single-point estimate (memory panel) ──

/** Profile with the optimizer plan's placement fields substituted, using the
 *  same precedence buildLlamaServerArgs applies. Both the probe's arguments and
 *  the estimate cache key must describe the placement the server will run: a
 *  plan solved a spill and a cache that the profile's own fields never mention,
 *  and keying on those fields alone would also serve a stale estimate after a
 *  re-solve. */
function withEffectivePlacement(
  profile: Partial<Profile>,
  ngl: number,
): Partial<Profile> {
  const pl = effectivePlacement(profile, ngl);
  return {
    ...profile,
    cpuMoe: pl.cpuMoeAll === true,
    nCpuMoe: pl.nCpuMoe,
    nCpuFfn: pl.nCpuFfn,
    moeCacheMib: pl.moeCacheMib,
  };
}

/** Subdivides the measured weight columns with the GGUF tensor table. The probe
 *  stays the authority on how much the binary spent; the table only says how
 *  that total is composed, so every part is scaled to the measured column and
 *  the parts sum to it exactly. */
async function estimateBreakdown(
  modelPath: string,
  pl: Placement,
  measured: { modelVram: number; ctxVram: number; modelRam: number },
  mmproj: {
    weights: number;
    encoder: number;
    hostWeights: number;
    hostEncoder: number;
  },
): Promise<MemoryBreakdown | null> {
  try {
    const model = classifyModel(await readGgufInfoCached(modelPath));
    const w = weightSplit(model, pl);
    const b = weightBreakdown(model, pl);
    const devScale = w.device > 0 ? measured.modelVram / w.device : 0;
    const hostScale = w.host > 0 ? measured.modelRam / w.host : 0;
    // The expert cache bills into the device context column (measured), so it
    // is carved out of that column rather than added beside it.
    const cache = Math.min(w.cacheDeviceBytes, measured.ctxVram);
    const gpuStart = Math.min(firstGpuLayer(model, pl.ngl), model.baseLayers);
    return {
      vram: {
        layers: b.attnDevice * devScale,
        experts: b.expertsDevice * devScale,
        ffn: b.ffnDevice * devScale,
        output: b.outputDevice * devScale,
        cache,
        mmprojWeights: mmproj.weights,
        mmprojEncoder: mmproj.encoder,
      },
      ram: {
        // Non-layer tensors are few and small; they ride with the host layers
        // rather than becoming a segment of their own.
        layers: (b.layersHost + b.otherHost) * hostScale,
        experts: b.expertsHost * hostScale,
        ffn: b.ffnHost * hostScale,
        embedding: b.embeddingHost * hostScale,
        // The probe bills a streamed tensor to the host column, so it belongs
        // in the column's subdivision — but the run reads it from the file, so
        // the caller takes it back out of the RAM total. It is the one slice the
        // total does not count, and the bar draws it hatched to say so.
        lazy: b.lazyHost * hostScale,
        mmprojWeights: mmproj.hostWeights,
        mmprojEncoder: mmproj.hostEncoder,
      },
      counts: {
        gpuLayers: w.gpuLayers,
        totalLayers: model.baseLayers,
        // Only layers a device holds can have anything spilled off them.
        expertLayersSpilled: Math.max(
          0,
          Math.min(spilledExpertLayers(model, pl), model.baseLayers) - gpuStart,
        ),
        ffnLayersSpilled: Math.max(
          0,
          Math.min(spilledFfnLayers(model, pl), model.baseLayers) - gpuStart,
        ),
        cacheMib: Math.round(cache / MiB),
      },
    };
  } catch (e) {
    // A missing or unreadable header costs the extra segments, never the bar.
    console.error(
      '[fit-estimator] breakdown failed:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export async function estimateMemoryAtConfig(
  modelPathIn: string,
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
  breakdown: MemoryBreakdown | null;
}> {
  const modelPath = firstSplitPart(modelPathIn);
  const zero: {
    modelVramUsage: number;
    contextVramUsage: number;
    computeOverheadVram: number;
    modelRamUsage: number;
    contextRamUsage: number;
    computeOverheadRam: number;
    fileBufferRam: number;
    breakdown: MemoryBreakdown | null;
  } = {
    modelVramUsage: 0,
    contextVramUsage: 0,
    computeOverheadVram: 0,
    modelRamUsage: 0,
    contextRamUsage: 0,
    computeOverheadRam: 0,
    fileBufferRam: 0,
    breakdown: null,
  };
  try {
    const fitPath = await resolveFitPath();
    const supported = await getSupportedFlags(fitPath);
    const pl = effectivePlacement(profile, ngl);
    // Forward the caller's real kvOffload: --no-kv-offload natively moves KV
    // to host in the measurement (no manual fixup needed).
    // Apply the stored placement triple when the caller provides one (the
    // optimizer panel passes it for the exact values it was solved for).
    // Without it a partial-overflow plan reads as whole layers resident.
    const m = await probeAt(fitPath, supported, modelPath, profile, ctx, pl, {
      tensorSplit: profile.tensorSplit ?? null,
      overrides: profile.tensorOverrides ?? null,
    });
    const modelVramUsage = m.devices.reduce((a, d) => a + d.model, 0);
    const contextVramUsage = m.devices.reduce((a, d) => a + d.context, 0);
    const computeOverheadVram = m.devices.reduce((a, d) => a + d.compute, 0);
    const mmap = (profile as any).mmap ?? true;

    // The projector is never in a probe: the pinned llama-fit-params has no
    // --mmproj. Its cost is analytic (estimator/mmproj.ts) and is booked here
    // exactly as the optimizer books it, so the bar and the plan agree.
    let mmproj: MmprojReserve | null = null;
    if (projectorPath && fs.existsSync(projectorPath)) {
      mmproj = mmprojReserve(await readMmprojInfo(projectorPath), {
        offload: (profile as any).mmprojOffload === true,
        images: 1,
        imageMaxTokens: (profile as any).imageMaxTokens,
        imageMinTokens: (profile as any).imageMinTokens,
        flashAttn: (profile as any).flashAttn !== 'off',
      });
    }
    const offloadMmproj = (profile as any).mmprojOffload === true;
    const mmprojSplit = mmproj
      ? {
          weights: offloadMmproj ? mmproj.weightBytes : 0,
          encoder: offloadMmproj ? mmproj.activationBytes : 0,
          hostWeights: offloadMmproj ? 0 : mmproj.weightBytes,
          hostEncoder: offloadMmproj
            ? mmproj.hostBytes
            : mmproj.activationBytes,
        }
      : { weights: 0, encoder: 0, hostWeights: 0, hostEncoder: 0 };
    const mmprojDevice = mmprojSplit.weights + mmprojSplit.encoder;
    const mmprojHost = mmprojSplit.hostWeights + mmprojSplit.hostEncoder;

    const breakdown = await estimateBreakdown(
      modelPath,
      pl,
      {
        modelVram: modelVramUsage,
        ctxVram: contextVramUsage,
        modelRam: m.host.model,
      },
      mmprojSplit,
    );
    // The streamed tables sit in the measured host column but the run never
    // holds them, so they come out of the RAM total — and out of the load
    // buffer, which holds what the run reads into memory, not what it streams.
    const streamed = breakdown?.ram.lazy ?? 0;
    // With --load-mode none the OS keeps the whole file in a heap buffer for
    // the process lifetime; approximate it from the measured weights.
    const fileBufferRam = !mmap
      ? Math.max(0, modelVramUsage + m.host.model - streamed)
      : 0;

    return {
      modelVramUsage: modelVramUsage + mmprojDevice,
      contextVramUsage,
      computeOverheadVram,
      modelRamUsage: Math.max(0, m.host.model - streamed) + mmprojHost,
      contextRamUsage: m.host.context,
      computeOverheadRam: m.host.compute,
      fileBufferRam,
      breakdown,
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
    nCpuFfn: p.nCpuFfn ?? 0,
    moeCacheMib: p.moeCacheMib ?? 0,
    moeCacheCpuShare: p.moeCacheCpuShare ?? 0,
    lazyMode: p.lazyMode ?? 'auto',
    mmprojOffload: p.mmprojOffload ?? false,
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
  modelPathIn: string,
  ngl: number,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
) {
  // Keyed on the placement the probe will actually run, so a re-solve that
  // changes spill or cache invalidates the entry instead of serving the old one.
  // Split parts share one entry: they are the same model.
  const modelPath = firstSplitPart(modelPathIn);
  const effective = withEffectivePlacement(profile, ngl);
  const key = estimateCacheKey(modelPath, ngl, ctx, projectorPath, effective);
  const existing = memoryEstimateCache.get(key);
  if (existing) return existing;

  const promise = estimateMemoryAtConfig(
    modelPath,
    ngl,
    ctx,
    projectorPath,
    effective,
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
  modelPathIn: string,
  vramMB: number | undefined,
  ramMB: number | undefined,
  ctx: number,
  projectorPath?: string,
  profile: Partial<Profile> = {},
): Promise<MemoryEstimation> {
  /* eslint-enable default-param-last */
  // One in-flight run per model, whichever part of a split model named it.
  const modelPath = firstSplitPart(modelPathIn);
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

const speedLineCache = new Map<string, number | null>();

// A backend install, reinstall or uninstall replaces (or removes) the binaries
// these probes were measured with — including at the SAME path, which is what a
// reinstall does. Every cache keyed by a backend path or by a measurement taken
// through one has to go with it.
export function invalidateBackendProbeCaches(): void {
  helpCache.clear();
  deviceTotalsCache.clear();
  memoryEstimateCache.clear();
  speedLineCache.clear();
  clearGgufInfoCache();
}

// ── Maximum-speed line ──
// Strict whole-layer answer to how far ctx can grow before anything spills off
// the GPU: largest ctx at full offload, VRAM only. RAM never caps this line — it
// is the maximum-speed line, not the maximum-possible one. Two probes bracket
// the answer, one division locates it, a few more verify it.

export async function maxFullOffloadCtx(
  modelPathIn: string,
  vramMB: number | undefined,
  projectorPath?: string,
  profile: Partial<Profile> = {},
  runId?: number,
): Promise<number | null> {
  const modelPath = firstSplitPart(modelPathIn);
  const key = `${modelPath}|${vramMB}|${projectorPath ?? ''}|${fitRelevantKey(profile)}`;
  const cached = speedLineCache.get(key);
  if (cached !== undefined) return cached;

  const prep = await prepareFit(
    modelPath,
    vramMB,
    undefined,
    projectorPath,
    profile,
    CTX_MIN,
    runId,
  );
  const full = prep.model.fullOffloadNgl;
  const probe = (ctx: number) =>
    probeAt(
      prep.fitPath,
      prep.supported,
      modelPath,
      profile,
      ctx,
      { ngl: full },
      {
        runId,
        deviceArg: prep.deviceArg,
      },
    );
  const mmproj = mmprojFor(prep);
  const imgTokens = mmproj.ctxTokens;
  const { maxModelCtx } = prep;

  // Fast path: the model's own maximum context fits whole.
  const atMax = await probe(maxModelCtx + imgTokens);
  if (overBudget(prep, atMax, mmproj.device) <= 0) {
    speedLineCache.set(key, maxModelCtx);
    return maxModelCtx;
  }
  // Even the smallest context overpacks a device at full offload: no
  // full-offload ctx exists.
  const atMin = await probe(CTX_MIN + imgTokens);
  if (overBudget(prep, atMin, mmproj.device) > 0) {
    speedLineCache.set(key, null);
    return null;
  }
  // Interpolate from the two probes, then verify: each step halves the
  // uncertainty, and the probe is what decides.
  const span = maxModelCtx - CTX_MIN;
  const grown = atMax.devices.map((d, i) =>
    Math.max(1, probeDeviceTotal(d) - probeDeviceTotal(atMin.devices[i] ?? d)),
  );
  let guess = maxModelCtx;
  if (atMin.devices.length === prep.deviceBudget.length) {
    guess = Math.min(
      ...atMin.devices.map((d, i) => {
        const free =
          (prep.deviceBudget[i] ?? Number.POSITIVE_INFINITY) -
          probeDeviceTotal(d) -
          (i === 0 ? mmproj.device : 0);
        return CTX_MIN + free / (grown[i] / span);
      }),
    );
  }
  let candidate = Math.min(
    maxModelCtx,
    Math.max(CTX_MIN, Math.floor(guess / CTX_SNAP) * CTX_SNAP),
  );
  let verified: number | null = null;
  /* eslint-disable no-await-in-loop -- bisection: each probe narrows the range
   *  the next one is placed in. */
  for (let step = 0; step < 6; step += 1) {
    const m = await probe(candidate + imgTokens);
    if (overBudget(prep, m, mmproj.device) <= 0) {
      verified = candidate;
      if (candidate >= maxModelCtx) break;
      candidate = Math.min(
        maxModelCtx,
        Math.floor((candidate + maxModelCtx) / 2 / CTX_SNAP) * CTX_SNAP,
      );
      if (candidate <= verified) break;
    } else {
      candidate = Math.max(
        CTX_MIN,
        Math.floor((CTX_MIN + candidate) / 2 / CTX_SNAP) * CTX_SNAP,
      );
      if (verified !== null && candidate <= verified) break;
    }
  }
  /* eslint-enable no-await-in-loop */
  const answer = verified === null ? null : verified - imgTokens;
  if (isDev()) {
    console.log(`[fit-estimator] max full-offload ctx: ${answer ?? 'none'}`);
  }
  speedLineCache.set(key, answer);
  return answer;
}
