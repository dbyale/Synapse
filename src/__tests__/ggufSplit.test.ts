// Split GGUFs: `llama-gguf-split --split` writes N files, each a valid GGUF
// whose tensor table lists only the tensors whose bytes are in it. Read one
// part alone and it looks like a small complete model rather than an error, so
// the reader has to walk the whole set — and hand back the part llama.cpp will
// accept, which is always the first.
//
// The files here are synthetic (f32 tensors, 32-byte alignment) so the expected
// byte totals are exact.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { firstSplitPart, readGgufInfo } from '../main/estimator/gguf';
import { classifyModel } from '../main/estimator/model';

const ALIGN = 32;

/** A tensor's size in the data section: f32 payload, padded to the alignment. */
const paddedBytes = (elements: number): number =>
  Math.ceil((elements * 4) / ALIGN) * ALIGN;

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: number | bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const ggufStr = (s: string): Buffer => {
  const body = Buffer.from(s, 'utf8');
  return Buffer.concat([u64(body.length), body]);
};
/** One KV entry: key, type id (8 = string, 4 = uint32), value. */
const kv = (key: string, type: number, value: Buffer): Buffer =>
  Buffer.concat([ggufStr(key), u32(type), value]);

/** One tensor-info row: name, 1 dimension (u64 in GGUFv3), f32 dtype, offset. */
const tensorRow = (name: string, elements: number, offset: number): Buffer =>
  Buffer.concat([ggufStr(name), u32(1), u64(elements), u32(0), u64(offset)]);

interface PartSpec {
  /** Tensor name and element count; f32 means elements * 4 bytes each. */
  tensors: { name: string; elements: number }[];
  blockCount: number;
  splitNo?: number;
  splitCount?: number;
  /** Drop this many bytes off the end of the data section, leaving the table
   *  intact: what a byte-chunked "split" (not a llama.cpp split) looks like. */
  truncate?: number;
}

function writePart(file: string, spec: PartSpec): void {
  const meta = [
    kv('general.architecture', 8, ggufStr('qwen2')),
    kv('general.name', 8, ggufStr('Split Test')),
    kv('qwen2.block_count', 4, u32(spec.blockCount)),
    kv('qwen2.embedding_length', 4, u32(64)),
  ];
  if (spec.splitCount) {
    meta.push(kv('split.count', 4, u32(spec.splitCount)));
    meta.push(kv('split.no', 4, u32(spec.splitNo ?? 0)));
  }

  const rows: Buffer[] = [];
  const data: Buffer[] = [];
  let offset = 0;
  spec.tensors.forEach((t) => {
    rows.push(tensorRow(t.name, t.elements, offset));
    // Each tensor occupies its padded size, so the file's data section matches
    // the offsets in the table.
    const padded = paddedBytes(t.elements);
    data.push(Buffer.alloc(padded));
    offset += padded;
  });

  const header = Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(spec.tensors.length),
    u64(meta.length),
    ...meta,
    ...rows,
  ]);
  const pad = (ALIGN - (header.length % ALIGN)) % ALIGN;
  let body = Buffer.concat(data);
  if (spec.truncate) {
    body = body.subarray(0, Math.max(0, body.length - spec.truncate));
  }
  fs.writeFileSync(file, Buffer.concat([header, Buffer.alloc(pad), body]));
}

let dir: string;
const part = (n: number, total: number): string =>
  path.join(dir, `model-0000${n}-of-0000${total}.gguf`);

// 4 layers split over 2 files: layers 0-1 in part 1, layers 2-3 in part 2.
const HALF = 1024; // elements -> 4 KiB per tensor
const partTensors = (from: number): { name: string; elements: number }[] => [
  { name: `blk.${from}.attn_q.weight`, elements: HALF },
  { name: `blk.${from}.ffn_up.weight`, elements: HALF },
  { name: `blk.${from + 1}.attn_q.weight`, elements: HALF },
  { name: `blk.${from + 1}.ffn_gate_exps.weight`, elements: HALF * 4 },
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-split-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeTwoParts(): void {
  writePart(part(1, 2), {
    tensors: partTensors(0),
    blockCount: 4,
    splitNo: 0,
    splitCount: 2,
  });
  writePart(part(2, 2), {
    tensors: partTensors(2),
    blockCount: 4,
    splitNo: 1,
    splitCount: 2,
  });
}

describe('readGgufInfo on a split GGUF', () => {
  it('sizes the whole model from part 1, not just that part', async () => {
    writeTwoParts();
    const info = await readGgufInfo(part(1, 2));
    expect(info.splitCount).toBe(2);
    expect(info.splitAssembled).toBe(true);
    expect(info.tensors.map((t) => t.name)).toEqual([
      'blk.0.attn_q.weight',
      'blk.0.ffn_up.weight',
      'blk.1.attn_q.weight',
      'blk.1.ffn_gate_exps.weight',
      'blk.2.attn_q.weight',
      'blk.2.ffn_up.weight',
      'blk.3.attn_q.weight',
      'blk.3.ffn_gate_exps.weight',
    ]);
    const all = partTensors(0).concat(partTensors(2));
    expect(info.weightBytes).toBe(
      all.reduce((sum, t) => sum + paddedBytes(t.elements), 0),
    );
    expect(info.path).toBe(part(1, 2));
  });

  it('classifies every layer whichever part it came from', async () => {
    writeTwoParts();
    const model = classifyModel(await readGgufInfo(part(2, 2)));
    expect(model.kind).toBe('moe');
    expect(model.nLayerAll).toBe(4);
    // A part-only read would see two layers and no expert tensor in part 2's
    // own table order; the merged table has experts in layers 1 and 3.
    expect(model.expertBytes.map((b) => (b > 0 ? 1 : 0))).toEqual([0, 1, 0, 1]);
  });

  it('redirects any part to the first one, which is what llama.cpp loads', async () => {
    writeTwoParts();
    const info = await readGgufInfo(part(2, 2));
    expect(info.splitNo).toBe(0);
    expect(info.path).toBe(part(1, 2));
    expect(info.tensors).toHaveLength(8);
  });

  it('refuses a part whose siblings are missing', async () => {
    writePart(part(1, 2), {
      tensors: partTensors(0),
      blockCount: 4,
      splitNo: 0,
      splitCount: 2,
    });
    await expect(readGgufInfo(part(1, 2))).rejects.toThrow(/incomplete/i);
  });

  it('refuses a part that cannot find its first part', async () => {
    writePart(path.join(dir, 'odd-name.gguf'), {
      tensors: partTensors(2),
      blockCount: 4,
      splitNo: 1,
      splitCount: 2,
    });
    await expect(readGgufInfo(path.join(dir, 'odd-name.gguf'))).rejects.toThrow(
      /first part/i,
    );
  });

  it('still flags a byte-chunked file, which llama.cpp cannot load either', async () => {
    // The table promises 28 KiB of tensors; the data section is not there at
    // all, because those bytes live in the next chunk.
    writePart(path.join(dir, 'chunked.gguf'), {
      tensors: partTensors(0),
      blockCount: 4,
      truncate: 28 * 1024,
    });
    const info = await readGgufInfo(path.join(dir, 'chunked.gguf'));
    expect(info.splitCount).toBe(0);
    expect(info.splitTable).toBe(true);
  });
});

describe('firstSplitPart', () => {
  it('maps any part to part 1 when part 1 is on disk', () => {
    writeTwoParts();
    expect(firstSplitPart(part(2, 2))).toBe(part(1, 2));
    expect(firstSplitPart(part(1, 2))).toBe(part(1, 2));
  });

  it('leaves single-file models and a missing part 1 alone', () => {
    writeTwoParts();
    expect(firstSplitPart(path.join(dir, 'whole.gguf'))).toBe(
      path.join(dir, 'whole.gguf'),
    );
    fs.rmSync(part(1, 2));
    expect(firstSplitPart(part(2, 2))).toBe(part(2, 2));
  });
});
