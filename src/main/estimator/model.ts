// The facts the optimizer needs about a model, and nothing else.
//
// This file answers two questions:
//   1. Which bytes does llama.cpp put where? Reproduced exactly from the rule
//      in src/llama-model.cpp (load_tensors), read off the GGUF tensor table.
//   2. For a MoE, which of the two placements does the rule allow? That answer
//      is a decision over MEASURED probe results (see decideMoePlacement) — the
//      file never predicts what a device can hold.
//
// The placement rule, from llama.cpp:
//
//     i_gpu_start   = max(n_layer_all + 1 - n_gpu_layers, 0)
//     layer il  -> GPU  iff  il >= i_gpu_start
//     slot n_layer_all (the output tensor) -> follows the same rule
//     the input embedding is always assigned to the CPU
//
// Verified against --fit-print on this machine: predicted and reported device
// "model" columns agree to <= 1 MiB for -ngl in {0,1,2,3,4,5,6,20,40,60..65}
// on a 65-layer 27B and a 33-layer 4B. Three details of that rule matter:
//
//   * -ngl counts from the END. `-ngl 1` offloads only the output tensor;
//     `-ngl N` offloads layers [n_layer_all + 1 - N, n_layer_all).
//   * native MTP/draft layers (the last nextn_predict_layers of the file) are
//     not loaded at all unless speculation is enabled, so they occupy -ngl
//     budget but cost 0 bytes. Synapse does not enable speculation, so the
//     draft bytes are reported separately and never fitted.
//   * when a file ties its embeddings (no separate output.weight), llama.cpp
//     still creates its own output tensor as a duplicate, so the GPU pays for
//     a second copy of the embedding while the host keeps the original. That
//     is why a tied file's device+host columns exceed the file size.
//
// Question 1 is the memory bar's job: a probe says how many bytes the binary
// spent, weightSplit/weightBreakdown say how that total is composed. Question 2
// is the optimizer's MoE rule. Nothing here sizes a context or ranks a plan.

import { ggufArchNumber, ggufString, layerBytes, type GgufInfo } from './gguf';

export const MiB = 1024 * 1024;
/** Context values are chosen in multiples of this. */
export const CTX_SNAP = 512;
export const CTX_MIN = 512;

export type ModelKind = 'dense' | 'moe';

export interface ModelClass {
  kind: ModelKind;
  arch: string;
  name: string;
  /** `<arch>.block_count` == llama.cpp's n_layer_all. Slot n_layer_all (the
   *  output tensor) sits on top of this, so full offload is n_layer_all + 1. */
  nLayerAll: number;
  /** Layers that are actually loaded: block_count minus native draft layers. */
  baseLayers: number;
  /** `<arch>.nextn_predict_layers` (MTP heads at the end of the file). */
  draftLayers: number;
  /** -ngl value that offloads everything (-ngl all). */
  fullOffloadNgl: number;
  /** Per-layer total bytes, length nLayerAll (draft entries are real bytes
   *  from the file, reported separately as draftBytes). */
  layerBytes: number[];
  /** Expert bytes per layer (the set --cpu-moe / --n-cpu-moe moves). */
  expertBytes: number[];
  /** Dense FFN bytes per layer (the set --n-cpu-ffn moves). */
  denseFfnBytes: number[];
  /** Bytes of the draft layers: loaded only when speculation is enabled. */
  draftBytes: number;
  /** token_embd plus every other always-host tensor. */
  inputBytes: number;
  /** output.weight when the file stores one, else 0 (tied embeddings). */
  outputRealBytes: number;
  /** Extra device bytes the output slot costs: outputRealBytes for a normal
   *  file, the embedding size again for a tied file (duplicate tensor). */
  outputDeviceBytes: number;
  /** Total bytes llama.cpp loads for a non-speculative run. */
  loadedBytes: number;
  /** Sum of every tensor in the file, draft layers included. */
  fileWeightBytes: number;
  expertCount: number;
  expertUsed: number;
  swaWindow: number | null;
  fullAttentionInterval: number | null;
  ssm: boolean;
  modelMaxContext: number;
  /** Bytes of each tensor llama.cpp may read on demand (--lazy-mode), in table
   *  order. See LAZY_TENSOR. */
  lazyTensors: number[];
}

const INPUT_TENSOR = /^(token_embd|\.token_embd)\./;
const OUTPUT_TENSOR = /^output\./;

/** The tensors llama.cpp marks for on-demand reading (`--lazy-mode`): the
 *  per-layer embedding tables, matched by name. Deliberately not an architecture
 *  allowlist — the architectures that carry these tables keep growing, and a
 *  name test picks up the next one without a code change, the same reason the
 *  GGUF reader sizes tensors from offsets rather than from a dtype table.
 *  `per_layer_token_embd.weight` (Qwen4Exp / Gemma 4) and the output-side
 *  `per_layer_embd_out` both match; the projection tensors beside them do not,
 *  and are far too small to matter either way. */
export const LAZY_TENSOR = /per_layer_(?:token_)?embd/;

/** llama.cpp's `auto` floor (`lazy_read::add`, `auto_min_size`): below this a
 *  streamed tensor costs more in per-row reads than it saves in RAM, so `auto`
 *  keeps it resident. */
export const LAZY_AUTO_MIN_BYTES = 4 * 1024 * 1024 * 1024;

/** Bytes this placement reads from the file instead of holding in RAM.
 *  Decided per tensor, exactly as llama.cpp does it: `off` never streams, `on`
 *  streams every candidate, `auto` only the candidates over 4 GiB. */
export function lazyBytes(
  model: ModelClass,
  mode: 'on' | 'off' | 'auto' = 'auto',
): number {
  if (mode === 'off') return 0;
  return model.lazyTensors.reduce(
    (sum, bytes) =>
      mode === 'on' || bytes > LAZY_AUTO_MIN_BYTES ? sum + bytes : sum,
    0,
  );
}

export function classifyModel(info: GgufInfo): ModelClass {
  const lb = layerBytes(info);
  const nLayerAll = Math.max(
    ggufArchNumber(info, 'block_count') ?? 0,
    lb.maxLayer + 1,
  );
  // GGUF block_count already counts the draft layer(s) at the end of the file,
  // so they must be subtracted, never added. (An earlier revision of this code
  // added them; the probes showed the fitter's totals exclude them entirely.)
  const draftLayers = Math.min(
    nLayerAll,
    ggufArchNumber(info, 'nextn_predict_layers') ?? 0,
  );
  const baseLayers = Math.max(1, nLayerAll - draftLayers);

  const total = (arr: number[], from: number, to: number): number => {
    let s = 0;
    for (let i = Math.max(0, from); i < Math.min(arr.length, to); i += 1) {
      s += arr[i];
    }
    return s;
  };

  let tokenEmbBytes = 0;
  let outputRealBytes = 0;
  let otherInputBytes = 0;
  const lazyTensors: number[] = [];
  info.tensors.forEach((t) => {
    if (INPUT_TENSOR.test(t.name)) {
      tokenEmbBytes += t.bytes;
    } else if (OUTPUT_TENSOR.test(t.name)) {
      outputRealBytes += t.bytes;
    } else if (!/^blk\.\d+\./.test(t.name)) {
      otherInputBytes += t.bytes;
    }
    if (LAZY_TENSOR.test(t.name)) lazyTensors.push(t.bytes);
  });

  const draftBytes = total(lb.total, baseLayers, nLayerAll);
  const loadedLayerBytes = total(lb.total, 0, baseLayers);
  const swaWindow = ggufArchNumber(info, 'attention.sliding_window') ?? null;
  const interval = ggufArchNumber(info, 'full_attention_interval') ?? null;
  const layerBytesOut = lb.total.slice(0, nLayerAll);
  while (layerBytesOut.length < nLayerAll) layerBytesOut.push(0);

  return {
    // Exact test: only a tensor table can tell MoE from dense, and gemma-4-E4B
    // is proof that expert_count-style keys are not enough (it has neither
    // expert tensors nor expert_count keys).
    kind: lb.hasExperts ? 'moe' : 'dense',
    arch: info.arch,
    name: ggufString(info, 'general.name') ?? info.arch,
    nLayerAll,
    baseLayers,
    draftLayers,
    fullOffloadNgl: nLayerAll + 1,
    layerBytes: layerBytesOut,
    expertBytes: lb.expert.slice(0, nLayerAll),
    denseFfnBytes: lb.denseFfn.slice(0, nLayerAll),
    draftBytes,
    inputBytes: tokenEmbBytes + otherInputBytes,
    outputRealBytes,
    outputDeviceBytes: outputRealBytes > 0 ? outputRealBytes : tokenEmbBytes,
    loadedBytes:
      loadedLayerBytes + tokenEmbBytes + otherInputBytes + outputRealBytes,
    fileWeightBytes: info.weightBytes,
    expertCount: ggufArchNumber(info, 'expert_count') ?? 0,
    expertUsed: ggufArchNumber(info, 'expert_used_count') ?? 0,
    swaWindow,
    fullAttentionInterval: interval,
    ssm:
      ggufArchNumber(info, 'ssm_count') !== undefined ||
      ggufArchNumber(info, 'ssm.d_state') !== undefined ||
      info.arch === 'mamba' ||
      info.arch === 'mamba2' ||
      info.kv?.has(`${info.arch}.ssm.conv_kernel`) === true,
    modelMaxContext: ggufArchNumber(info, 'context_length') ?? 4096,
    lazyTensors,
  };
}

// ── Placement ───────────────────────────────────────────────────────────────

/** What the optimizer is allowed to decide. Every field is a llama.cpp flag;
 *  null/undefined means "do not pass the flag" (llama.cpp's own default). */
export interface Placement {
  /** -ngl, counted exactly as llama.cpp counts it (see fullOffloadNgl). */
  ngl: number;
  /** --n-cpu-moe: layers whose experts are kept in host RAM, 0..baseLayers. */
  nCpuMoe?: number;
  /** --cpu-moe: every layer's experts in host RAM. */
  cpuMoeAll?: boolean;
  /** --n-cpu-ffn: layers whose dense FFN is kept in host RAM. */
  nCpuFfn?: number;
  /** --moe-cache-mib (requested, in MiB). */
  moeCacheMib?: number;
  /** --moe-cache-cpu-share: share of cache misses the CPU computes from host
   *  experts instead of uploading. It moves no cache bytes off the device, so
   *  the optimizer never searches it — it is only echoed from the profile. */
  moeCacheCpuShare?: number;
  /** --lazy-mode on/off/auto. The optimizer never searches it; the byte tables
   *  read it to know which host tensors are streamed instead of held. */
  lazyMode?: 'on' | 'off' | 'auto';
}

/** i_gpu_start from llama-model.cpp: the first layer index that ends up on a
 *  GPU. Everything below it stays on the host. */
export function firstGpuLayer(model: ModelClass, ngl: number): number {
  if (ngl <= 0) return Number.POSITIVE_INFINITY;
  if (ngl >= model.fullOffloadNgl) return 0;
  return Math.max(model.nLayerAll + 1 - ngl, 0);
}

/** Layer indices whose experts --n-cpu-moe / --cpu-moe moves to the host. */
export function spilledExpertLayers(model: ModelClass, pl: Placement): number {
  if (pl.cpuMoeAll) return model.baseLayers;
  const n = pl.nCpuMoe ?? 0;
  return Math.max(0, Math.min(n, model.baseLayers));
}

export function spilledFfnLayers(model: ModelClass, pl: Placement): number {
  return Math.max(0, Math.min(pl.nCpuFfn ?? 0, model.baseLayers));
}

/** Smallest --moe-cache-mib worth reserving at all.
 *
 *  llama.cpp's hard limit is that a pool must hold the experts one token
 *  activates, per bank of layers that share an expert layout; below it the
 *  server stops with "MoE cache is too small to hold the experts of one
 *  token". That is a launch failure, so it is the only floor the optimizer
 *  applies. On the --cpu-moe plan the cache takes whatever VRAM the spill
 *  freed, however small a share of the spill that turns out to be: there used
 *  to be a coverage threshold here too, and it is what let the optimizer hand
 *  the VRAM back to pinned experts and launch with an empty cache.
 *
 *  For the record, a pool that small does measure badly (Qwen3-30B-A3B on a
 *  16 GB T4: 50 MiB pool = 3.8 tok/s, --cpu-moe with no cache = 9.6). The rule
 *  is still to fund the pool, because the alternative the threshold produced
 *  was worse in practice, and the threshold was a guess while this floor is a
 *  documented limit. */
export function moeCacheFloorBytes(model: ModelClass): number {
  if (model.kind !== 'moe' || model.expertCount <= 0 || model.expertUsed <= 0) {
    return 0;
  }
  // The cheapest bank to satisfy is the one that decides whether any cache
  // exists: llama.cpp caches the banks that clear the floor and warns about
  // the rest, and refuses to start when none of them do.
  let slot = 0;
  for (let il = 0; il < model.baseLayers; il += 1) {
    const bytes = (model.expertBytes[il] ?? 0) / model.expertCount;
    if (bytes > 0 && (slot === 0 || bytes < slot)) slot = bytes;
  }
  if (slot === 0) return 0;
  // One token's experts, plus the spare slot llama.cpp keeps per bank.
  return Math.ceil(slot * (model.expertUsed + 1));
}

export interface WeightSplit {
  /** Device weight bytes including the duplicated-output copy. */
  device: number;
  /** Host weight bytes (always holds the input embedding). */
  host: number;
  /** Expert bytes resident in host RAM. */
  expertSpilled: number;
  /** Dense FFN bytes resident in host RAM. */
  ffnSpilled: number;
  /** Layer indices offloaded to a GPU. */
  gpuLayers: number;
  /** Expert cache actually allocated: min(requested, spilled). */
  cacheBytes: number;
  /** The part of that cache that costs device memory. All of it (see
   *  weightSplit): the cache is device-resident by construction. */
  cacheDeviceBytes: number;
}

/** Byte-exact weight placement for a candidate, from the GGUF tables. */
export function weightSplit(model: ModelClass, pl: Placement): WeightSplit {
  const start = firstGpuLayer(model, pl.ngl);
  const expertCut = spilledExpertLayers(model, pl);
  const ffnCut = spilledFfnLayers(model, pl);
  let device = 0;
  let expertSpilled = 0;
  let ffnSpilled = 0;
  let gpuLayers = 0;
  // Layers below `start` are host whole, so the device loop starts at the cut.
  // (ngl 0 makes start Infinity, which leaves the loop empty.)
  const gpuStart = Math.min(start, model.baseLayers);
  for (let il = gpuStart; il < model.baseLayers; il += 1) {
    gpuLayers += 1;
    const ex = il < expertCut ? (model.expertBytes[il] ?? 0) : 0;
    const ff = il < ffnCut ? (model.denseFfnBytes[il] ?? 0) : 0;
    expertSpilled += ex;
    ffnSpilled += ff;
    device += Math.max(0, (model.layerBytes[il] ?? 0) - ex - ff);
  }
  const onDevice = pl.ngl >= 1;
  device += onDevice ? model.outputDeviceBytes : 0;
  const requested = (pl.moeCacheMib ?? 0) * MiB;
  // Measured: the cache bills into the device context column and is capped by
  // the expert bytes actually spilled; with no spilled experts it is inert.
  // The whole cache lives on the device — --moe-cache-cpu-share only decides
  // where cache MISSES are computed, not where cache bytes live.
  const cacheBytes = expertSpilled > 0 ? Math.min(requested, expertSpilled) : 0;
  // The host copy is what the file contributes: spilled bytes were never
  // subtracted from the host side, and a duplicated output tensor adds a
  // second device copy without removing the host one.
  const host =
    model.loadedBytes -
    (device - (onDevice ? model.outputDeviceBytes - model.outputRealBytes : 0));
  return {
    device,
    host,
    expertSpilled,
    ffnSpilled,
    gpuLayers,
    cacheBytes,
    cacheDeviceBytes: cacheBytes,
  };
}

/**
 * The placement a launch — or a probe meant to price one — will really use for
 * this -ngl. Mirrors buildLlamaServerArgs: spill and cache are part of the
 * placement the optimizer solved, so the plan wins while its -ngl is the one
 * being used; otherwise the user's own fields are the placement. A probe that
 * priced a different placement than the server runs would report numbers that
 * belong to a command nobody launches.
 */
export interface PlacementFields {
  optimizerPlan?: {
    ngl: number;
    cpuMoe?: boolean;
    nCpuMoe?: number;
    nCpuFfn?: number;
    moeCacheMib?: number;
  } | null;
  cpuMoe?: boolean;
  nCpuMoe?: number;
  nCpuFfn?: number;
  moeCacheMib?: number;
  /** --lazy-mode. Not part of a placement — it is a load behaviour the plan
   *  never changes — but the byte tables need it to know which host tensors
   *  the run holds and which it streams from the file. */
  lazyMode?: 'on' | 'off' | 'auto';
}

export function effectivePlacement(
  fields: PlacementFields,
  ngl: number,
): Placement {
  const plan = fields.optimizerPlan;
  const usePlan = plan != null && plan.ngl === ngl;
  const src = usePlan ? plan : fields;
  return {
    ngl,
    cpuMoeAll: src.cpuMoe === true,
    nCpuMoe: src.nCpuMoe,
    nCpuFfn: src.nCpuFfn,
    moeCacheMib: src.moeCacheMib,
    lazyMode: fields.lazyMode,
  };
}

/**
 * weightSplit's two totals, split into the groups the memory bar draws.
 *
 * The identity that matters: the four device parts sum to `weightSplit().device`
 * and the five host parts sum to `.host`. The bar only ever subdivides a column
 * the probe measured, so a breakdown can never account for bytes the binary did
 * not report.
 */
export interface WeightBreakdown {
  /** GPU layer bytes no spill lever can move: attention, norms, router, and the
   *  part of a partially spilled layer that stays resident. */
  attnDevice: number;
  /** Expert bytes of GPU layers --cpu-moe/--n-cpu-moe left on the device. */
  expertsDevice: number;
  /** Dense FFN bytes of GPU layers --n-cpu-ffn left on the device. */
  ffnDevice: number;
  /** The output slot's device copy: output.weight, or a second copy of the
   *  embedding for a tied file. */
  outputDevice: number;
  /** token_embd and every other always-host tensor, plus output.weight when the
   *  file stores one and -ngl leaves it at home. Excludes the streamed tables. */
  embeddingHost: number;
  /** The --lazy-mode tables: billed to the host column by the probe, but read
   *  from the file on demand rather than held resident. */
  lazyHost: number;
  /** Whole layers the -ngl cut left on the host. */
  layersHost: number;
  /** Expert bytes of GPU layers moved to the host (== expertSpilled). */
  expertsHost: number;
  /** Dense FFN bytes of GPU layers moved to the host (== ffnSpilled). */
  ffnHost: number;
  /** Guard: tensors that belong to no layer and to neither of the two named
   *  groups. Zero for every arch whose table we read completely. */
  otherHost: number;
}

export function weightBreakdown(
  model: ModelClass,
  pl: Placement,
): WeightBreakdown {
  const w = weightSplit(model, pl);
  const start = firstGpuLayer(model, pl.ngl);
  const expertCut = spilledExpertLayers(model, pl);
  const ffnCut = spilledFfnLayers(model, pl);
  let attnDevice = 0;
  let expertsDevice = 0;
  let ffnDevice = 0;
  let layersHost = 0;
  // A host layer is host whole: --n-cpu-moe moves nothing that a device never
  // held, which is exactly what weightSplit does with it too.
  const hostEnd = Math.min(start, model.baseLayers);
  for (let il = 0; il < hostEnd; il += 1) {
    layersHost += model.layerBytes[il] ?? 0;
  }
  for (let il = hostEnd; il < model.baseLayers; il += 1) {
    const total = model.layerBytes[il] ?? 0;
    const ex = model.expertBytes[il] ?? 0;
    const ff = model.denseFfnBytes[il] ?? 0;
    attnDevice += total - ex - ff;
    if (il >= expertCut) expertsDevice += ex;
    if (il >= ffnCut) ffnDevice += ff;
  }
  const onDevice = pl.ngl >= 1;
  const outputDevice = onDevice ? model.outputDeviceBytes : 0;
  // The streamed tables live in inputBytes (they are neither layer nor output
  // tensors), so they come back out of the embedding slice and become their own.
  const lazyHost = lazyBytes(model, pl.lazyMode);
  const embeddingHost =
    Math.max(0, model.inputBytes - lazyHost) +
    (onDevice ? 0 : model.outputRealBytes);
  return {
    attnDevice,
    expertsDevice,
    ffnDevice,
    outputDevice,
    embeddingHost,
    lazyHost,
    layersHost,
    expertsHost: w.expertSpilled,
    ffnHost: w.ffnSpilled,
    otherHost: Math.max(
      0,
      w.host -
        (embeddingHost +
          lazyHost +
          layersHost +
          w.expertSpilled +
          w.ffnSpilled),
    ),
  };
}

// ── Probe rows ──────────────────────────────────────────────────────────────

/** One row of a `--fit-print` run, in bytes. */
export interface FitRow {
  name: string;
  model: number;
  context: number;
  compute: number;
}

/** What one `--fit-print` probe measured, for one placement at one context.
 *  This is the only memory measurement the optimizer has: it is llama.cpp's
 *  own accounting, not an estimate of it. */
export interface Probe {
  ctx: number;
  devices: FitRow[];
  host: FitRow;
  /** Placement the probe measured. */
  placement: Placement;
}

export const probeDeviceTotal = (row: FitRow): number =>
  row.model + row.context + row.compute;

// ── The MoE rule ────────────────────────────────────────────────────────────

/**
 * The whole MoE placement policy, as a pure function of what the probes
 * measured. Two placements exist and the rule picks between them:
 *
 *   1. pinned — every layer on the device, no expert cache. If the experts fit
 *      in VRAM, fit them. Nothing else to discuss.
 *   2. spilled — `--cpu-moe`: every expert in host RAM, everything else still
 *      at `-ngl` full, and `--moe-cache-mib` takes whatever VRAM the spill
 *      freed. A partial spill (`--n-cpu-moe`) is not a placement this rule
 *      knows about: it pins most experts, spends the VRAM it freed on a pool
 *      over a handful of layers, and leaves the rest uncached.
 *
 * There is no third option and no ranking: `pinnedOver` is the only question.
 * Host memory never enters — a `--cpu-moe` plan is allowed to need more RAM
 * than the machine has, and the caller reports the overflow instead of using
 * it to refuse.
 *
 * `cacheHeadroom` is the measured free device bytes at the spilled placement;
 * `cacheFloor` is moeCacheFloorBytes, llama.cpp's own limit (a pool that cannot
 * hold one token's experts makes the server exit). Below the floor there is no
 * pool to fund, so the plan runs with none rather than one that cannot start.
 */
export function decideMoePlacement(f: {
  ngl: number;
  pinnedOver: number;
  cacheHeadroom: number;
  cacheFloor: number;
  /** A --moe-cache-mib the user set themselves is a cap on the pool, not an
   *  instruction to size it: llama.cpp already caps the cache at the spill, and
   *  the spill itself is this rule's decision. */
  maxCacheMib?: number;
}): Placement {
  if (f.pinnedOver <= 0) return { ngl: f.ngl };
  const mib = Math.floor(Math.max(0, f.cacheHeadroom) / MiB);
  const floorMib = Math.ceil(f.cacheFloor / MiB);
  const capped =
    f.maxCacheMib !== undefined && f.maxCacheMib > 0
      ? Math.min(mib, f.maxCacheMib)
      : mib;
  return {
    ngl: f.ngl,
    cpuMoeAll: true,
    moeCacheMib: capped >= floorMib ? capped : 0,
  };
}

/** A cache cut for a spilled plan that measured over budget: the pool is the
 *  only device allocation the plan owns that is not a layer, so it is the first
 *  thing a measured overshoot takes back. Null when there is nothing left to
 *  cut, which means the overshoot has to come from -ngl. */
export function shrinkMoeCache(pl: Placement, over: number): Placement | null {
  const cache = pl.moeCacheMib ?? 0;
  const next = Math.max(0, cache - Math.ceil(over / MiB));
  return next < cache ? { ...pl, moeCacheMib: next } : null;
}
