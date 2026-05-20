import { describe, expect, it } from 'vitest';

import {
  __decodeFloat16ForTests,
  AnnFormatError,
  DTYPE_FLOAT16,
  DTYPE_FLOAT32,
  HEADER_SIZE_BYTES,
  INDEX_FORMAT_VERSION,
  INDEX_MAGIC,
  parseHeader,
  parseIndex,
} from '../format';
import {
  buildIndexBuffer,
  encodeFloat16,
  unitNormMatrix,
} from './test-utils';

describe('parseHeader', () => {
  it('parses a valid header', () => {
    const buffer = buildIndexBuffer({
      ids: ['a', 'b'],
      embeddings: unitNormMatrix([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ]),
      dim: 4,
      idLength: 8,
      dtype: 'float32',
    });
    const header = parseHeader(buffer);
    expect(header.magic).toBe(INDEX_MAGIC);
    expect(header.version).toBe(INDEX_FORMAT_VERSION);
    expect(header.dim).toBe(4);
    expect(header.count).toBe(2);
    expect(header.dtype).toBe(DTYPE_FLOAT32);
    expect(header.idLength).toBe(8);
  });

  it('rejects a short buffer', () => {
    expect(() => parseHeader(new ArrayBuffer(8))).toThrow(AnnFormatError);
  });

  it('rejects magic mismatch', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, 0xdeadbeef, true);
    view.setUint32(4, INDEX_FORMAT_VERSION, true);
    expect(() => parseHeader(buffer)).toThrowError(/magic/);
  });

  it('rejects version mismatch', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, INDEX_MAGIC, true);
    view.setUint32(4, 999, true);
    view.setUint32(20, 4, true);
    expect(() => parseHeader(buffer)).toThrowError(/version/);
  });

  it('rejects unknown dtype', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, INDEX_MAGIC, true);
    view.setUint32(4, INDEX_FORMAT_VERSION, true);
    view.setUint32(16, 99, true);
    view.setUint32(20, 4, true);
    expect(() => parseHeader(buffer)).toThrowError(/dtype/);
  });

  it('rejects idLength = 0', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE_BYTES);
    const view = new DataView(buffer);
    view.setUint32(0, INDEX_MAGIC, true);
    view.setUint32(4, INDEX_FORMAT_VERSION, true);
    view.setUint32(20, 0, true);
    expect(() => parseHeader(buffer)).toThrowError(/idLength/);
  });
});

describe('parseIndex (float32 round-trip)', () => {
  it('decodes ids and embeddings byte-for-byte', () => {
    const embeddings = unitNormMatrix([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const buffer = buildIndexBuffer({
      ids: ['p-0', 'p-1', 'p-2'],
      embeddings,
      dim: 3,
      idLength: 4,
      dtype: 'float32',
    });

    const body = parseIndex(buffer);
    expect(body.header.count).toBe(3);
    expect(body.ids).toEqual(['p-0', 'p-1', 'p-2']);
    expect(Array.from(body.embeddings)).toEqual(Array.from(embeddings));
  });

  it('decodes an empty catalog', () => {
    const buffer = buildIndexBuffer({
      ids: [],
      embeddings: new Float32Array(0),
      dim: 4,
      idLength: 36,
      dtype: 'float32',
    });
    const body = parseIndex(buffer);
    expect(body.header.count).toBe(0);
    expect(body.ids).toEqual([]);
    expect(body.embeddings.length).toBe(0);
  });

  it('strips NUL padding from short ids', () => {
    const embeddings = unitNormMatrix([[1, 0]]);
    const buffer = buildIndexBuffer({
      ids: ['x'],
      embeddings,
      dim: 2,
      idLength: 16,
      dtype: 'float32',
    });
    const body = parseIndex(buffer);
    expect(body.ids).toEqual(['x']);
  });

  it('rejects a buffer whose size disagrees with the header', () => {
    const buffer = buildIndexBuffer({
      ids: ['a'],
      embeddings: unitNormMatrix([[1, 0]]),
      dim: 2,
      idLength: 4,
      dtype: 'float32',
    });
    const truncated = buffer.slice(0, buffer.byteLength - 1);
    expect(() => parseIndex(truncated)).toThrowError(/buffer length/);
  });
});

describe('parseIndex (float16 dequantise)', () => {
  it('decodes within FP16 tolerance', () => {
    const embeddings = unitNormMatrix([
      [1, 2, 3, 4],
      [4, 3, 2, 1],
    ]);
    const buffer = buildIndexBuffer({
      ids: ['a', 'b'],
      embeddings,
      dim: 4,
      idLength: 4,
      dtype: 'float16',
    });
    const body = parseIndex(buffer);
    expect(body.header.dtype).toBe(DTYPE_FLOAT16);
    for (let i = 0; i < embeddings.length; i += 1) {
      expect(
        Math.abs((body.embeddings[i] ?? 0) - (embeddings[i] ?? 0)),
      ).toBeLessThan(1e-3);
    }
  });
});

describe('decodeFloat16', () => {
  it('round-trips +1.0 / -1.0 / 0', () => {
    expect(__decodeFloat16ForTests(encodeFloat16(0))).toBe(0);
    expect(__decodeFloat16ForTests(encodeFloat16(1))).toBeCloseTo(1, 6);
    expect(__decodeFloat16ForTests(encodeFloat16(-1))).toBeCloseTo(-1, 6);
  });

  it('preserves Inf / NaN', () => {
    expect(__decodeFloat16ForTests(0x7c00)).toBe(Infinity);
    expect(__decodeFloat16ForTests(0xfc00)).toBe(-Infinity);
    expect(Number.isNaN(__decodeFloat16ForTests(0x7e00))).toBe(true);
  });

  it('preserves normal-range values within FP16 precision', () => {
    const samples = [0.5, 0.25, 0.125, 0.0625, 0.999, -0.5];
    for (const value of samples) {
      const decoded = __decodeFloat16ForTests(encodeFloat16(value));
      expect(Math.abs(decoded - value)).toBeLessThan(1e-3);
    }
  });
});
