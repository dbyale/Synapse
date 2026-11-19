// Vision projector accounting.
//
// The projector matters to the optimizer for two reasons, and neither of them
// can be measured: llama-fit-params rejects --mmproj outright (it is not a
// common_params field it knows), so no probe ever includes the projector, and
// the server refuses to start when the projector's projection_dim disagrees
// with the text model. Everything here therefore comes from the projector's own
// GGUF: its tensor table gives exact weight bytes, its `clip.vision.*` metadata
// gives the graph the encoder has to build.
//
// Split of accuracy, stated plainly:
//   * weight bytes              exact (summed tensor sizes)
//   * tokens an image consumes  exact for the tile geometry the metadata
//                               describes, which is what --image-*-tokens bound
//   * encoder compute buffers   a reserve, not a measurement (see activation)
import { ggufArchNumber, readGgufInfoCached, type GgufInfo } from './gguf';

export const MiB = 1024 * 1024;

export interface VisionGeometry {
  /** Encoder hidden size (`clip.vision.embedding_length`). */
  hidden: number;
  /** Encoder FFN width (`clip.vision.feed_forward_length`). */
  ffn: number;
  /** Encoder attention heads. */
  heads: number;
  /** Encoder layers. */
  nLayers: number;
  /** Native tile edge in pixels. */
  imageSize: number;
  /** Patch edge in pixels. */
  patchSize: number;
  /** Patch-merge factor (2 for Qwen-VL style projectors, 1 otherwise). */
  mergeSize: number;
  /** Output width, which must equal the text model's embedding length. */
  projectionDim: number;
}

export interface MmprojInfo {
  path: string;
  /** Sum of every tensor in the projector: exact. */
  weightBytes: number;
  geometry: VisionGeometry | null;
  /** Patch tokens one image occupies in the encoder graph. */
  patchTokens: number;
  /** Text-model tokens one image costs the KV cache. */
  tokensPerImage: number;
  /** True when the projector and the text model cannot be used together. */
  dimMismatchWith?: { textEmbeddingLength: number } | null;
}

/** Reads a projector file. Cheap: projectors are a few hundred MB of metadata
 *  plus tensors, and only the header is touched. */
export async function readMmprojInfo(path: string): Promise<MmprojInfo> {
  const info: GgufInfo = await readGgufInfoCached(path);
  const hidden = ggufArchNumber(info, 'vision.embedding_length') ?? 0;
  const ffn = ggufArchNumber(info, 'vision.feed_forward_length') ?? 0;
  const heads =
    ggufArchNumber(info, 'vision.attention.head_count') ?? 0;
  const nLayers = ggufArchNumber(info, 'vision.block_count') ?? 0;
  const imageSize = ggufArchNumber(info, 'vision.image_size') ?? 0;
  const patchSize = ggufArchNumber(info, 'vision.patch_size') ?? 0;
  const mergeSize = Math.max(1, ggufArchNumber(info, 'vision.spatial_merge_size') ?? 1);
  const projectionDim = ggufArchNumber(info, 'vision.projection_dim') ?? 0;

  const geometry: VisionGeometry | null =
    hidden > 0 && imageSize > 0 && patchSize > 0
      ? { hidden, ffn, heads, nLayers, imageSize, patchSize, mergeSize, projectionDim }
      : null;

  const patchTokens =
    geometry !== null
      ? Math.round((imageSize / patchSize) * (imageSize / patchSize))
      : 0;

  return {
    path,
    weightBytes: info.weightBytes,
    geometry,
    patchTokens,
    tokensPerImage:
      patchTokens > 0 ? Math.round(patchTokens / (mergeSize * mergeSize)) : 0,
    dimMismatchWith: null,
  };
}

/** Compares the projector's output width against the text model. llama.cpp
 *  aborts on a mismatch, so a plan must not be built for such a pair. */
export function checkProjectionDim(
  mmproj: MmprojInfo,
  textEmbeddingLength: number,
): string | null {
  const dim = mmproj.geometry?.projectionDim ?? 0;
  if (dim === 0 || textEmbeddingLength === 0) return null;
  if (dim === textEmbeddingLength) return null;
  return `Projector projects to ${dim} but the text model's embedding length is ${textEmbeddingLength}.`;
}

export interface MmprojOptions {
  /** profile.mmprojOffload === true: the encoder runs on the GPU. */
  offload: boolean;
  /** Images to reserve room for. */
  images?: number;
  /** profile.imageMaxTokens: caps the tokens (and therefore the graph) per image. */
  imageMaxTokens?: number;
  /** profile.imageMinTokens. */
  imageMinTokens?: number;
  /** llama.cpp's --flash-attn: without it the encoder materialises an
   *  nPatch² attention matrix, which dwarfs every other term. */
  flashAttn?: boolean;
}

export interface MmprojReserve {
  weightBytes: number;
  activationBytes: number;
  /** Bytes to hold on the GPU. 0 when the encoder stays on the host. */
  deviceBytes: number;
  /** Bytes to hold in RAM (the host always pays unless the encoder is offloaded). */
  hostBytes: number;
  /** KV-cache tokens the reserved images consume, to be subtracted from ctx. */
  ctxTokens: number;
  images: number;
  tokensPerImage: number;
}

/** Ceiling for the activation reserve. The formula below is a bound rather than
 *  a measurement; without a cap, a 1536² tile projector with flash attention
 *  off would ask for gigabytes of "compute buffer" and dominate every decision
 *  the optimizer makes. */
const MAX_ACTIVATION_MIB = 768;

/**
 * What the projector needs alongside the text model.
 *
 * The encoder graph is built once and its buffers are reused across layers, so
 * the reserve is a single layer's peak, with 1.5x headroom for the merger and
 * the deepstack tensors some archs keep alive across all layers.
 */
export function mmprojReserve(
  mmproj: MmprojInfo,
  opts: MmprojOptions,
): MmprojReserve {
  const images = Math.max(0, Math.floor(opts.images ?? 1));
  const g = mmproj.geometry;
  // A tile's patch count, clamped by the user's token limits when they set
  // them: --image-max-tokens makes llama.cpp downscale, so the graph shrinks.
  let patches = mmproj.patchTokens;
  const tokensPerImage = tokensFor(mmproj, opts);
  if (g !== null && tokensPerImage > 0) {
    patches = tokensPerImage * g.mergeSize * g.mergeSize;
  }
  const perImage = patches > 0 ? patches : 0;

  let activationBytes = 0;
  if (g !== null && perImage > 0) {
    const attn = opts.flashAttn
      ? 0
      : // nPatch x nPatch scores, one head at a time, in f32.
        g.heads * perImage * perImage * 4;
    const ffnBytes = perImage * g.ffn * 4; // two f16 intermediates
    const hiddenBytes = perImage * g.hidden * 2 * 8; // q,k,v,out,ffn,add,norm
    const raw = (attn + ffnBytes + hiddenBytes) * 1.5;
    activationBytes = Math.min(raw, MAX_ACTIVATION_MIB * MiB);
  }

  const weightBytes = images > 0 ? mmproj.weightBytes : 0;
  const total = weightBytes + activationBytes;
  return {
    weightBytes,
    activationBytes,
    deviceBytes: opts.offload ? total : 0,
    // --no-mmproj-offload keeps the encoder, and every buffer it builds, in
    // system RAM; an offloaded encoder still stages the image through it.
    hostBytes: opts.offload ? Math.round(activationBytes * 0.25) : total,
    ctxTokens: tokensPerImage * images,
    images,
    tokensPerImage,
  };
}

function tokensFor(mmproj: MmprojInfo, opts: MmprojOptions): number {
  const native = mmproj.tokensPerImage;
  if (native === 0) return 0;
  const max = opts.imageMaxTokens && opts.imageMaxTokens > 0 ? opts.imageMaxTokens : Infinity;
  const min = opts.imageMinTokens && opts.imageMinTokens > 0 ? opts.imageMinTokens : 1;
  return Math.max(min, Math.min(native, max));
}
