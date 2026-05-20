// Tests for the crop + normalisation step.
//
// One of the tests cross-checks our local mobilenet_v3
// normaliser against the published recipe in
// `apps/mobile/src/scanner/embed/embed.ts` so the two modules
// stay in lockstep.

import { describe, expect, it } from 'vitest';


import { CROP_TENSOR_SIZE } from '../constants.js';
import { cropAndNormalize, normalizeMobilenetV3 } from '../crop.js';

import type { Rect } from '../types.js';

import { preprocessFrame } from '@/scanner/embed/embed';

function uniformRgb(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height * 3).fill(value);
}

describe('normalizeMobilenetV3', () => {
  it('maps 255 → +1', () => {
    expect(normalizeMobilenetV3(255)).toBeCloseTo(1, 5);
  });

  it('maps 0 → -1', () => {
    expect(normalizeMobilenetV3(0)).toBe(-1);
  });

  it('maps 127.5 → 0', () => {
    expect(normalizeMobilenetV3(127.5)).toBe(0);
  });

  it('matches the embed module recipe byte-for-byte', () => {
    // Drive both helpers with a 2×2 white frame and compare. If
    // the embed module ever swaps its recipe (e.g. to `[0, 1]`
    // instead of `[-1, +1]`) this test fails loudly and we
    // know to sync.
    const w = 2;
    const h = 2;
    const pixels = uniformRgb(w, h, 200);
    const embedOut = preprocessFrame(pixels, { width: w, height: h }, { width: w, height: h }, 'mobilenet_v3');
    // Apply our local recipe pixel-by-pixel and check identity.
    for (let i = 0; i < embedOut.length; i += 1) {
      expect(embedOut[i]).toBeCloseTo(normalizeMobilenetV3(200), 5);
    }
  });
});

describe('cropAndNormalize', () => {
  const fullRect: Rect = { x: 0, y: 0, width: 8, height: 8 };

  it('outputs a Float32Array of tensorSize² × 3 length', () => {
    const pixels = uniformRgb(8, 8, 128);
    const out = cropAndNormalize(pixels, 8, 8, fullRect, 4);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(4 * 4 * 3);
  });

  it('normalises a pure-white frame to +1 across the board', () => {
    const pixels = uniformRgb(4, 4, 255);
    const out = cropAndNormalize(pixels, 4, 4, { x: 0, y: 0, width: 4, height: 4 }, 4);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeCloseTo(1, 5);
    }
  });

  it('normalises a pure-black frame to -1 across the board', () => {
    const pixels = uniformRgb(4, 4, 0);
    const out = cropAndNormalize(pixels, 4, 4, { x: 0, y: 0, width: 4, height: 4 }, 4);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBe(-1);
    }
  });

  it('crops to the requested rect (ignoring pixels outside)', () => {
    // 4×4 frame, white left half, black right half. Crop only
    // the left half (2×4) → output should be all +1.
    const w = 4;
    const h = 4;
    const pixels = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = x < 2 ? 255 : 0;
        const i = (y * w + x) * 3;
        pixels[i] = v;
        pixels[i + 1] = v;
        pixels[i + 2] = v;
      }
    }
    const out = cropAndNormalize(pixels, w, h, { x: 0, y: 0, width: 2, height: 4 }, 2);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeCloseTo(1, 5);
    }
  });

  it('produces values inside [-1, +1] for any uint8 RGB input', () => {
    // Quasi-random byte pattern (deterministic for test stability).
    const w = 16;
    const h = 16;
    const pixels = new Uint8Array(w * h * 3);
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = (i * 73) % 256;
    }
    const out = cropAndNormalize(pixels, w, h, { x: 0, y: 0, width: 16, height: 16 }, 8);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(-1);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
  });

  it('rejects a degenerate rect', () => {
    expect(() =>
      cropAndNormalize(uniformRgb(4, 4, 128), 4, 4, { x: 0, y: 0, width: 0, height: 4 }, 4),
    ).toThrow(/degenerate rect/);
  });

  it('rejects a pixel buffer with the wrong length', () => {
    expect(() => cropAndNormalize(new Uint8Array(10), 4, 4, fullRect, 4)).toThrow(/does not match/);
  });

  it('rejects a non-positive tensor size', () => {
    expect(() => cropAndNormalize(uniformRgb(4, 4, 128), 4, 4, fullRect, 0)).toThrow(/tensorSize/);
  });

  it('defaults the tensor size to CROP_TENSOR_SIZE (224)', () => {
    // The default arg path is covered by detectCard's acceptance
    // test downstream; here we just confirm the constant value.
    expect(CROP_TENSOR_SIZE).toBe(224);
  });
});
