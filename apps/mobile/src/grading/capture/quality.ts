// Per-capture quality validation.
//
// Pure function over a raw RGB pixel buffer. Used by both the
// hook (after `takePhoto()` reads the still and decodes it) and
// the synthetic vitest fixtures (we generate small RGB buffers
// in-test and pass them straight in).
//
// The algorithm intentionally mirrors the scanner-side
// gradient-projection sharpness measurement so the two surfaces
// stay in conceptual lockstep:
//
//   1. Convert RGB → grayscale via Rec. 601 luma (77/150/29).
//   2. Optionally downsample to `CAPTURE_GRID_WIDTH × CAPTURE_GRID_HEIGHT`.
//   3. Mean luminance → brightness gate (0..1 normalised).
//   4. Two-tap symmetric finite difference → gradient field.
//   5. Mean gradient → sharpness gate.
//   6. Fraction of grid pixels whose gradient exceeds
//      `CAPTURE_COVERAGE_ACTIVITY_RATIO * max(gradient)` →
//      coverage gate. This proxies "is the card filling the frame"
//      without paying the cost of full rectangle detection — the
//      capture flow only needs a pass/fail signal, not a polygon.
//
// All math is integer-light and allocates a single grid buffer +
// a single gradient buffer per call. No closures, no async,
// worklet-safe by construction (though we don't actually invoke
// from a worklet in the capture flow — the `takePhoto()` callback
// runs on the JS thread).

import {
  CAPTURE_BRIGHTNESS_MAX,
  CAPTURE_BRIGHTNESS_MIN,
  CAPTURE_COVERAGE_ACTIVITY_RATIO,
  CAPTURE_GRID_HEIGHT,
  CAPTURE_GRID_WIDTH,
  CAPTURE_SHARPNESS_MIN,
} from './constants.js';

import type {
  CaptureFeedbackReason,
  CaptureQualityMetrics,
  CaptureQualityResult,
  GradingShotKind,
} from './types.js';

/**
 * Options accepted by {@link evaluateCaptureQuality}. The defaults
 * match the per-shot gate from `constants.ts` + each step's
 * `coverageMin`. Tests can pass overrides to pin per-axis
 * behaviour without mutating module-level state.
 */
export interface QualityEvaluationOptions {
  readonly coverageMin: number;
  readonly sharpnessMin?: number;
  readonly brightnessMin?: number;
  readonly brightnessMax?: number;
  readonly activityRatio?: number;
  /** Downsample to this width before evaluation. Defaults to grid width. */
  readonly gridWidth?: number;
  /** Downsample to this height before evaluation. Defaults to grid height. */
  readonly gridHeight?: number;
}

/**
 * Evaluate a single capture's quality. Pixel buffer is an HWC
 * `Uint8Array` of length `width * height * 3` (RGB, no alpha).
 *
 * Returns a populated {@link CaptureQualityResult}: every metric
 * is real (we never short-circuit), every per-axis OK flag is set,
 * and the `reason` is the **highest-priority** failure surfaced to
 * the UI (or `'great'` on pass). Priority order is brightness →
 * sharpness → coverage; we surface the most-actionable failure
 * first so the user fixes the easiest thing.
 *
 * Throws if the pixel buffer length doesn't match `width × height × 3`.
 */
export function evaluateCaptureQuality(
  pixels: Uint8Array,
  width: number,
  height: number,
  options: QualityEvaluationOptions,
): CaptureQualityResult {
  if (width <= 0 || height <= 0) {
    throw new Error(
      `evaluateCaptureQuality: width and height must be positive, got ${width}×${height}`,
    );
  }
  const expected = width * height * 3;
  if (pixels.length !== expected) {
    throw new Error(
      `evaluateCaptureQuality: pixels length ${pixels.length} does not match ${width}×${height}×3 (= ${expected})`,
    );
  }

  const dstW = options.gridWidth ?? CAPTURE_GRID_WIDTH;
  const dstH = options.gridHeight ?? CAPTURE_GRID_HEIGHT;
  const sharpnessMin = options.sharpnessMin ?? CAPTURE_SHARPNESS_MIN;
  const brightnessMin = options.brightnessMin ?? CAPTURE_BRIGHTNESS_MIN;
  const brightnessMax = options.brightnessMax ?? CAPTURE_BRIGHTNESS_MAX;
  const activityRatio = options.activityRatio ?? CAPTURE_COVERAGE_ACTIVITY_RATIO;

  // Always reduce to the analysis grid even when the source is
  // smaller — keeps the gate consistent regardless of the camera
  // resolution the device decides to give us.
  const gray = projectRgbToGrayscale(pixels, width, height, dstW, dstH);

  const metrics = computeMetrics(gray, dstW, dstH, activityRatio);

  const brightnessOK =
    metrics.brightness >= brightnessMin && metrics.brightness <= brightnessMax;
  const sharpnessOK = metrics.sharpness >= sharpnessMin;
  const coverageOK = metrics.coverage >= options.coverageMin;
  const accepted = brightnessOK && sharpnessOK && coverageOK;

  const reason = pickReason({
    metrics,
    brightnessOK,
    sharpnessOK,
    coverageOK,
    accepted,
    brightnessMin,
    brightnessMax,
  });

  return {
    metrics,
    sharpnessOK,
    brightnessOK,
    coverageOK,
    accepted,
    reason,
  };
}

/**
 * Convenience wrapper that picks the gate options from the per-
 * kind step definition. Used by the screen layer; tests call
 * {@link evaluateCaptureQuality} directly with explicit options
 * so each test pins exactly the threshold it cares about.
 */
export function evaluateCaptureQualityForKind(
  pixels: Uint8Array,
  width: number,
  height: number,
  kind: GradingShotKind,
  coverageMinByKind: Readonly<Record<GradingShotKind, number>>,
): CaptureQualityResult {
  return evaluateCaptureQuality(pixels, width, height, {
    coverageMin: coverageMinByKind[kind],
  });
}

// --- internals -------------------------------------------------------

/**
 * RGB → grayscale + nearest-neighbour downsample in one pass.
 * Returns a Uint8Array of length `dstW * dstH`. Avoids the
 * intermediate full-resolution grayscale buffer that
 * `scanner/detect/grayscale.ts` allocates because the capture
 * flow always wants the downsampled output — paying for both
 * doubles the per-shot allocation for no benefit.
 */
function projectRgbToGrayscale(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
    const srcRow = srcY * srcW * 3;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x += 1) {
      const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
      const i = srcRow + srcX * 3;
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      // 0.299 R + 0.587 G + 0.114 B, fixed-point ÷ 256, +128 round.
      out[dstRow + x] = (r * 77 + g * 150 + b * 29 + 128) >> 8;
    }
  }
  return out;
}

type ComputedMetrics = CaptureQualityMetrics;

function computeMetrics(
  gray: Uint8Array,
  width: number,
  height: number,
  activityRatio: number,
): ComputedMetrics {
  const count = gray.length;
  if (count === 0) {
    return { sharpness: 0, brightness: 0, coverage: 0 };
  }

  // Mean luminance — one pass, sum + divide.
  let sumGray = 0;
  for (let i = 0; i < count; i += 1) {
    sumGray += gray[i] ?? 0;
  }
  const brightness = sumGray / count / 255;

  // Gradient field — same symmetric two-tap finite difference the
  // scanner uses. Boundary pixels left at zero.
  const grad = new Uint8Array(count);
  let maxGrad = 0;
  let sumGrad = 0;
  let gradCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    const rowAbove = (y - 1) * width;
    const rowBelow = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const left = gray[row + (x - 1)] ?? 0;
      const right = gray[row + (x + 1)] ?? 0;
      const above = gray[rowAbove + x] ?? 0;
      const below = gray[rowBelow + x] ?? 0;
      const sum = Math.abs(right - left) + Math.abs(below - above);
      const clamped = sum > 255 ? 255 : sum;
      grad[i] = clamped;
      sumGrad += clamped;
      gradCount += 1;
      if (clamped > maxGrad) maxGrad = clamped;
    }
  }
  const sharpness = gradCount === 0 ? 0 : sumGrad / gradCount;

  // Coverage — fraction of interior pixels above the relative
  // threshold. When `maxGrad` is zero (uniform field) coverage is
  // also zero, which is the right "no card detected" signal.
  let coveredCount = 0;
  if (maxGrad > 0 && gradCount > 0) {
    const threshold = activityRatio * maxGrad;
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const i = row + x;
        if ((grad[i] ?? 0) >= threshold) coveredCount += 1;
      }
    }
  }
  const coverage = gradCount === 0 ? 0 : coveredCount / gradCount;

  return { sharpness, brightness, coverage };
}

interface PickReasonInput {
  readonly metrics: ComputedMetrics;
  readonly brightnessOK: boolean;
  readonly sharpnessOK: boolean;
  readonly coverageOK: boolean;
  readonly accepted: boolean;
  readonly brightnessMin: number;
  readonly brightnessMax: number;
}

function pickReason(input: PickReasonInput): CaptureFeedbackReason {
  if (input.accepted) return 'great';
  // Zero-coverage frames are the most informative failure — surface
  // it before brightness / sharpness so the user knows the camera
  // is pointed at nothing useful (e.g. blank wall, lens-on-table).
  if (input.metrics.coverage <= 0.001) return 'no_card_detected';
  if (!input.brightnessOK) {
    return input.metrics.brightness < input.brightnessMin
      ? 'too_dark'
      : 'over_exposed';
  }
  if (!input.sharpnessOK) return 'blurry';
  if (!input.coverageOK) return 'off_center';
  // Defensive: every failure path is enumerated above. If we get
  // here the input is inconsistent (e.g. `accepted: false` but all
  // OK flags true). Surface as a coverage problem — the cheapest
  // thing for the user to re-frame.
  return 'off_center';
}

/**
 * UI copy for a feedback reason. Kept here so the screen + tests
 * read the same source of truth and copy tweaks don't drift.
 */
export const CAPTURE_FEEDBACK_COPY: Readonly<Record<CaptureFeedbackReason, string>> = {
  great: 'Looks great — tap capture',
  too_dark: 'Too dark — move to brighter light',
  over_exposed: 'Too bright — avoid direct glare',
  blurry: 'Blurry — hold the phone steady',
  off_center: 'Off-center — fill the frame with the card',
  no_card_detected: 'No card detected — point at the card',
};
