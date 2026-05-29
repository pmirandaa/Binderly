// Quality-gate tests — pure pixel buffers in, structured result out.
//
// The synthetic fixtures live in `fixtures.ts` so the
// session/screen tests can share them.

import { describe, expect, it } from 'vitest';

import {
  CAPTURE_BRIGHTNESS_MAX,
  CAPTURE_BRIGHTNESS_MIN,
  CAPTURE_CORNER_COVERAGE_MIN,
  CAPTURE_FULL_COVERAGE_MIN,
  CAPTURE_SHARPNESS_MIN,
  CAPTURE_STEPS,
  CAPTURE_SURFACE_BRIGHTNESS_MIN,
} from '../constants.js';
import {
  evaluateCaptureQuality,
  evaluateCaptureQualityForKind,
  evaluateCaptureQualityForStep,
  gateOptionsForStep,
  CAPTURE_FEEDBACK_COPY,
} from '../quality.js';
import {
  makeBlurryBuffer,
  makeDarkBuffer,
  makeEmptyFrameBuffer,
  makeOffCenterBuffer,
  makeOverExposedBuffer,
  makeSharpCardBuffer,
  makeUniformBuffer,
} from './fixtures.js';

import type { CaptureStepDefinition } from '../types.js';

function stepFor(kind: CaptureStepDefinition['kind']): CaptureStepDefinition {
  const step = CAPTURE_STEPS.find((s) => s.kind === kind);
  if (step === undefined) throw new Error(`no step for ${kind}`);
  return step;
}

describe('evaluateCaptureQuality', () => {
  it('accepts a sharp, well-exposed, well-framed full-card buffer', () => {
    const pixels = makeSharpCardBuffer({ width: 192, height: 256 });
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('great');
    expect(result.sharpnessOK).toBe(true);
    expect(result.brightnessOK).toBe(true);
    expect(result.coverageOK).toBe(true);
  });

  it('rejects a blurry uniform buffer with reason "blurry"', () => {
    const pixels = makeBlurryBuffer(192, 256);
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.accepted).toBe(false);
    expect(result.sharpnessOK).toBe(false);
    expect(result.reason).toBe('blurry');
  });

  it('rejects an under-exposed buffer with reason "too_dark"', () => {
    const pixels = makeDarkBuffer(192, 256);
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.accepted).toBe(false);
    expect(result.brightnessOK).toBe(false);
    expect(result.reason).toBe('too_dark');
    expect(result.metrics.brightness).toBeLessThan(CAPTURE_BRIGHTNESS_MIN);
  });

  it('rejects an over-exposed buffer with reason "over_exposed"', () => {
    const pixels = makeOverExposedBuffer(192, 256);
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.accepted).toBe(false);
    expect(result.brightnessOK).toBe(false);
    expect(result.reason).toBe('over_exposed');
    expect(result.metrics.brightness).toBeGreaterThan(CAPTURE_BRIGHTNESS_MAX);
  });

  it('rejects an off-center small-card buffer with reason "off_center"', () => {
    const pixels = makeOffCenterBuffer(192, 256);
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.accepted).toBe(false);
    expect(result.coverageOK).toBe(false);
    expect(result.reason).toBe('off_center');
    expect(result.metrics.coverage).toBeLessThan(CAPTURE_FULL_COVERAGE_MIN);
  });

  it('rejects a fully-uniform grey buffer with reason "no_card_detected"', () => {
    const pixels = makeEmptyFrameBuffer(192, 256);
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.accepted).toBe(false);
    expect(result.coverageOK).toBe(false);
    expect(result.reason).toBe('no_card_detected');
    expect(result.metrics.coverage).toBe(0);
  });

  it('also surfaces "no_card_detected" when both sharpness and coverage are zero', () => {
    const pixels = makeUniformBuffer(192, 256, [128, 128, 128]);
    const result = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    // Zero-coverage check fires before sharpness — `no_card_detected`
    // is the most informative reason for an empty frame.
    expect(result.reason).toBe('no_card_detected');
  });

  it('accepts a corner-detail buffer that fails the stricter full-card coverage gate', () => {
    // A medium-sized banded card produces ~0.05 edge-pixel
    // coverage — passes the corner gate (0.04) but fails the
    // full-card gate (0.08).
    const pixels = makeSharpCardBuffer({
      width: 192,
      height: 256,
      cardCoverage: 0.5,
      bandCount: 6,
    });
    const fullResult = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(fullResult.coverageOK).toBe(false);
    const cornerResult = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
    });
    expect(cornerResult.coverageOK).toBe(true);
  });

  it('returns real metric values regardless of pass/fail', () => {
    const pixels = makeBlurryBuffer(96, 128);
    const result = evaluateCaptureQuality(pixels, 96, 128, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    });
    expect(result.metrics.brightness).toBeGreaterThan(0);
    expect(result.metrics.brightness).toBeLessThan(1);
    expect(result.metrics.sharpness).toBeGreaterThanOrEqual(0);
    expect(result.metrics.coverage).toBeGreaterThanOrEqual(0);
  });

  it('throws on a pixel buffer that mismatches the declared dimensions', () => {
    const pixels = new Uint8Array(10);
    expect(() =>
      evaluateCaptureQuality(pixels, 16, 16, { coverageMin: 0.4 }),
    ).toThrow(/pixels length/);
  });

  it('throws on non-positive dimensions', () => {
    expect(() =>
      evaluateCaptureQuality(new Uint8Array(0), 0, 0, { coverageMin: 0.4 }),
    ).toThrow(/positive/);
  });

  it('respects override thresholds', () => {
    // Pass a buffer that would normally fail sharpness, but with a
    // lower override it should pass (assuming brightness/coverage
    // OK). The blurry buffer fails coverage too, so we need a
    // sharp-ish + override combo. Use a sharp card + slightly
    // tighter override.
    const pixels = makeSharpCardBuffer({ width: 192, height: 256 });
    const tight = evaluateCaptureQuality(pixels, 192, 256, {
      coverageMin: CAPTURE_FULL_COVERAGE_MIN,
      sharpnessMin: CAPTURE_SHARPNESS_MIN + 200, // unreachable
    });
    expect(tight.accepted).toBe(false);
    expect(tight.reason).toBe('blurry');
  });
});

describe('evaluateCaptureQualityForKind', () => {
  it('uses the per-kind coverage minimum from the lookup map', () => {
    const pixels = makeSharpCardBuffer({
      width: 192,
      height: 256,
      cardCoverage: 0.5,
    });
    const coverageMinByKind = {
      frontFull: 0.95,
      backFull: 0.95,
      frontCorner: 0.05,
      backCorner: 0.05,
      bottomLeftCorner: 0.05,
      bottomRightCorner: 0.05,
      surface: 0.95,
    } as const;
    const fullKindResult = evaluateCaptureQualityForKind(
      pixels,
      192,
      256,
      'frontFull',
      coverageMinByKind,
    );
    expect(fullKindResult.coverageOK).toBe(false);
    const cornerKindResult = evaluateCaptureQualityForKind(
      pixels,
      192,
      256,
      'bottomRightCorner',
      coverageMinByKind,
    );
    expect(cornerKindResult.coverageOK).toBe(true);
  });
});

describe('gateOptionsForStep + evaluateCaptureQualityForStep', () => {
  it('folds in no overrides for a plain full-portrait step', () => {
    const gate = gateOptionsForStep(stepFor('frontFull'));
    expect(gate.coverageMin).toBe(CAPTURE_FULL_COVERAGE_MIN);
    expect(gate.brightnessMin).toBeUndefined();
    expect(gate.brightnessMax).toBeUndefined();
    expect(gate.sharpnessMin).toBeUndefined();
  });

  it('uses the corner coverage floor for a corner step', () => {
    const gate = gateOptionsForStep(stepFor('bottomLeftCorner'));
    expect(gate.coverageMin).toBe(CAPTURE_CORNER_COVERAGE_MIN);
  });

  it('relaxes the brightness floor for the raking-light surface step', () => {
    const gate = gateOptionsForStep(stepFor('surface'));
    expect(gate.brightnessMin).toBe(CAPTURE_SURFACE_BRIGHTNESS_MIN);
    expect(gate.brightnessMin).toBeLessThan(CAPTURE_BRIGHTNESS_MIN);
  });

  it('accepts a dim raking-light frame under the surface gate that the default gate would reject', () => {
    // A card lit at a low angle: darker than the default 0.18 floor
    // but above the relaxed surface floor. background/card luminance
    // chosen to land mean brightness in (surfaceMin, defaultMin).
    const pixels = makeSharpCardBuffer({
      width: 192,
      height: 256,
      background: [20, 20, 20],
      card: [44, 44, 44],
      cardCoverage: 0.85,
      bandCount: 8,
    });
    const surfaceResult = evaluateCaptureQualityForStep(pixels, 192, 256, stepFor('surface'));
    const frontResult = evaluateCaptureQualityForStep(pixels, 192, 256, stepFor('frontFull'));
    // The dim frame is too dark for a flat front shot…
    expect(frontResult.brightnessOK).toBe(false);
    expect(frontResult.reason).toBe('too_dark');
    // …but passes the relaxed surface brightness floor.
    expect(surfaceResult.brightnessOK).toBe(true);
  });
});

describe('CAPTURE_FEEDBACK_COPY', () => {
  it('has copy for every feedback reason', () => {
    const reasons = [
      'great',
      'too_dark',
      'over_exposed',
      'blurry',
      'off_center',
      'no_card_detected',
    ] as const;
    for (const reason of reasons) {
      expect(typeof CAPTURE_FEEDBACK_COPY[reason]).toBe('string');
      expect(CAPTURE_FEEDBACK_COPY[reason].length).toBeGreaterThan(0);
    }
  });
});
