// Tests for the quality-gate metrics evaluator.

import { describe, expect, it } from 'vitest';

import { computeGradientField } from '../gradient.js';
import { computeQualityMetrics } from '../quality.js';

import type { GradientField } from '../gradient.js';
import type { Rect } from '../types.js';

function buildField(width: number, height: number, gradFn: (x: number, y: number) => number): GradientField {
  const data = new Uint8Array(width * height);
  const horizontal = new Uint8Array(width * height);
  const vertical = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = gradFn(x, y);
      data[y * width + x] = v;
      horizontal[y * width + x] = v;
      vertical[y * width + x] = 0;
    }
  }
  return { data, horizontal, vertical, width, height };
}

function buildGray(width: number, height: number, brightness: number): Uint8Array {
  const out = new Uint8Array(width * height);
  out.fill(brightness);
  return out;
}

const PORTRAIT_RECT: Rect = { x: 10, y: 10, width: 25, height: 35 };
const LANDSCAPE_RECT: Rect = { x: 10, y: 10, width: 35, height: 25 };
const SQUARE_RECT: Rect = { x: 10, y: 10, width: 30, height: 30 };
const TALL_SLIVER_RECT: Rect = { x: 10, y: 10, width: 5, height: 35 };

describe('computeQualityMetrics — sharpness', () => {
  it('reports a high sharpness when gradients are strong inside the rect', () => {
    const field = buildField(64, 96, () => 50);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.sharpness).toBe(50);
    expect(metrics.sharpnessOK).toBe(true);
  });

  it('reports a low sharpness on a uniformly-flat rect', () => {
    const field = buildField(64, 96, () => 0);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.sharpness).toBe(0);
    expect(metrics.sharpnessOK).toBe(false);
  });

  it('passes the threshold at exactly the floor', () => {
    const field = buildField(64, 96, () => 6); // exactly the floor
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.sharpnessOK).toBe(true);
  });

  it('respects the sharpnessMin override', () => {
    const field = buildField(64, 96, () => 5);
    const gray = buildGray(64, 96, 128);
    const strict = computeQualityMetrics(field, gray, PORTRAIT_RECT, { sharpnessMin: 6 });
    expect(strict.sharpnessOK).toBe(false);
    const lax = computeQualityMetrics(field, gray, PORTRAIT_RECT, { sharpnessMin: 4 });
    expect(lax.sharpnessOK).toBe(true);
  });
});

describe('computeQualityMetrics — brightness', () => {
  it('reports brightness normalised to [0, 1]', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.brightness).toBeCloseTo(128 / 255, 4);
    expect(metrics.brightnessOK).toBe(true);
  });

  it('flags an under-exposed frame', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 10); // ~0.04
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.brightness).toBeLessThan(0.1);
    expect(metrics.brightnessOK).toBe(false);
  });

  it('flags an over-exposed frame', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 250); // ~0.98
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.brightness).toBeGreaterThan(0.95);
    expect(metrics.brightnessOK).toBe(false);
  });

  it('respects custom brightness bounds', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 100);
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT, {
      brightnessMin: 0.5,
      brightnessMax: 0.9,
    });
    expect(metrics.brightnessOK).toBe(false);
  });
});

describe('computeQualityMetrics — aspect ratio', () => {
  it('accepts a portrait card-shaped rect', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, PORTRAIT_RECT);
    expect(metrics.aspectRatio).toBeCloseTo(35 / 25, 5);
    expect(metrics.portraitOrientation).toBe(true);
    expect(metrics.aspectOK).toBe(true);
  });

  it('rejects a landscape-oriented rect', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, LANDSCAPE_RECT);
    expect(metrics.portraitOrientation).toBe(false);
    expect(metrics.aspectOK).toBe(false);
  });

  it('rejects a square rect (aspect 1.0)', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, SQUARE_RECT);
    expect(metrics.aspectRatio).toBe(1);
    expect(metrics.aspectOK).toBe(false);
  });

  it('rejects a tall sliver (aspect above ceiling)', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, TALL_SLIVER_RECT);
    expect(metrics.aspectRatio).toBeCloseTo(7, 5);
    expect(metrics.aspectOK).toBe(false);
  });
});

describe('computeQualityMetrics — degenerate rect', () => {
  it('returns conservative-zeroed metrics for a zero rect', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(metrics.sharpness).toBe(0);
    expect(metrics.brightness).toBe(0);
    expect(metrics.aspectRatio).toBe(0);
    expect(metrics.sharpnessOK).toBe(false);
    expect(metrics.brightnessOK).toBe(false);
    expect(metrics.aspectOK).toBe(false);
  });

  it('survives a rect clamped fully out of bounds', () => {
    const field = buildField(64, 96, () => 10);
    const gray = buildGray(64, 96, 128);
    const metrics = computeQualityMetrics(field, gray, {
      x: 200,
      y: 200,
      width: 10,
      height: 10,
    });
    expect(metrics.sharpness).toBe(0);
    expect(metrics.aspectOK).toBe(false);
  });
});

describe('computeQualityMetrics — combined with the real gradient field', () => {
  it('produces realistic numbers on a real grayscale + gradient field', () => {
    // 24x32 black rect on a mid-grey background, edges everywhere.
    const w = 64;
    const h = 96;
    const gray = new Uint8Array(w * h).fill(180);
    const rectX = 20;
    const rectY = 20;
    const rectW = 24;
    const rectH = 34;
    for (let y = rectY; y < rectY + rectH; y += 1) {
      for (let x = rectX; x < rectX + rectW; x += 1) {
        gray[y * w + x] = 30;
      }
    }
    const field = computeGradientField(gray, w, h);
    const metrics = computeQualityMetrics(field, gray, {
      x: rectX,
      y: rectY,
      width: rectW,
      height: rectH,
    });
    expect(metrics.aspectRatio).toBeCloseTo(rectH / rectW, 3);
    expect(metrics.aspectOK).toBe(true);
    expect(metrics.brightness).toBeLessThan(0.5);
    // The rect's interior is uniform (low sharpness); only the
    // 1-pixel rim contributes. Just check that the metric is real.
    expect(metrics.sharpness).toBeGreaterThanOrEqual(0);
  });
});
