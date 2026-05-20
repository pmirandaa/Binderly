// Tests for the gradient-field + projection helpers.

import { describe, expect, it } from 'vitest';

import { computeGradientField, computeProjections } from '../gradient.js';

function buildGray(width: number, height: number, valueFn: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = valueFn(x, y);
    }
  }
  return out;
}

describe('computeGradientField', () => {
  it('reports zero gradient on a uniform image', () => {
    const gray = buildGray(8, 8, () => 128);
    const field = computeGradientField(gray, 8, 8);
    let max = 0;
    for (let i = 0; i < field.data.length; i += 1) {
      const v = field.data[i] ?? 0;
      if (v > max) max = v;
    }
    expect(max).toBe(0);
  });

  it('reports high horizontal gradient on a vertical edge', () => {
    // Left half black, right half white. Vertical edge at x=4.
    const gray = buildGray(8, 8, (x) => (x < 4 ? 0 : 255));
    const field = computeGradientField(gray, 8, 8);
    // The columns adjacent to x=4 should have the strongest
    // horizontal gradient component.
    expect(field.horizontal[4 * 8 + 3] ?? 0).toBeGreaterThan(200);
    expect(field.horizontal[4 * 8 + 4] ?? 0).toBeGreaterThan(200);
    // Columns far from the edge should have no horizontal gradient.
    expect(field.horizontal[4 * 8 + 1] ?? 0).toBe(0);
  });

  it('reports high vertical gradient on a horizontal edge', () => {
    // Top half black, bottom half white. Horizontal edge at y=4.
    const gray = buildGray(8, 8, (_x, y) => (y < 4 ? 0 : 255));
    const field = computeGradientField(gray, 8, 8);
    expect(field.vertical[3 * 8 + 4] ?? 0).toBeGreaterThan(200);
    expect(field.vertical[4 * 8 + 4] ?? 0).toBeGreaterThan(200);
    expect(field.vertical[1 * 8 + 4] ?? 0).toBe(0);
  });

  it('clamps the combined magnitude to byte range', () => {
    // Maximum per-direction abs-diff is 255. A pattern with
    // black-grey-white horizontally AND black-grey-white
    // vertically produces gx + gy that would exceed 255 without
    // clamping.
    const gray = new Uint8Array([
      0, 128, 255, // row 0: black grey white
      128, 200, 255, // row 1: anchor + bright center
      255, 255, 255, // row 2: bottom-right is white
    ]);
    const field = computeGradientField(gray, 3, 3);
    const center = field.data[1 * 3 + 1] ?? 0;
    expect(center).toBeLessThanOrEqual(255);
    expect(center).toBeGreaterThan(0);
  });

  it('zeros the 1-pixel border (taps would fall off-grid)', () => {
    const gray = buildGray(6, 6, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    const field = computeGradientField(gray, 6, 6);
    for (let x = 0; x < 6; x += 1) {
      expect(field.data[x] ?? 0).toBe(0); // top row
      expect(field.data[5 * 6 + x] ?? 0).toBe(0); // bottom row
    }
    for (let y = 0; y < 6; y += 1) {
      expect(field.data[y * 6] ?? 0).toBe(0); // left column
      expect(field.data[y * 6 + 5] ?? 0).toBe(0); // right column
    }
  });

  it('rejects a gray buffer whose length does not match dimensions', () => {
    expect(() => computeGradientField(new Uint8Array(10), 4, 4)).toThrow(/does not match/);
  });
});

describe('computeProjections', () => {
  it('rowActivity has length = height; colActivity has length = width', () => {
    const gray = buildGray(8, 12, () => 128);
    const field = computeGradientField(gray, 8, 12);
    const profiles = computeProjections(field);
    expect(profiles.rowActivity.length).toBe(12);
    expect(profiles.colActivity.length).toBe(8);
  });

  it('peaks in colActivity at the columns of vertical edges', () => {
    // Vertical edge at x=4 (left-right transition).
    const gray = buildGray(10, 10, (x) => (x < 4 ? 0 : 255));
    const field = computeGradientField(gray, 10, 10);
    const profiles = computeProjections(field);
    const peakX = argmaxFloat32(profiles.colActivity);
    expect(peakX).toBeGreaterThanOrEqual(3);
    expect(peakX).toBeLessThanOrEqual(4);
  });

  it('peaks in rowActivity at the rows of horizontal edges', () => {
    const gray = buildGray(10, 10, (_x, y) => (y < 4 ? 0 : 255));
    const field = computeGradientField(gray, 10, 10);
    const profiles = computeProjections(field);
    const peakY = argmaxFloat32(profiles.rowActivity);
    expect(peakY).toBeGreaterThanOrEqual(3);
    expect(peakY).toBeLessThanOrEqual(4);
  });

  it('produces flat profiles on a uniform image', () => {
    const gray = buildGray(8, 8, () => 200);
    const field = computeGradientField(gray, 8, 8);
    const profiles = computeProjections(field);
    for (let i = 0; i < profiles.rowActivity.length; i += 1) {
      expect(profiles.rowActivity[i] ?? 0).toBe(0);
    }
    for (let i = 0; i < profiles.colActivity.length; i += 1) {
      expect(profiles.colActivity[i] ?? 0).toBe(0);
    }
  });
});

function argmaxFloat32(arr: Float32Array): number {
  let bestIdx = 0;
  let bestVal = arr[0] ?? 0;
  for (let i = 1; i < arr.length; i += 1) {
    const v = arr[i] ?? 0;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}
