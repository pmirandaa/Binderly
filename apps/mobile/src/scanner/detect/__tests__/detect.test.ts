// Top-level `detectCard()` integration tests.
//
// Each test builds a synthetic frame with a known card-shaped
// region, runs the full pipeline, and asserts the detection
// result against the ground truth. The synthetic frames mimic
// the on-device posture: HWC uint8 RGB, mid-resolution
// (160 × 240 default — enough to exercise the downsampler).

import { describe, expect, it } from 'vitest';

import {
  CARD_ASPECT_MAX,
  CARD_ASPECT_MIN,
  CROP_TENSOR_SIZE,
} from '../constants.js';
import { detectCard } from '../detect.js';

import type { DetectionInput } from '../types.js';

interface SyntheticFrameOptions {
  readonly width: number;
  readonly height: number;
  readonly background: number;
  readonly foreground: number;
  readonly rectX: number;
  readonly rectY: number;
  readonly rectW: number;
  readonly rectH: number;
}

function buildFrameWithCard(options: SyntheticFrameOptions): DetectionInput {
  const { width, height, background, foreground, rectX, rectY, rectW, rectH } = options;
  const pixels = new Uint8Array(width * height * 3).fill(background);
  for (let y = rectY; y < rectY + rectH; y += 1) {
    for (let x = rectX; x < rectX + rectW; x += 1) {
      const i = (y * width + x) * 3;
      pixels[i] = foreground;
      pixels[i + 1] = foreground;
      pixels[i + 2] = foreground;
    }
  }
  return { pixels, width, height };
}

function uniformFrame(width: number, height: number, value: number): DetectionInput {
  return { pixels: new Uint8Array(width * height * 3).fill(value), width, height };
}

describe('detectCard — happy path', () => {
  it('detects a centred portrait card rect within ±5 % of ground truth', () => {
    const w = 160;
    const h = 240;
    const rectX = 50;
    const rectY = 60;
    const rectW = 60;
    const rectH = 84;
    const result = detectCard(
      buildFrameWithCard({
        width: w,
        height: h,
        background: 230,
        foreground: 60,
        rectX,
        rectY,
        rectW,
        rectH,
      }),
    );
    expect(result.rectValid).toBe(true);
    // Tolerance: ±5 % of source dimensions for each coordinate.
    const tolX = Math.ceil(w * 0.05);
    const tolY = Math.ceil(h * 0.05);
    expect(Math.abs(result.rect.x - rectX)).toBeLessThanOrEqual(tolX);
    expect(Math.abs(result.rect.y - rectY)).toBeLessThanOrEqual(tolY);
    expect(Math.abs(result.rect.width - rectW)).toBeLessThanOrEqual(tolX * 2);
    expect(Math.abs(result.rect.height - rectH)).toBeLessThanOrEqual(tolY * 2);
    expect(result.accepted).toBe(true);
    expect(result.cropped).not.toBeNull();
  });

  it('produces a normalised tensor of the right length on accepted frames', () => {
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 230,
        foreground: 60,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
    );
    expect(result.cropped).not.toBeNull();
    expect(result.cropped?.length).toBe(CROP_TENSOR_SIZE * CROP_TENSOR_SIZE * 3);
    for (const v of result.cropped ?? new Float32Array()) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('detection rect aspect ratio falls inside the card aspect band', () => {
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 230,
        foreground: 60,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
    );
    expect(result.quality.aspectRatio).toBeGreaterThanOrEqual(CARD_ASPECT_MIN);
    expect(result.quality.aspectRatio).toBeLessThanOrEqual(CARD_ASPECT_MAX);
    expect(result.quality.aspectOK).toBe(true);
  });
});

describe('detectCard — rejections', () => {
  it('rejects a uniform frame (no edges) — sharpness floor + rect invalid', () => {
    const result = detectCard(uniformFrame(160, 240, 128));
    expect(result.rectValid).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.cropped).toBeNull();
    expect(result.quality.sharpnessOK).toBe(false);
  });

  it('rejects an under-exposed frame even when a rect is present', () => {
    // Dark background, slightly darker rect. Edges exist (so
    // detection finds a rect) but brightness inside the rect is
    // below the floor.
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 15,
        foreground: 5,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
    );
    expect(result.accepted).toBe(false);
    expect(result.quality.brightnessOK).toBe(false);
    expect(result.cropped).toBeNull();
  });

  it('rejects an over-exposed frame', () => {
    // Bright background, slightly brighter rect. brightness > 0.92.
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 250,
        foreground: 240,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
    );
    expect(result.accepted).toBe(false);
    expect(result.quality.brightnessOK).toBe(false);
    expect(result.cropped).toBeNull();
  });

  it('rejects a landscape-oriented card-shaped rect', () => {
    // Same aspect (1.4) but rotated → width > height.
    const result = detectCard(
      buildFrameWithCard({
        width: 240,
        height: 160,
        background: 230,
        foreground: 60,
        rectX: 60,
        rectY: 50,
        rectW: 84,
        rectH: 60,
      }),
    );
    expect(result.rectValid).toBe(true);
    expect(result.quality.portraitOrientation).toBe(false);
    expect(result.quality.aspectOK).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.cropped).toBeNull();
  });

  it('rejects a square card-shaped rect (aspect outside band)', () => {
    // Detect a square — falls outside [1.25, 1.60].
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 230,
        foreground: 60,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 60,
      }),
    );
    expect(result.quality.aspectOK).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.cropped).toBeNull();
  });

  it('always populates the quality block even when the rect is invalid', () => {
    const result = detectCard(uniformFrame(160, 240, 128));
    expect(result.quality.sharpness).toBeGreaterThanOrEqual(0);
    expect(result.quality.brightness).toBeGreaterThanOrEqual(0);
    expect(result.quality.aspectRatio).toBeGreaterThanOrEqual(0);
  });
});

describe('detectCard — validation', () => {
  it('rejects a frame with non-positive dimensions', () => {
    expect(() =>
      detectCard({ pixels: new Uint8Array(0), width: 0, height: 0 }),
    ).toThrow(/dimensions must be positive/);
  });

  it('rejects a pixel buffer whose length does not match dimensions', () => {
    expect(() =>
      detectCard({ pixels: new Uint8Array(10), width: 4, height: 4 }),
    ).toThrow(/does not match/);
  });
});

describe('detectCard — option overrides', () => {
  it('uses a custom tensor size when supplied', () => {
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 230,
        foreground: 60,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
      { tensorSize: 64 },
    );
    expect(result.cropped?.length).toBe(64 * 64 * 3);
  });

  it('respects a tightened sharpness floor', () => {
    // A frame that would normally pass — set the floor very high.
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 230,
        foreground: 60,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
      { sharpnessMin: 10_000 },
    );
    expect(result.quality.sharpnessOK).toBe(false);
    expect(result.accepted).toBe(false);
  });

  it('respects a tightened activity floor (no rect found)', () => {
    const result = detectCard(
      buildFrameWithCard({
        width: 160,
        height: 240,
        background: 230,
        foreground: 60,
        rectX: 50,
        rectY: 60,
        rectW: 60,
        rectH: 84,
      }),
      { activityFloor: 1_000_000 },
    );
    expect(result.rectValid).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.cropped).toBeNull();
  });
});
