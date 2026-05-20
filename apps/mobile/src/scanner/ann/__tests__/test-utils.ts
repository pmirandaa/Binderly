// Test-only helpers — build a synthetic index buffer that mirrors
// the byte layout `apps/api-python/ann/format.py` writes.
//
// The mobile tests use this rather than committing a Python-built
// binary so that:
//
//   1. The TS reader is exercised against the same byte layout the
//      Python writer produces.
//   2. The vitest suite stays hermetic (no fixture files to keep in
//      sync).
//   3. Manifest + binary stay in lock-step inside a single test
//      file — when we change either, both move together.
//
// Everything here is exported only via `__tests__/` so it never
// leaks into the public surface.

import {
  DTYPE_FLOAT16,
  DTYPE_FLOAT32,
  HEADER_SIZE_BYTES,
  INDEX_FORMAT_VERSION,
  INDEX_MAGIC,
} from '../format';

export interface BuildBufferOptions {
  ids: string[];
  embeddings: Float32Array;
  dim: number;
  idLength: number;
  dtype: 'float16' | 'float32';
}

/** Synthesise the on-disk index byte layout from a JS payload. */
export function buildIndexBuffer(opts: BuildBufferOptions): ArrayBuffer {
  const count = opts.ids.length;
  if (opts.embeddings.length !== count * opts.dim) {
    throw new Error(
      `embeddings length ${opts.embeddings.length} disagrees with count*dim = ${count * opts.dim}`,
    );
  }

  const dtypeTag = opts.dtype === 'float16' ? DTYPE_FLOAT16 : DTYPE_FLOAT32;
  const dtypeBytes = opts.dtype === 'float16' ? 2 : 4;
  const idBytes = count * opts.idLength;
  const bodyBytes = count * opts.dim * dtypeBytes;
  const total = HEADER_SIZE_BYTES + idBytes + bodyBytes;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, INDEX_MAGIC, true);
  view.setUint32(4, INDEX_FORMAT_VERSION, true);
  view.setUint32(8, opts.dim, true);
  view.setUint32(12, count, true);
  view.setUint32(16, dtypeTag, true);
  view.setUint32(20, opts.idLength, true);
  // reserved u64 left at zero
  const bytes = new Uint8Array(buffer);
  for (let row = 0; row < count; row += 1) {
    const id = opts.ids[row] ?? '';
    if (id.length > opts.idLength) {
      throw new Error(
        `id "${id}" at row ${row} exceeds idLength ${opts.idLength}`,
      );
    }
    const offset = HEADER_SIZE_BYTES + row * opts.idLength;
    for (let i = 0; i < id.length; i += 1) {
      bytes[offset + i] = id.charCodeAt(i);
    }
  }

  const bodyOffset = HEADER_SIZE_BYTES + idBytes;
  if (opts.dtype === 'float32') {
    const out = new Float32Array(buffer, bodyOffset, count * opts.dim);
    out.set(opts.embeddings);
  } else {
    // FP16: encode each float into a Uint16Array slot.
    const out = new Uint16Array(buffer, bodyOffset, count * opts.dim);
    for (let i = 0; i < opts.embeddings.length; i += 1) {
      out[i] = encodeFloat16(opts.embeddings[i] ?? 0);
    }
  }
  return buffer;
}

/** Build a unit-norm Float32Array row-major matrix from a flat array of vectors. */
export function unitNormMatrix(rows: number[][]): Float32Array {
  const dim = rows[0]?.length ?? 0;
  const out = new Float32Array(rows.length * dim);
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    let norm = 0;
    for (let d = 0; d < dim; d += 1) {
      const v = row[d] ?? 0;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d += 1) {
      out[r * dim + d] = (row[d] ?? 0) / norm;
    }
  }
  return out;
}

/** Deterministic PRNG (mulberry32) so synthetic tests are repeatable. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample a unit-norm random vector from the RNG. */
export function randomUnitVector(dim: number, rng: () => number): Float32Array {
  const out = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    // Box-Muller: two uniforms → one standard normal.
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const v = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) {
    out[i] = (out[i] ?? 0) / norm;
  }
  return out;
}

// IEEE 754 single → half encoder.
//
// Used only in tests to synthesise FP16-encoded buffers; production
// FP16 bytes are written by the Python builder.
export function encodeFloat16(value: number): number {
  if (value === 0) return 0;
  if (Number.isNaN(value)) return 0x7e00;
  if (!Number.isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;

  const sign = value < 0 ? 1 : 0;
  const absValue = Math.abs(value);

  const bits = new Uint32Array(1);
  const floatView = new Float32Array(bits.buffer);
  floatView[0] = absValue;
  const f32 = bits[0] ?? 0;

  const exponent = (f32 >>> 23) & 0xff;
  const mantissa = f32 & 0x7fffff;

  if (exponent === 0xff) {
    // Inf or NaN already handled above; defensively encode as Inf.
    return (sign << 15) | 0x7c00;
  }

  const biasedExp = exponent - 127 + 15;
  if (biasedExp >= 31) {
    // Overflow → Inf
    return (sign << 15) | 0x7c00;
  }
  if (biasedExp <= 0) {
    // Subnormal or underflow → flush to zero (rare for unit-norm vectors).
    if (biasedExp < -10) return sign << 15;
    const shifted = (mantissa | 0x800000) >>> (1 - biasedExp);
    // Round-to-nearest-even by adding the round bit.
    const halfMantissa = (shifted + 0x1000) >>> 13;
    return (sign << 15) | halfMantissa;
  }
  const halfMantissa = (mantissa + 0x1000) >>> 13;
  let halfExp = biasedExp;
  let half = (halfMantissa >>> 0) & 0x3ff;
  if ((mantissa + 0x1000) >= 0x800000) {
    // Mantissa rounded up to a new exponent — bump exp, mantissa stays 0.
    halfExp += 1;
    half = 0;
    if (halfExp >= 31) {
      return (sign << 15) | 0x7c00;
    }
  }
  return (sign << 15) | (halfExp << 10) | half;
}
