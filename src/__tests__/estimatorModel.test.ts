// Unit tests for the pure parts of src/main/estimator/model.ts: the placement
// rule llama.cpp uses (reproduced from its source, checked against --fit-print),
// the byte tables the memory bar subdivides, and the MoE decision itself.
//
// The MoE decision is a function of probe measurements, so its fixtures are
// measurements — there is nothing here to predict a device with.
import {
  decideMoePlacement,
  effectivePlacement,
  firstGpuLayer,
  LAZY_TENSOR,
  lazyBytes,
  moeCacheFloorBytes,
  shrinkMoeCache,
  weightBreakdown,
  weightSplit,
  type ModelClass,
  type Placement,
} from '../main/estimator/model';

const B = 1000; // synthetic layer total
const EX = 600; // synthetic expert bytes per layer
const FF = 200; // synthetic dense FFN bytes per layer
const MiB = 1024 * 1024;
const GiB = 1024 ** 3;

// 8 blocks, the last one a native draft layer: n_layer_all = 8, baseLayers = 7,
// full offload is -ngl 9 (the +1 output slot).
function moeModel(overrides: Partial<ModelClass> = {}): ModelClass {
  const nLayerAll = 8;
  const baseLayers = 7;
  const layerBytes = Array(nLayerAll).fill(B);
  const expertBytes = Array(nLayerAll).fill(EX);
  const denseFfnBytes = Array(nLayerAll).fill(FF);
  return {
    kind: 'moe',
    arch: 'qwen2moe',
    name: 'synthetic-moe',
    nLayerAll,
    baseLayers,
    draftLayers: 1,
    fullOffloadNgl: 9,
    layerBytes,
    expertBytes,
    denseFfnBytes,
    draftBytes: B,
    inputBytes: 1000,
    outputRealBytes: 500,
    outputDeviceBytes: 500,
    loadedBytes: baseLayers * B + 1000 + 500,
    fileWeightBytes: nLayerAll * B + 1000 + 500,
    expertCount: 8,
    expertUsed: 2,
    swaWindow: null,
    fullAttentionInterval: null,
    ssm: false,
    modelMaxContext: 32768,
    lazyTensors: [],
    ...overrides,
  };
}

function denseModel(): ModelClass {
  return moeModel({
    kind: 'dense',
    arch: 'qwen2',
    name: 'synthetic-dense',
    expertBytes: Array(8).fill(0),
    expertCount: 0,
    expertUsed: 0,
  });
}

describe('-ngl reproduces llama.cpp last-N placement', () => {
  const model = moeModel();

  it('counts from the end: i_gpu_start = n_layer_all + 1 - ngl', () => {
    expect(firstGpuLayer(model, 1)).toBe(8); // only the output slot
    expect(firstGpuLayer(model, 2)).toBe(7); // output slot + last block
    expect(firstGpuLayer(model, 8)).toBe(1);
    expect(firstGpuLayer(model, 9)).toBe(0); // fullOffloadNgl
    expect(firstGpuLayer(model, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('-ngl 1 puts the output tensor on the device and no block', () => {
    const ws = weightSplit(model, { ngl: 1 });
    expect(ws.gpuLayers).toBe(0);
    expect(ws.device).toBe(model.outputDeviceBytes);
  });

  it('full offload holds every loaded block plus the output copy', () => {
    const ws = weightSplit(model, { ngl: 9 });
    expect(ws.gpuLayers).toBe(7); // draft layer is never loaded
    expect(ws.device).toBe(7 * B + model.outputDeviceBytes);
    expect(ws.expertSpilled).toBe(0);
  });

  it('--n-cpu-moe spills the FIRST n layers while -ngl counts from the end', () => {
    // ngl=8 keeps blocks 1..7 on the device; nCpuMoe=2 moves blocks 0..1's
    // experts to the host — block 0 is host anyway, so only block 1's experts
    // actually leave the device (expertSpilled counts what was device-held).
    const ws = weightSplit(model, { ngl: 8, nCpuMoe: 2 });
    expect(ws.expertSpilled).toBe(EX);
    // ngl=8 = 6 base blocks + the output slot; block 1's experts leave it.
    expect(ws.device).toBe(6 * B - EX + model.outputDeviceBytes);
  });

  it('the expert cache is capped at the spill and inert without one', () => {
    const spilled = weightSplit(model, { ngl: 8, nCpuMoe: 2, moeCacheMib: 1 });
    // 1 MiB requested, 600 bytes actually spilled: llama.cpp caps the cache.
    expect(spilled.cacheBytes).toBe(EX);
    expect(spilled.cacheDeviceBytes).toBe(EX); // cache is device-resident
    const noSpill = weightSplit(model, { ngl: 8, moeCacheMib: 1 });
    expect(noSpill.cacheBytes).toBe(0);
  });
});
describe('weightBreakdown subdivides weightSplit without inventing bytes', () => {
  const model = moeModel();
  const parts = (pl: Placement) => {
    const b = weightBreakdown(model, pl);
    return {
      b,
      device: b.attnDevice + b.expertsDevice + b.ffnDevice + b.outputDevice,
      host:
        b.embeddingHost +
        b.layersHost +
        b.expertsHost +
        b.ffnHost +
        b.otherHost,
    };
  };

  it('full offload: attention stays put, experts and FFN are the movable mass', () => {
    const { b, device, host } = parts({ ngl: 9 });
    // 7 blocks: 200 of attention each, plus the output slot's device copy.
    expect(b.attnDevice).toBe(7 * (B - EX - FF));
    expect(b.expertsDevice).toBe(7 * EX);
    expect(b.ffnDevice).toBe(7 * FF);
    expect(b.outputDevice).toBe(model.outputDeviceBytes);
    expect(b.layersHost).toBe(0);
    expect(b.embeddingHost).toBe(model.inputBytes);
    // The identity the memory bar depends on.
    expect(device).toBe(weightSplit(model, { ngl: 9 }).device);
    expect(host).toBe(weightSplit(model, { ngl: 9 }).host);
    expect(b.otherHost).toBe(0);
  });

  it('a partial spill splits one layer across both sides', () => {
    // ngl=4 -> blocks 5..6 on the device; nCpuMoe/nCpuFfn=6 spill block 5's
    // experts and FFN only, so block 5 is host-held in part and device-held in
    // part while block 6 stays whole on the device.
    const pl: Placement = { ngl: 4, nCpuMoe: 6, nCpuFfn: 6 };
    const { b, device, host } = parts(pl);
    expect(b.layersHost).toBe(5 * B);
    expect(b.attnDevice).toBe(2 * (B - EX - FF));
    expect(b.expertsDevice).toBe(EX); // block 6 only
    expect(b.ffnDevice).toBe(FF);
    expect(b.expertsHost).toBe(EX); // block 5 only
    expect(b.ffnHost).toBe(FF);
    expect(device).toBe(weightSplit(model, pl).device);
    expect(host).toBe(weightSplit(model, pl).host);
  });

  it('-ngl 0 leaves nothing on the device, output tensor included', () => {
    const { b, device, host } = parts({ ngl: 0 });
    expect(b.attnDevice).toBe(0);
    expect(b.outputDevice).toBe(0);
    expect(b.layersHost).toBe(7 * B);
    // With no device copy, the file's output tensor is host memory too.
    expect(b.embeddingHost).toBe(model.inputBytes + model.outputRealBytes);
    expect(device).toBe(0);
    expect(host).toBe(weightSplit(model, { ngl: 0 }).host);
  });

  it('a spill below the -ngl cut moves nothing', () => {
    // ngl=2 keeps only the output slot: --cpu-moe has no device experts to move,
    // which is why the optimizer starts spilling at i_gpu_start.
    const pl: Placement = { ngl: 2, cpuMoeAll: true, nCpuFfn: 7 };
    const { b, device, host } = parts(pl);
    expect(b.expertsHost).toBe(0);
    expect(b.ffnHost).toBe(0);
    expect(b.layersHost).toBe(7 * B);
    expect(device).toBe(model.outputDeviceBytes);
    expect(host).toBe(weightSplit(model, pl).host);
  });

  it('a tied file still pays for the second device copy', () => {
    // output.weight is absent from the file; llama.cpp points the output slot at
    // a device copy of the embedding instead.
    const tied = moeModel({
      outputRealBytes: 0,
      loadedBytes: 7 * B + 1000,
    });
    const b = weightBreakdown(tied, { ngl: 9 });
    expect(b.outputDevice).toBe(tied.outputDeviceBytes);
    expect(b.embeddingHost).toBe(tied.inputBytes);
    expect(b.attnDevice + b.expertsDevice + b.ffnDevice + b.outputDevice).toBe(
      weightSplit(tied, { ngl: 9 }).device,
    );
    expect(b.embeddingHost + b.layersHost + b.otherHost).toBe(
      weightSplit(tied, { ngl: 9 }).host,
    );
  });

  it('tensors outside every named group are reported, not dropped', () => {
    // A file with 300 bytes of tensors that belong to no layer and to neither
    // the embedding nor the output slot: the residual guard has to show them,
    // or the RAM bar's slices would sum to less than the measured column.
    const extra = moeModel({ loadedBytes: 7 * B + 1000 + 500 + 300 });
    const b = weightBreakdown(extra, { ngl: 9 });
    expect(b.otherHost).toBe(300);
    expect(b.embeddingHost + b.layersHost + b.otherHost).toBe(
      weightSplit(extra, { ngl: 9 }).host,
    );
  });
});

describe('--lazy-mode moves the streamed tables out of the embedding slice', () => {
  // llama.cpp's lazy_read::add decides per tensor, and its `auto` floor is
  // "larger than 4 GiB", so a 4 GiB table is the boundary case.
  const GiBm = 1024 ** 3;
  const ple = moeModel({ lazyTensors: [3 * GiBm, 4 * GiBm, 5 * GiBm] });

  it('off never streams, auto takes only the tensors over 4 GiB, on takes all', () => {
    expect(lazyBytes(ple, 'off')).toBe(0);
    expect(lazyBytes(ple, 'auto')).toBe(5 * GiBm);
    expect(lazyBytes(ple, 'on')).toBe(12 * GiBm);
    // Unset means llama.cpp's own default.
    expect(lazyBytes(ple)).toBe(lazyBytes(ple, 'auto'));
    expect(lazyBytes(ple, undefined)).toBe(lazyBytes(ple, 'auto'));
  });

  it('a model with no such tensor streams nothing, whatever the mode', () => {
    const plain = moeModel();
    expect(lazyBytes(plain, 'on')).toBe(0);
  });

  it('the name test picks the embedding tables and not the projections beside them', () => {
    // Matched by name, not by architecture: these are the tensor names llama.cpp
    // marks lazy, and the projections next to them are far too small to stream.
    ['per_layer_token_embd.weight', 'per_layer_embd_out.weight'].forEach((n) =>
      expect(LAZY_TENSOR.test(n)).toBe(true),
    );
    [
      'per_layer_proj.weight',
      'per_layer_proj_norm.weight',
      'per_layer_model_proj.weight',
      'token_embd.weight',
      'blk.0.ffn_down_exps.weight',
    ].forEach((n) => expect(LAZY_TENSOR.test(n)).toBe(false));
  });

  it('the host split keeps the resident embedding and the streamed table apart', () => {
    // inputBytes is 1000 in the fixture; the streamed tables ride inside it, so
    // they come back out of embeddingHost and become lazyHost.
    const m = moeModel({ inputBytes: 1000, lazyTensors: [600] });
    const on = weightBreakdown(m, { ngl: 9, lazyMode: 'on' });
    expect(on.lazyHost).toBe(600);
    expect(on.embeddingHost).toBe(400);
    // Nothing invented, nothing lost: the parts still sum to the host column.
    expect(on.embeddingHost + on.lazyHost + on.layersHost + on.otherHost).toBe(
      weightSplit(m, { ngl: 9, lazyMode: 'on' }).host,
    );
    const off = weightBreakdown(m, { ngl: 9, lazyMode: 'off' });
    expect(off.lazyHost).toBe(0);
    expect(off.embeddingHost).toBe(1000);
  });
});

describe('effectivePlacement resolves the placement a launch uses', () => {
  const plan = {
    ngl: 4,
    cpuMoe: false,
    nCpuMoe: 6,
    nCpuFfn: 3,
    moeCacheMib: 100,
  };
  const fields = {
    cpuMoe: false,
    nCpuMoe: 2,
    nCpuFfn: 1,
    moeCacheMib: 5,
    optimizerPlan: plan,
  };

  it('the plan wins while its -ngl is the one in use', () => {
    expect(effectivePlacement(fields, 4)).toEqual({
      ngl: 4,
      cpuMoeAll: false,
      nCpuMoe: 6,
      nCpuFfn: 3,
      moeCacheMib: 100,
    });
  });

  it('the user fields win once -ngl moves away from the solved one', () => {
    // Dragging the slider past the plan is a manual placement again: the plan's
    // spill and cache were solved for a different -ngl and would misprice it.
    expect(effectivePlacement(fields, 2)).toEqual({
      ngl: 2,
      cpuMoeAll: false,
      nCpuMoe: 2,
      nCpuFfn: 1,
      moeCacheMib: 5,
    });
  });

  it('without a plan the profile fields are the placement', () => {
    expect(effectivePlacement({ ...fields, optimizerPlan: null }, 4)).toEqual({
      ngl: 4,
      cpuMoeAll: false,
      nCpuMoe: 2,
      nCpuFfn: 1,
      moeCacheMib: 5,
    });
  });

  it('--cpu-moe travels with the plan that chose it', () => {
    expect(
      effectivePlacement(
        { ...fields, cpuMoe: false, optimizerPlan: { ...plan, cpuMoe: true } },
        4,
      ).cpuMoeAll,
    ).toBe(true);
  });
});
/** Shaped like merged-Qwen3.8-Flash-Next-UD-IQ3_XXS: 48 layers of 1,032 MiB of
 *  which 963 MiB are experts (45.1 GiB of them), 512 experts with 10 active per
 *  token, and a 27.31 GiB input embedding that is always in host memory. The
 *  numbers are the file's, because the regression this models only appears at
 *  this scale: --cpu-moe needs more system RAM than the machine has. */
function flashNextLike(): ModelClass {
  const layers = 48;
  const layer = 1032 * MiB;
  const expert = 963 * MiB;
  const input = Math.round(27.31 * GiB);
  return moeModel({
    arch: 'qwen4exp',
    name: 'Qwen3.8 Flash Next',
    nLayerAll: layers,
    baseLayers: layers,
    draftLayers: 0,
    fullOffloadNgl: 49,
    layerBytes: Array(layers).fill(layer),
    expertBytes: Array(layers).fill(expert),
    denseFfnBytes: Array(layers).fill(layer - expert),
    draftBytes: 0,
    inputBytes: input,
    outputRealBytes: 0,
    outputDeviceBytes: 0,
    loadedBytes: layers * layer + input,
    fileWeightBytes: layers * layer + input,
    expertCount: 512,
    expertUsed: 10,
    modelMaxContext: 262144,
  });
}
describe('moeCacheFloorBytes', () => {
  it('is one token of experts plus the spare slot llama.cpp keeps', () => {
    // 600 bytes of experts over 8 experts = 75 bytes a slot; 2 activated per
    // token plus the bank's spare.
    expect(moeCacheFloorBytes(moeModel())).toBe(3 * 75);
  });

  it('is zero for a model with no experts to cache', () => {
    expect(moeCacheFloorBytes(denseModel())).toBe(0);
  });
});

describe('decideMoePlacement: pin the experts, or move all of them', () => {
  const model = flashNextLike();
  const full = model.fullOffloadNgl;
  const floor = moeCacheFloorBytes(model);

  it('fits means fit: pinned, and no cache to talk about', () => {
    // The whole first half of the rule is one measurement. A pinned plan that
    // measures under budget gets no --cpu-moe and no pool, however much room is
    // left over.
    const pl = decideMoePlacement({
      ngl: full,
      pinnedOver: -480 * MiB,
      cacheHeadroom: 19302 * MiB,
      cacheFloor: floor,
    });
    expect(pl).toEqual({ ngl: full });
  });

  it('a pinned plan at exactly zero headroom still counts as fitting', () => {
    expect(
      decideMoePlacement({
        ngl: full,
        pinnedOver: 0,
        cacheHeadroom: 0,
        cacheFloor: floor,
      }),
    ).toEqual({ ngl: full });
  });

  it('does not fit means every expert to host RAM, and the pool takes the rest', () => {
    // The Flash-Next case: 45 GiB of experts against 23.3 GiB of usable VRAM.
    // --cpu-moe, -ngl untouched, and the whole leftover device budget becomes
    // the expert pool.
    const pl = decideMoePlacement({
      ngl: full,
      pinnedOver: 22 * GiB,
      cacheHeadroom: 19302 * MiB,
      cacheFloor: floor,
    });
    expect(pl.cpuMoeAll).toBe(true);
    expect(pl.ngl).toBe(full);
    expect(pl.moeCacheMib).toBe(19302);
    expect(pl.nCpuMoe).toBeUndefined(); // --n-cpu-moe is not in the rule
  });

  it('there is no middle: no partial spill, no -ngl bargain', () => {
    // Whatever the overshoot, the answer is the same two placements. A partial
    // spill pins most experts and starves the pool; that is the failure this
    // rule exists to prevent, so it must not be reachable at any size.
    [1, MiB, 22 * GiB, 900 * GiB].forEach((over) => {
      const pl = decideMoePlacement({
        ngl: full,
        pinnedOver: over,
        cacheHeadroom: 4 * GiB,
        cacheFloor: floor,
      });
      expect(pl.cpuMoeAll).toBe(true);
      expect(pl.nCpuMoe).toBeUndefined();
      expect(pl.ngl).toBe(full);
    });
  });

  it('host memory is not an input: spilling to the page file is allowed', () => {
    // --cpu-moe on this file wants ~74 GiB of host and the machine has 63.4.
    // The rule never sees that number, so it cannot refuse on it; the caller
    // reports the overflow instead.
    const pl = decideMoePlacement({
      ngl: full,
      pinnedOver: 22 * GiB,
      cacheHeadroom: 19302 * MiB,
      cacheFloor: floor,
    });
    expect(pl.cpuMoeAll).toBe(true);
    expect(pl.moeCacheMib).toBe(19302);
  });

  it('a pool that cannot hold one token does not exist: no cache, still spilled', () => {
    // llama.cpp exits when the pool cannot hold one token's experts, so below
    // the floor the honest answer is no pool at all — not a smaller one, and
    // never a return to the pinned plan that just measured over budget.
    const pl = decideMoePlacement({
      ngl: full,
      pinnedOver: 22 * GiB,
      cacheHeadroom: floor - 1,
      cacheFloor: floor,
    });
    expect(pl.cpuMoeAll).toBe(true);
    expect(pl.moeCacheMib).toBe(0);
  });

  it('a pool exactly at the floor is funded', () => {
    // The flag is MiB-granular, so the pool has to be rounded up to the floor,
    // not down to it: 20 MiB of headroom against a 20.7 MiB floor is no pool.
    const floorMib = Math.ceil(floor / MiB);
    const pl = decideMoePlacement({
      ngl: full,
      pinnedOver: 22 * GiB,
      cacheHeadroom: floorMib * MiB,
      cacheFloor: floor,
    });
    expect(pl.moeCacheMib).toBe(floorMib);
  });

  it('a cache the user set is a cap on the pool, not its size', () => {
    const capped = decideMoePlacement({
      ngl: full,
      pinnedOver: 22 * GiB,
      cacheHeadroom: 19302 * MiB,
      cacheFloor: floor,
      maxCacheMib: 512,
    });
    expect(capped.moeCacheMib).toBe(512);
    // The cap cannot push the pool under the floor and call that a plan: a
    // capped-out pool is no pool.
    const tiny = decideMoePlacement({
      ngl: full,
      pinnedOver: 22 * GiB,
      cacheHeadroom: 19302 * MiB,
      cacheFloor: floor,
      maxCacheMib: 1,
    });
    expect(tiny.moeCacheMib).toBe(0);
    expect(tiny.cpuMoeAll).toBe(true);
  });

  it('a spilled plan that measured over budget gets no negative pool', () => {
    // headroom is the negative of the overshoot, so a plan that does not fit
    // even spilled funds nothing rather than a cache of -40 MiB.
    const pl = decideMoePlacement({
      ngl: 40,
      pinnedOver: 22 * GiB,
      cacheHeadroom: -40 * MiB,
      cacheFloor: floor,
    });
    expect(pl.cpuMoeAll).toBe(true);
    expect(pl.moeCacheMib).toBe(0);
    expect(pl.ngl).toBe(40);
  });
});

describe('shrinkMoeCache takes a measured overshoot back out of the pool', () => {
  const pl: Placement = { ngl: 49, cpuMoeAll: true, moeCacheMib: 19302 };

  it('cuts the pool by what the probe says is over', () => {
    expect(shrinkMoeCache(pl, 1 * MiB)!.moeCacheMib).toBe(19301);
    expect(shrinkMoeCache(pl, 300 * MiB)!.moeCacheMib).toBe(19002);
  });

  it('never goes below zero and never invents a cut', () => {
    expect(shrinkMoeCache(pl, 30 * GiB)!.moeCacheMib).toBe(0);
    expect(shrinkMoeCache({ ...pl, moeCacheMib: 0 }, 5 * MiB)).toBeNull();
    expect(shrinkMoeCache({ ngl: 49, cpuMoeAll: true }, 5 * MiB)).toBeNull();
  });
});
