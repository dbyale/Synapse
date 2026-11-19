// GGUF metadata + tensor-info-table reader.
//
// The optimizer needs more than block_count/context_length: it needs the
// weight bytes of every layer and of every layer's MoE expert tensors,
// because the offloading decisions are made per layer (-ngl cuts at a layer
// boundary, --n-cpu-moe spills the expert tensors of the first N layers).
// Model size divided by layer count is not a substitute: in a real MoE file
// the expert bytes per layer vary by ~2x between the first and last layers.
//
// Tensor sizes come from the tensor-info table's own `offset` fields rather
// than a dtype size table. GGUF stores tensors contiguously after the
// metadata, each padded up to `general.alignment`, so the delta between two
// consecutive offsets is that tensor's size rounded up to the alignment. That
// is exact to within one alignment step (< 32 B per tensor) and needs no
// knowledge of the quantization formats — deliberate, because Synapse pins
// llama.cpp builds and a hardcoded bytes-per-weight table silently mis-sizes
// every new format that lands.
import fs from 'fs';
import path from 'path';

const GGUF_MAGIC = 'GGUF';
const MiB = 1024 * 1024;
const CHUNK = 1024 * 1024;
// Ceiling for metadata + tensor-info table. A 200k-token vocab plus a 20k
// tensor MoE table is a few tens of MB; anything past this is a file we would
// rather refuse than parse.
const MAX_HEADER_BYTES = 192 * MiB;
const DEFAULT_ALIGNMENT = 32;
// Largest single string we will materialise (chat templates are the biggest
// real case, and they are kilobytes, not megabytes).
const MAX_STR = 32 * MiB;
// KV keys whose values are large and never interesting to the optimizer. They
// are skipped structurally instead of being materialised.
const SKIP_VALUE_KEYS = /^(tokenizer|eval)\./;


// Fixed-size GGUF scalar type ids. Array payloads are read element-wise with
// this table; strings (8) and arrays (9) are handled separately.
const SCALAR_SIZE: Record<number, number> = {
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

export type GgufScalar = number | boolean;
export type GgufValue = GgufScalar | string | (GgufScalar | string)[];

export interface GgufTensor {
  /** Full tensor name, e.g. "blk.7.ffn_up_exps.weight". */
  name: string;
  dims: number[];
  /** ggml type id (f32=0, f16=1, bf16=2, q4_0=8, ...). Left uninterpreted. */
  dtype: number;
  /** Element count (product of dims). */
  nElements: number;
  /** Offset within the file's data section. */
  offset: number;
  /** Size in bytes, alignment-padded, from the offset delta. */
  bytes: number;
}

export interface GgufInfo {
  path: string;
  fileSize: number;
  ggufVersion: number;
  arch: string;
  /** `<arch>.*` and `general.*` metadata actually present in the file. */
  kv: Map<string, GgufValue>;
  /** Empty when read with `{ tensors: false }`. */
  tensors: GgufTensor[];
  /** Sum of every tensor's padded bytes. For a split model this is the whole
   *  model's bytes, because the parts' tables are read together. */
  weightBytes: number;
  alignment: number;
  /** True when this file's tensor table describes bytes the file does not hold
   *  and the file carries no `split.count` — a byte-chunk split, which llama.cpp
   *  refuses to load ("tensor data is not within the file bounds"). A
   *  llama.cpp split (`split.count > 1`) is NOT flagged: its parts are read
   *  together and load fine. */
  splitTable: boolean;
  /** `split.count`: >1 when this GGUF is one part of a llama.cpp split. */
  splitCount: number;
  /** `split.no`, 0-based: which part this info was read from. */
  splitNo: number;
  /** `true` when the tensor table was assembled from every part on disk. */
  splitAssembled: boolean;
  /** `true` when the tensor-info table was parsed. */
  hasTensors: boolean;
}

export interface GgufReadOptions {
  /** Parse the tensor-info table. Default true; false is the cheap path. */
  tensors?: boolean;
}

type FileHandle = Awaited<ReturnType<typeof fs.promises.open>>;

/** Streaming cursor over a GGUF header. Only the window being parsed is kept
 *  in memory, so a multi-GB model never costs more than its metadata. */
class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private p = 0;
  private filePos = 0;

  constructor(
    private fh: FileHandle,
    private size: number,
  ) {}

  /** Absolute file position of the next unread byte. */
  at(): number {
    return this.filePos - (this.buf.length - this.p);
  }

  /** Ensures `n` bytes are available in the window. Reads always ask for a
   *  whole chunk: metadata is a dense sequence of tiny fields, and satisfying
   *  each one with its own read turns a 30 MB header into hundreds of
   *  thousands of syscalls (measured: 20 s vs 0.3 s on a real vocab). */
  async need(n: number): Promise<void> {
    while (this.buf.length - this.p < n) {
      if (this.filePos >= this.size) throw new Error('Unexpected EOF in GGUF.');
      if (this.at() >= MAX_HEADER_BYTES) {
        throw new Error('GGUF metadata exceeds the supported size.');
      }
      const toRead = Math.min(
        Math.max(CHUNK, n),
        this.size - this.filePos,
        // Bounded window: the consumed prefix is dropped on every growth, so a
        // large read is only ever in flight by itself.
        MAX_HEADER_BYTES,
      );
      const chunk = Buffer.alloc(toRead);
      const { bytesRead } = await this.fh.read(chunk, 0, toRead, this.filePos);
      if (bytesRead === 0) break;
      this.filePos += bytesRead;
      // subarray is a view, so dropping the consumed prefix costs nothing.
      this.buf = Buffer.concat([this.buf.subarray(this.p), chunk]);
      this.p = 0;
    }
    if (this.buf.length - this.p < n) throw new Error('Unexpected EOF in GGUF.');
  }

  private u8(): number {
    const v = this.buf.readUInt8(this.p);
    this.p += 1;
    return v;
  }

  private i8(): number {
    const v = this.buf.readInt8(this.p);
    this.p += 1;
    return v;
  }

  private u16(): number {
    const v = this.buf.readUInt16LE(this.p);
    this.p += 2;
    return v;
  }

  private i16(): number {
    const v = this.buf.readInt16LE(this.p);
    this.p += 2;
    return v;
  }

  u32(): number {
    const v = this.buf.readUInt32LE(this.p);
    this.p += 4;
    return v;
  }

  /** Reads `n` bytes as ASCII without interpreting them (magic header). */
  raw(n: number): string {
    const s = this.buf.toString('ascii', this.p, this.p + n);
    this.p += n;
    return s;
  }

  private i32(): number {
    const v = this.buf.readInt32LE(this.p);
    this.p += 4;
    return v;
  }

  private f32(): number {
    const v = this.buf.readFloatLE(this.p);
    this.p += 4;
    return v;
  }

  u64(): number {
    const v = Number(this.buf.readBigUInt64LE(this.p));
    this.p += 8;
    return v;
  }

  private f64(): number {
    const v = this.buf.readDoubleLE(this.p);
    this.p += 8;
    return v;
  }

  private scalar(type: number): GgufScalar {
    switch (type) {
      case 0:
        return this.u8();
      case 1:
        return this.i8();
      case 2:
        return this.u16();
      case 3:
        return this.i16();
      case 4:
        return this.u32();
      case 5:
        return this.i32();
      case 6:
        return this.f32();
      case 7:
        return this.u8() !== 0;
      case 10:
      case 11:
        return this.u64();
      case 12:
        return this.f64();
      default:
        throw new Error(`Unsupported GGUF scalar type ${type}.`);
    }
  }

  async str(): Promise<string> {
    await this.need(8);
    const len = this.u64();
    if (len > MAX_STR) throw new Error('Implausible GGUF string length.');
    await this.need(len);
    const s = this.buf.toString('utf8', this.p, this.p + len);
    this.p += len;
    return s;
  }

  /** Advances past `n` bytes without materialising them: whatever is buffered
   *  is dropped, and any remainder is seeked over. */
  async skip(n: number): Promise<void> {
    let left = n;
    for (;;) {
      const avail = this.buf.length - this.p;
      if (avail >= left) {
        this.p += left;
        return;
      }
      left -= avail;
      this.p += avail;
      if (left > CHUNK) {
        // Pure seek: no reason to read what we are throwing away.
        if (this.filePos + left > this.size) {
          throw new Error('Unexpected EOF in GGUF.');
        }
        this.filePos += left;
        this.buf = Buffer.alloc(0);
        this.p = 0;
        return;
      }
      await this.need(left);
    }
  }

  /** Walks past `count` GGUF strings, materialising at most `keepN` of them: a
   *  250k-entry vocab or merges array is otherwise a quarter million string
   *  allocations that the optimizer immediately throws away. */
  private async strArray(
    count: number,
    keepN: number,
  ): Promise<string[] | undefined> {
    const keep = Math.min(count, keepN);
    const out: string[] | undefined = keep > 0 ? [] : undefined;
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < count; i += 1) {
      await this.need(8);
      const len = this.u64();
      if (len > MAX_STR) throw new Error('Implausible GGUF string length.');
      await this.need(len);
      if (i < keep) out?.push(this.buf.toString('utf8', this.p, this.p + len));
      this.p += len;
    }
    /* eslint-enable no-await-in-loop */
    return out;
  }

  /** Reads or skips one value. `keep` false skips it structurally. */
  async value(keep: boolean, depth = 0): Promise<GgufValue | undefined> {
    await this.need(4);
    const type = this.u32();
    if (type === 8) {
      const s = await this.str();
      return keep ? s : undefined;
    }
    if (type === 9) {
      await this.need(4 + 8);
      const elemType = this.u32();
      const len = this.u64();
      if (elemType === 9) {
        // Nested arrays: walk them without materialising anything.
        for (let i = 0; i < len; i += 1) await this.value(false, depth + 1);
        return undefined;
      }
      const sz = SCALAR_SIZE[elemType];
      if (elemType === 8) {
        return await this.strArray(len, keep ? 256 : 0);
      }
      if (sz === undefined) {
        throw new Error(`Unsupported GGUF array element type ${elemType}.`);
      }
      const bytes = len * sz;
      if (!keep || bytes > 4 * MiB || len > 4096) {
        await this.skip(bytes);
        return undefined;
      }
      await this.need(bytes);
      const out: GgufScalar[] = [];
      for (let i = 0; i < len; i += 1) out.push(this.scalar(elemType));
      return out;
    }
    const sz = SCALAR_SIZE[type];
    if (sz === undefined) throw new Error(`Unsupported GGUF type ${type}.`);
    await this.need(sz);
    const v = this.scalar(type);
    return keep ? v : undefined;
  }
}

/** Reads one GGUF file: its metadata and (by default) its tensor-info table.
 *  For a split model this is only one part; `readGgufInfo` assembles them. */
async function readGgufPart(
  modelPath: string,
  opts: GgufReadOptions = {},
): Promise<GgufInfo> {
  const wantTensors = opts.tensors !== false;
  const fh = await fs.promises.open(modelPath, 'r');
  try {
    const stat = await fh.stat();
    const r = new Reader(fh, stat.size);

    await r.need(4);
    const magic = r.raw(4);
    if (magic !== GGUF_MAGIC) throw new Error(`Not a GGUF file: ${modelPath}`);
    await r.need(4 + 8 + 8);
    const version = r.u32();
    if (version < 2) {
      // GGUFv1 uses 32-bit counts throughout; nothing in a Synapse library is
      // v1, and mis-parsing one would produce nonsense sizes rather than an
      // error, so it is rejected explicitly.
      throw new Error(`Unsupported GGUF version ${version} in ${modelPath}.`);
    }
    const tensorCount = r.u64();
    const nKv = r.u64();
    const dimWidth = version >= 3 ? 8 : 4;

    // GGUF KV entries are variable-length and back to back, so the walk is
    // necessarily serial.
    /* eslint-disable no-await-in-loop */
    const kv = new Map<string, GgufValue>();
    let arch = '';
    for (let i = 0; i < nKv; i += 1) {
      const key = await r.str();
      const v = await r.value(!SKIP_VALUE_KEYS.test(key));
      if (v !== undefined) kv.set(key, v);
      if (key === 'general.architecture' && typeof v === 'string') arch = v;
    }

    const alignment =
      Number(kv.get('general.alignment') ?? DEFAULT_ALIGNMENT) ||
      DEFAULT_ALIGNMENT;

    // llama-gguf-split writes these into every part. `split.no` is 0-based, and
    // each part's tensor-info table lists only the tensors whose bytes are in
    // that part — which is why a part read on its own looks like a small,
    // complete model rather than an error.
    const num = (key: string): number => {
      const v = kv.get(key);
      if (typeof v === 'number') return v;
      if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
      return 0;
    };
    const splitCount = num('split.count');
    const splitNo = num('split.no');

    const tensors: GgufTensor[] = [];
    let weightBytes = 0;
    let splitTable = false;
    if (wantTensors && tensorCount > 0) {
      const raw: {
        name: string;
        dims: number[];
        dtype: number;
        nElements: number;
        offset: number;
      }[] = [];
      for (let i = 0; i < tensorCount; i += 1) {
        const name = await r.str();
        await r.need(4);
        const nDims = r.u32();
        if (nDims > 8) throw new Error(`Implausible tensor rank ${nDims}.`);
        const dims: number[] = [];
        let nElements = 1;
        // GGUFv3 widened the per-tensor dimensions to 64 bits (v2 and earlier
        // store them as uint32). Getting this wrong desynchronises the walk by
        // 4 bytes per tensor, and because the high halves are zero the damage
        // looks like a plausible dtype/offset pair for the first tensor.
        const dimBytes = nDims * dimWidth;
        if (dimBytes > 0) await r.need(dimBytes);
        for (let d = 0; d < nDims; d += 1) {
          const dim = dimWidth === 8 ? r.u64() : r.u32();
          dims.push(dim);
          nElements *= dim;
        }
        await r.need(4 + 8);
        const dtype = r.u32();
        const offset = r.u64();
        raw.push({ name, dims, dtype, nElements, offset });
      }
      const tableEnd = r.at();

      // Bytes-per-element per dtype, as the median of the observed deltas.
      // Only needed for the last tensor of a part, which has no following
      // offset to diff against.
      const seen = new Map<number, number[]>();
      for (let i = 0; i < raw.length - 1; i += 1) {
        const delta = raw[i + 1].offset - raw[i].offset;
        if (delta <= 0 || raw[i].nElements <= 0) continue;
        const list = seen.get(raw[i].dtype) ?? [];
        list.push(delta / raw[i].nElements);
        seen.set(raw[i].dtype, list);
      }
      const bps = new Map<number, number>();
      seen.forEach((list, dtype) => {
        list.sort((a, b) => a - b);
        bps.set(dtype, list[Math.floor(list.length / 2)]);
      });

      // Data section start is the first aligned byte after the metadata. With
      // that, the final tensor's padded size is exactly "file end − offset".
      const dataStart =
        Math.ceil(tableEnd / alignment) * alignment;
      for (let i = 0; i < raw.length; i += 1) {
        const t = raw[i];
        let bytes: number;
        if (i < raw.length - 1) {
          const delta = raw[i + 1].offset - t.offset;
          bytes = delta > 0 ? delta : 0;
        } else {
          const tail = stat.size - dataStart - t.offset;
          const per = bps.get(t.dtype) ?? 0;
          const guess = per > 0 ? Math.round(t.nElements * per) : 0;
          // A plausible tail means a single-file model; a negative or wildly
          // off tail means the table describes several split parts.
          if (tail > 0 && (guess === 0 || Math.abs(tail - guess) < 64 * MiB)) {
            bytes = tail;
          } else {
            splitTable = true;
            bytes = guess;
          }
        }
        weightBytes += bytes;
        tensors.push({
          name: t.name,
          dims: t.dims,
          dtype: t.dtype,
          nElements: t.nElements,
          offset: t.offset,
          bytes,
        });
      }
      // A table whose bytes overflow the file by a lot cannot be describing
      // this part alone (split GGUF), never a single file.
      if (weightBytes > stat.size + alignment) splitTable = true;
    }
    /* eslint-enable no-await-in-loop */

    return {
      path: modelPath,
      fileSize: stat.size,
      ggufVersion: version,
      arch,
      kv,
      tensors,
      weightBytes,
      alignment,
      splitTable,
      splitCount,
      splitNo,
      splitAssembled: false,
      hasTensors: wantTensors,
    };
  } finally {
    await fh.close();
  }
}

// ── Typed accessors over the KV store ────────────────────────────────────────

export function ggufNumber(info: GgufInfo, key: string): number | undefined {
  const v = info.kv.get(key);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return undefined;
}

export function ggufNumberArray(
  info: GgufInfo,
  key: string,
): number[] | undefined {
  const v = info.kv.get(key);
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is number => typeof x === 'number');
  return out.length > 0 ? out : undefined;
}

export function ggufString(info: GgufInfo, key: string): string | undefined {
  const v = info.kv.get(key);
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

export function ggufBoolean(info: GgufInfo, key: string): boolean | undefined {
  const v = info.kv.get(key);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return undefined;
}

/** Reads `<arch>.<suffix>` then falls back to a bare `<suffix>`. */
export function ggufArchNumber(
  info: GgufInfo,
  suffix: string,
): number | undefined {
  if (info.arch) {
    const v = ggufNumber(info, `${info.arch}.${suffix}`);
    if (v !== undefined) return v;
  }
  return ggufNumber(info, suffix);
}

// ── Tensor-name classification ──────────────────────────────────────────────

// Byte-for-byte the pattern llama.cpp's fitter uses to move sparse experts
// (common/fit.cpp: "blk\\.\\d+\\.ffn_(up|down|gate_up|gate)_(ch|)exps"), which
// is also what --cpu-moe / --n-cpu-moe spill. Anything else in a layer
// (attention, norm, router, shared experts) is dense as far as those flags are
// concerned. Matching anything else here would make the byte accounting
// disagree with the server's actual placement.
export const EXPERT_TENSOR = /^blk\.(\d+)\.ffn_(?:up|down|gate_up|gate)_(?:ch|)exps/;
// The dense FFN set the same way: --n-cpu-ffn emits "blk\.N" + LLM_FFN_DENSE_REGEX
// from common/common.h, i.e. "\.ffn_(up|down|gate)\." — the trailing dot is what
// keeps expert tensors and merged gate_up tensors out of the set.
export const DENSE_FFN_TENSOR = /^blk\.(\d+)\.ffn_(?:up|down|gate)\./;
const LAYER_TENSOR = /^blk\.(\d+)\./;

export interface LayerByteTable {
  /** Padded weight bytes of every tensor named `blk.N.*`, per layer. */
  total: number[];
  /** Subset matching EXPERT_TENSOR — the bytes `--n-cpu-moe` moves. */
  expert: number[];
  /** Subset matching DENSE_FFN_TENSOR — the bytes `--n-cpu-ffn` moves. */
  denseFfn: number[];
  /** `total - expert`: what stays on-device when a layer's experts are spilled. */
  dense: number[];
  /** Sum of tensors outside any layer (token_embd, output, rope, cls...). */
  nonLayerBytes: number;
  hasExperts: boolean;
  /** Highest `blk.N` index in the table, -1 when the file has no layers. */
  maxLayer: number;
}

/** Buckets the tensor table by transformer layer. Requires the tensor table. */
export function layerBytes(info: GgufInfo): LayerByteTable {
  const total = new Map<number, number>();
  const expert = new Map<number, number>();
  const ffn = new Map<number, number>();
  let maxLayer = -1;
  let hasExperts = false;
  let nonLayerBytes = 0;
  const bump = (map: Map<number, number>, layer: number, bytes: number) => {
    map.set(layer, (map.get(layer) ?? 0) + bytes);
  };
  info.tensors.forEach((t) => {
    const e = EXPERT_TENSOR.exec(t.name);
    if (e) {
      const layer = parseInt(e[1], 10);
      if (Number.isFinite(layer)) {
        hasExperts = true;
        if (layer > maxLayer) maxLayer = layer;
        bump(expert, layer, t.bytes);
        bump(total, layer, t.bytes);
        return;
      }
    }
    const f = DENSE_FFN_TENSOR.exec(t.name);
    if (f) bump(ffn, parseInt(f[1], 10), t.bytes);
    const l = LAYER_TENSOR.exec(t.name);
    const layer = l ? parseInt(l[1], 10) : NaN;
    if (!Number.isFinite(layer)) {
      nonLayerBytes += t.bytes;
      return;
    }
    if (layer > maxLayer) maxLayer = layer;
    bump(total, layer, t.bytes);
  });
  const size = maxLayer + 1;
  const totalArr = Array.from({ length: size }, (_, i) => total.get(i) ?? 0);
  const expertArr = Array.from({ length: size }, (_, i) => expert.get(i) ?? 0);
  const ffnArr = Array.from({ length: size }, (_, i) => ffn.get(i) ?? 0);
  const denseArr = totalArr.map((v, i) => v - expertArr[i]);
  return {
    total: totalArr,
    expert: expertArr,
    denseFfn: ffnArr,
    dense: denseArr,
    nonLayerBytes,
    hasExperts,
    maxLayer,
  };
}

// ── Split GGUF ──────────────────────────────────────────────────────────────
//
// `llama-gguf-split --split` writes N files named `<base>-00001-of-0000N.gguf`.
// Each is a valid GGUF carrying the same metadata plus `split.no`/`split.count`,
// and each lists only the tensors whose bytes are in it, with offsets relative
// to its own data section. Read one part alone and it looks like a small,
// complete model — no error, just a model with a fifth of its layers.
//
// llama.cpp loads that set correctly, but only when handed the FIRST part
// ("model must be loaded with the first split"), and the numbers it then prints
// are identical to the merged file's: measured on this machine, a 3-part split
// of a 2.79 GB quant probed `CUDA0 2691 176 505 / Host 575 2 30` either way.
//
// So a split model is sized by reading every part's header — metadata once,
// tensor tables from all of them — and by handing llama.cpp part 1. Nothing is
// merged on disk: the byte tables need tensor sizes, and each part reports
// those exactly for its own tensors.

const SPLIT_PART_RE = /^(.*)-(\d{4,5})-of-(\d{4,5})\.gguf$/i;

/** The file llama.cpp must be given for a split model: part 1. The input comes
 *  back unchanged when it is not a part, already is part 1, or part 1 is not on
 *  disk — in that last case the caller's own "file not found" is the more
 *  useful error. */
export function firstSplitPart(modelPath: string): string {
  const m = path.basename(modelPath).match(SPLIT_PART_RE);
  if (!m || Number(m[2]) === 1) return modelPath;
  const first = path.join(
    path.dirname(modelPath),
    `${m[1]}-${'1'.padStart(m[2].length, '0')}-of-${m[3]}.gguf`,
  );
  return fs.existsSync(first) ? first : modelPath;
}

/** Every part of a split model in load order, named the way the first part is.
 *  Null when the file name does not follow that pattern. */
function splitPartPaths(modelPath: string, count: number): string[] | null {
  const m = path.basename(modelPath).match(SPLIT_PART_RE);
  if (!m || count < 2) return null;
  const width = m[2].length;
  const dir = path.dirname(modelPath);
  return Array.from({ length: Number(m[3]) || count }, (_, i) =>
    path.join(
      dir,
      `${m[1]}-${String(i + 1).padStart(width, '0')}-of-${m[3]}.gguf`,
    ),
  );
}

/** One GgufInfo for the whole split model: part 1's metadata, every part's
 *  tensors, and `path` pointing at the part llama.cpp has to be given. */
async function assembleSplit(
  first: GgufInfo,
  opts: GgufReadOptions,
): Promise<GgufInfo> {
  const parts = splitPartPaths(first.path, first.splitCount);
  if (!parts) {
    throw new Error(
      `${path.basename(first.path)} is part ${first.splitNo + 1} of a ` +
        `${first.splitCount}-part GGUF, but its name does not follow the ` +
        '<base>-00001-of-0000N.gguf pattern Synapse needs to find the others.',
    );
  }
  const others = parts.slice(1);
  const missing = others.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `Split GGUF is incomplete: ${missing.map((p) => path.basename(p)).join(', ')} ` +
        `${missing.length > 1 ? 'are' : 'is'} missing next to ` +
        `${path.basename(first.path)}. Download every part, or merge them ` +
        '(Synapse merges split downloads by itself).',
    );
  }
  // The siblings are read as plain parts: each carries split.no > 0, and the
  // public reader would send them back to part 1.
  const read = await Promise.all(others.map((p) => readGgufPart(p, opts)));
  const tensors = read.reduce(
    (all, p) => all.concat(p.tensors),
    [...first.tensors],
  );
  const weightBytes = read.reduce(
    (sum, p) => sum + p.weightBytes,
    first.weightBytes,
  );
  const fileSize = read.reduce((sum, p) => sum + p.fileSize, first.fileSize);
  return {
    ...first,
    path: parts[0],
    tensors,
    weightBytes,
    fileSize,
    splitAssembled: true,
  };
}

/** Reads a model as a whole: for a split GGUF, every part's tensor table is
 *  merged into one `GgufInfo` whose `path` is the part llama.cpp must be given.
 *  A single-file model is returned as-is. */
export async function readGgufInfo(
  modelPath: string,
  opts: GgufReadOptions = {},
): Promise<GgufInfo> {
  const part = await readGgufPart(modelPath, opts);
  if (part.splitCount < 2) return part;
  if (part.splitNo !== 0) {
    // llama.cpp refuses any part but the first, so sizing follows the same rule.
    const entry = firstSplitPart(modelPath);
    if (entry === modelPath) {
      throw new Error(
        `${path.basename(modelPath)} is part ${part.splitNo + 1} of a ` +
          `${part.splitCount}-part GGUF and the first part is not next to it. ` +
          'Split models only load — and can only be sized — from their first part.',
      );
    }
    return readGgufInfo(entry, opts);
  }
  return assembleSplit(part, opts);
}

// ── Cached reads ────────────────────────────────────────────────────────────

// Every optimizer decision reads the same file (classification, per-layer
// bytes, projector sizes) and the tensor table walk, while cheap, is not free
// on a 12k-tensor MoE. Keyed on identity, so an edited or re-downloaded file
// is simply a different key. Entries are bounded because the model library can
// hold hundreds of files.
const CACHE_MAX = 24;
const cache = new Map<string, Promise<GgufInfo>>();

/** `size:mtime` of the file, and of every sibling part when its name says it is
 *  part 1 of N: a re-downloaded part has to miss the cache. */
async function partsIdentity(entry: string): Promise<string> {
  const m = path.basename(entry).match(SPLIT_PART_RE);
  const files =
    m && Number(m[2]) === 1 ? splitPartPaths(entry, Number(m[3])) : null;
  const ids = await Promise.all(
    (files ?? [entry]).map((f) =>
      fs.promises.stat(f).then(
        (st) => `${st.size}:${st.mtimeMs}`,
        () => 'missing',
      ),
    ),
  );
  return ids.includes('missing') ? 'missing' : ids.join('+');
}

export async function readGgufInfoCached(
  modelPath: string,
  opts: GgufReadOptions = {},
): Promise<GgufInfo> {
  const wantTensors = opts.tensors !== false;
  // A split model is always read through its first part, so picking part 1 or
  // part 3 in the library shares one entry and one parse. resolve() keeps the
  // key stable across the mixed slash styles callers hand in.
  const entry = path.resolve(firstSplitPart(modelPath));
  let identity = 'missing';
  try {
    identity = await partsIdentity(entry);
  } catch {
    // Fall through: a failed stat still gets one parse attempt, which raises
    // the real error, and is not cached.
  }
  const key = `${entry}|${identity}|${wantTensors ? 't' : 'kv'}`;
  if (identity === 'missing') return readGgufInfo(entry, opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = readGgufInfo(entry, opts).catch((err) => {
    // Never cache a failure: the next call may see a repaired file.
    cache.delete(key);
    throw err;
  });
  cache.set(key, p);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return p;
}

export function clearGgufInfoCache(): void {
  cache.clear();
}
