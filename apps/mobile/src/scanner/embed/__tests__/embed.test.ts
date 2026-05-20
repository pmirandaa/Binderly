// Tests for the pure preprocessing + postprocessing helpers in
// `embed.ts`. Mirrors the Python `test_normalize.py` so the two sides
// of the recipe table stay in lockstep.

import { describe, expect, it } from 'vitest';

import {
  l2Normalize,
  postprocessEmbedding,
  preprocessFrame,
  preprocessFromFrame,
} from '../embed';

function whitePixels(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h * 3).fill(255);
}

function midGreyPixels(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h * 3).fill(128);
}

describe('preprocessFrame', () => {
  it('maps a pure-white frame to +1 under mobilenet_v3', () => {
    const out = preprocessFrame(
      whitePixels(4, 4),
      { width: 4, height: 4 },
      { width: 2, height: 2 },
      'mobilenet_v3',
    );
    expect(out.length).toBe(2 * 2 * 3);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeCloseTo(1.0, 5);
    }
  });

  it('maps mid-grey to ~0.5 under zero_one', () => {
    const out = preprocessFrame(
      midGreyPixels(4, 4),
      { width: 4, height: 4 },
      { width: 2, height: 2 },
      'zero_one',
    );
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeCloseTo(128 / 255, 5);
    }
  });

  it('outputs Float32Array of the target HxWxC length', () => {
    const out = preprocessFrame(
      whitePixels(8, 8),
      { width: 8, height: 8 },
      { width: 4, height: 6 },
      'zero_one',
    );
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(4 * 6 * 3);
  });

  it('rejects a pixel buffer whose length does not match dimensions', () => {
    expect(() =>
      preprocessFrame(
        new Uint8Array(10),
        { width: 4, height: 4 },
        { width: 4, height: 4 },
        'zero_one',
      ),
    ).toThrow(/does not match/);
  });

  it('uses nearest-neighbour resampling (no smoothing across edges)', () => {
    // Two columns: column 0 is black, column 1 is white. Resize 1×2 → 1×4.
    // Nearest-neighbour should give black-black-white-white.
    const src = new Uint8Array([0, 0, 0, 255, 255, 255]);
    const out = preprocessFrame(
      src,
      { width: 2, height: 1 },
      { width: 4, height: 1 },
      'zero_one',
    );
    // out is [R, G, B, R, G, B, R, G, B, R, G, B]
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(0);
    expect(out[6]).toBe(1);
    expect(out[9]).toBe(1);
  });
});

describe('preprocessFromFrame', () => {
  it('reads bytes out of the frame contract', () => {
    const bytes = whitePixels(4, 4);
    const frame = {
      width: 4,
      height: 4,
      toArrayBuffer: (): ArrayBuffer => bytes.buffer.slice(0) as ArrayBuffer,
    };
    const out = preprocessFromFrame(frame, [1, 2, 2, 3], 'mobilenet_v3');
    expect(out.length).toBe(2 * 2 * 3);
    expect(out[0]).toBeCloseTo(1.0, 5);
  });
});

describe('postprocessEmbedding', () => {
  it('L2-normalises the float32 buffer', () => {
    const raw = new Float32Array([3, 4]).buffer;
    const out = postprocessEmbedding(raw, 2);
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
  });

  it('rejects a buffer whose byteLength does not match', () => {
    const raw = new Float32Array([1, 2, 3]).buffer; // 12 bytes
    expect(() => postprocessEmbedding(raw, 4)).toThrow(/expected 16/);
  });

  it('returns float32 of the right length', () => {
    const raw = new Float32Array(32).fill(1).buffer;
    const out = postprocessEmbedding(raw, 32);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(32);
  });
});

describe('l2Normalize', () => {
  it('produces unit-norm output for random vectors', () => {
    const v = new Float32Array([1, 2, 3, 4, 5]);
    const out = l2Normalize(v);
    let sum = 0;
    for (let i = 0; i < out.length; i += 1) {
      const x = out[i] ?? 0;
      sum += x * x;
    }
    expect(Math.sqrt(sum)).toBeCloseTo(1.0, 5);
  });

  it('returns a copy for an all-zero vector', () => {
    const v = new Float32Array([0, 0, 0]);
    const out = l2Normalize(v);
    expect(Array.from(out)).toEqual([0, 0, 0]);
    expect(out).not.toBe(v);
  });
});
