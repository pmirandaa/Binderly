// Tests for rectangle detection from gradient projections.

import { describe, expect, it } from 'vitest';

import {
  findRectFromProjections,
  scaleRectToSource,
  ZERO_RECT,
} from '../rectangle.js';

import type { ActivityProfiles } from '../gradient.js';

function profilesWithEdges(
  width: number,
  height: number,
  topRow: number,
  bottomRow: number,
  leftCol: number,
  rightCol: number,
): ActivityProfiles {
  const rowActivity = new Float32Array(height);
  const colActivity = new Float32Array(width);
  // Peak at the four edges; everything else stays low (noise).
  for (let i = 0; i < height; i += 1) {
    rowActivity[i] = i === topRow || i === bottomRow ? 1000 : 1;
  }
  for (let j = 0; j < width; j += 1) {
    colActivity[j] = j === leftCol || j === rightCol ? 1000 : 1;
  }
  return { rowActivity, colActivity, width, height };
}

describe('findRectFromProjections', () => {
  it('locates a rect from four peak edges', () => {
    const profiles = profilesWithEdges(40, 60, 10, 50, 8, 32);
    const { rect, valid } = findRectFromProjections(profiles);
    expect(valid).toBe(true);
    expect(rect.x).toBe(8);
    expect(rect.y).toBe(10);
    expect(rect.width).toBe(32 - 8 + 1);
    expect(rect.height).toBe(50 - 10 + 1);
  });

  it('returns valid=false when the row peak is below the floor', () => {
    const rowActivity = new Float32Array(20).fill(1);
    const colActivity = new Float32Array(20).fill(1000);
    const { rect, valid } = findRectFromProjections(
      { rowActivity, colActivity, width: 20, height: 20 },
      { activityFloor: 50 },
    );
    expect(valid).toBe(false);
    expect(rect).toEqual(ZERO_RECT);
  });

  it('returns valid=false when the col peak is below the floor', () => {
    const rowActivity = new Float32Array(20).fill(1000);
    const colActivity = new Float32Array(20).fill(1);
    const { rect, valid } = findRectFromProjections(
      { rowActivity, colActivity, width: 20, height: 20 },
      { activityFloor: 50 },
    );
    expect(valid).toBe(false);
    expect(rect).toEqual(ZERO_RECT);
  });

  it('uses the configurable threshold ratio', () => {
    // Two peaks (1000) and a moderate plateau (500). With a 0.6
    // ratio, the plateau is below the threshold; with 0.4 it's
    // above and the rect extends to the plateau edges.
    const rowActivity = new Float32Array(10);
    rowActivity[2] = 1000;
    rowActivity[3] = 500;
    rowActivity[6] = 500;
    rowActivity[7] = 1000;
    const colActivity = new Float32Array(10);
    colActivity[1] = 1000;
    colActivity[8] = 1000;

    const tight = findRectFromProjections(
      { rowActivity, colActivity, width: 10, height: 10 },
      { thresholdRatio: 0.6, activityFloor: 10 },
    );
    expect(tight.rect.y).toBe(2);
    expect(tight.rect.height).toBe(7 - 2 + 1);

    const loose = findRectFromProjections(
      { rowActivity, colActivity, width: 10, height: 10 },
      { thresholdRatio: 0.4, activityFloor: 10 },
    );
    expect(loose.rect.y).toBe(2);
    expect(loose.rect.height).toBe(7 - 2 + 1);
  });

  it('returns the zero-rect sentinel for a degenerate scan', () => {
    // Only one peak: the inward scan collapses on itself.
    const rowActivity = new Float32Array(10);
    rowActivity[5] = 1000;
    const colActivity = new Float32Array(10);
    colActivity[5] = 1000;
    const { rect, valid } = findRectFromProjections(
      { rowActivity, colActivity, width: 10, height: 10 },
      { activityFloor: 50 },
    );
    expect(valid).toBe(false);
    expect(rect).toEqual(ZERO_RECT);
  });
});

describe('scaleRectToSource', () => {
  it('scales 1:1 when grid matches source', () => {
    const out = scaleRectToSource({ x: 10, y: 20, width: 30, height: 40 }, 100, 100, 100, 100);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.width).toBe(30);
    expect(out.height).toBe(40);
  });

  it('upscales a grid rect to the source resolution', () => {
    // 10x10 grid → 100x100 source. A rect at (1, 2) of width 3
    // height 4 in grid → (10, 20) of width ~30 height ~40 in
    // source (with rounding tolerance).
    const out = scaleRectToSource({ x: 1, y: 2, width: 3, height: 4 }, 10, 10, 100, 100);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.width).toBeGreaterThanOrEqual(29);
    expect(out.width).toBeLessThanOrEqual(31);
    expect(out.height).toBeGreaterThanOrEqual(39);
    expect(out.height).toBeLessThanOrEqual(41);
  });

  it('clamps to the source extents', () => {
    const out = scaleRectToSource({ x: 0, y: 0, width: 100, height: 100 }, 10, 10, 50, 50);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.width).toBeLessThanOrEqual(50);
    expect(out.height).toBeLessThanOrEqual(50);
  });

  it('rejects non-positive grid dimensions', () => {
    expect(() =>
      scaleRectToSource({ x: 0, y: 0, width: 10, height: 10 }, 0, 10, 100, 100),
    ).toThrow(/positive/);
  });
});
