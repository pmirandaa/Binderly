// Tests for the RGB → grayscale + downsample helpers.
//
// Both helpers are pure typed-array transforms; the tests drive
// them with synthetic pixel buffers and assert byte-level
// behaviour. No mocks, no DOM, no native module.

import { describe, expect, it } from 'vitest';

import { downsampleGrayscale, rgbToGrayscale } from '../grayscale.js';

function uniformRgb(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

describe('rgbToGrayscale', () => {
  it('maps a pure-white RGB buffer to 255 across the board', () => {
    const out = rgbToGrayscale(uniformRgb(4, 4, 255, 255, 255), 4, 4);
    expect(out.length).toBe(16);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(254);
      expect(out[i]).toBeLessThanOrEqual(255);
    }
  });

  it('maps a pure-black RGB buffer to 0', () => {
    const out = rgbToGrayscale(uniformRgb(4, 4, 0, 0, 0), 4, 4);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBe(0);
    }
  });

  it('applies Rec.601 luma weights (green dominates)', () => {
    // Compare R=255, G=0, B=0 vs R=0, G=255, B=0: green should
    // produce a brighter grayscale because of the 0.587 weight.
    const red = rgbToGrayscale(uniformRgb(2, 2, 255, 0, 0), 2, 2);
    const green = rgbToGrayscale(uniformRgb(2, 2, 0, 255, 0), 2, 2);
    const blue = rgbToGrayscale(uniformRgb(2, 2, 0, 0, 255), 2, 2);
    expect(green[0]).toBeGreaterThan(red[0] ?? 0);
    expect(red[0]).toBeGreaterThan(blue[0] ?? 0);
    expect(green[0]).toBeGreaterThan(blue[0] ?? 0);
  });

  it('preserves spatial layout (per-pixel mapping, no re-ordering)', () => {
    const pixels = new Uint8Array([
      255, 255, 255, 0, 0, 0, // row 0: white, black
      0, 0, 0, 255, 255, 255, // row 1: black, white
    ]);
    const out = rgbToGrayscale(pixels, 2, 2);
    expect(out[0]).toBeGreaterThan(250);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBeGreaterThan(250);
  });

  it('rejects pixel buffers whose length does not match width × height × 3', () => {
    expect(() => rgbToGrayscale(new Uint8Array(10), 4, 4)).toThrow(/does not match/);
  });
});

describe('downsampleGrayscale', () => {
  it('returns a fresh buffer of the destination size', () => {
    const src = new Uint8Array(16 * 16);
    const out = downsampleGrayscale(src, 16, 16, 4, 4);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(16);
  });

  it('preserves a uniform grayscale value', () => {
    const src = new Uint8Array(8 * 8).fill(128);
    const out = downsampleGrayscale(src, 8, 8, 4, 4);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBe(128);
    }
  });

  it('uses nearest-neighbour sampling (no smoothing across edges)', () => {
    // 4×1 source: black-black-white-white. Downsample to 2×1.
    // Nearest-neighbour should give black-white.
    const src = new Uint8Array([0, 0, 255, 255]);
    const out = downsampleGrayscale(src, 4, 1, 2, 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
  });

  it('handles upsampling (dst larger than src)', () => {
    // 2×1 source: black-white. Upsample to 4×1.
    // Nearest-neighbour should duplicate each source pixel.
    const src = new Uint8Array([0, 255]);
    const out = downsampleGrayscale(src, 2, 1, 4, 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(255);
    expect(out[3]).toBe(255);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => downsampleGrayscale(new Uint8Array(0), 0, 0, 4, 4)).toThrow(
      /must be positive/,
    );
    expect(() => downsampleGrayscale(new Uint8Array(16), 4, 4, 0, 4)).toThrow(
      /must be positive/,
    );
  });

  it('rejects a gray buffer whose length does not match src dimensions', () => {
    expect(() => downsampleGrayscale(new Uint8Array(10), 4, 4, 2, 2)).toThrow(
      /does not match/,
    );
  });
});
