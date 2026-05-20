// Top-level `detectCard()` — composes the detection pipeline.
//
// This is the pure function the worklet hot path calls. It takes
// raw HWC uint8 RGB pixels + source dimensions, runs the full
// pipeline (grayscale → downsample → gradient → projection →
// rect-find → quality-gate → crop), and returns a single
// `DetectionResult` that the worklet forwards to JS.
//
// Worklet-safe by construction:
//   - No closures over JS-thread state.
//   - No async / await.
//   - No imports from outside the detect/ owns_paths.
//   - All allocations are typed-array buffers (the worklets-core
//     runtime preserves typed-array identity across the JSI
//     boundary).

import { DETECT_GRID_HEIGHT, DETECT_GRID_WIDTH } from './constants.js';
import { cropAndNormalize } from './crop.js';
import {
  computeGradientField,
  computeProjections,
} from './gradient.js';
import { downsampleGrayscale, rgbToGrayscale } from './grayscale.js';
import { computeQualityMetrics } from './quality.js';
import {
  findRectFromProjections,
  scaleRectToSource,
  ZERO_RECT,
} from './rectangle.js';

import type { DetectionInput, DetectionResult } from './types.js';

/**
 * Options the test suite uses to override constants at the entry
 * point. Production callers pass `undefined` and inherit the
 * defaults from `constants.ts`.
 */
export interface DetectCardOptions {
  readonly gridWidth?: number;
  readonly gridHeight?: number;
  readonly tensorSize?: number;
  readonly thresholdRatio?: number;
  readonly activityFloor?: number;
  readonly sharpnessMin?: number;
  readonly brightnessMin?: number;
  readonly brightnessMax?: number;
  readonly aspectMin?: number;
  readonly aspectMax?: number;
}

/**
 * Run the detection pipeline on a single frame.
 *
 * Returns a `DetectionResult` with:
 *   - `rect` / `rectValid` — bounding box in source-frame coords,
 *     or the zero-rect sentinel when no card was found.
 *   - `quality` — sharpness / brightness / aspect metrics inside
 *     the rect. Always populated (even on `rectValid === false`)
 *     so telemetry can plot rejection reasons.
 *   - `accepted` — `rectValid && sharpnessOK && brightnessOK &&
 *     aspectOK`. The single boolean the camera worklet branches on.
 *   - `cropped` — `Float32Array(224·224·3)` normalised to
 *     `[-1, +1]` when accepted; `null` otherwise (saves the
 *     embed budget).
 */
export function detectCard(
  input: DetectionInput,
  options: DetectCardOptions = {},
): DetectionResult {
  'worklet';
  const { pixels, width, height } = input;
  if (width <= 0 || height <= 0) {
    throw new Error(
      `detectCard: frame dimensions must be positive, got ${width}×${height}`,
    );
  }
  if (pixels.length !== width * height * 3) {
    throw new Error(
      `detectCard: pixels length ${pixels.length} does not match ${width}×${height}×3`,
    );
  }
  const maxGridW = options.gridWidth ?? DETECT_GRID_WIDTH;
  const maxGridH = options.gridHeight ?? DETECT_GRID_HEIGHT;
  // Pick grid dimensions that **preserve source aspect ratio** —
  // crucial for the aspect-ratio quality gate, which would
  // otherwise see a rect distorted by the grid's fixed shape.
  // The grid is bounded by `(maxGridW, maxGridH)` on each side
  // and never up-samples (if the source is already small, we
  // keep its native dimensions).
  const scaleX = maxGridW / width;
  const scaleY = maxGridH / height;
  const gridScale = Math.min(1, scaleX, scaleY);
  const effectiveGridW = Math.max(1, Math.round(width * gridScale));
  const effectiveGridH = Math.max(1, Math.round(height * gridScale));

  // 1. RGB → grayscale (source resolution).
  const grayFull = rgbToGrayscale(pixels, width, height);
  // 2. Downsample to the analysis grid.
  const gray = downsampleGrayscale(
    grayFull,
    width,
    height,
    effectiveGridW,
    effectiveGridH,
  );
  // 3. Gradient field on the grid.
  const field = computeGradientField(gray, effectiveGridW, effectiveGridH);
  // 4. Row + column projections.
  const profiles = computeProjections(field);
  // 5. Rect detection in grid space.
  const detection = findRectFromProjections(profiles, {
    thresholdRatio: options.thresholdRatio,
    activityFloor: options.activityFloor,
  });
  // 6. Quality metrics inside the grid-space rect.
  const quality = computeQualityMetrics(field, gray, detection.rect, {
    sharpnessMin: options.sharpnessMin,
    brightnessMin: options.brightnessMin,
    brightnessMax: options.brightnessMax,
    aspectMin: options.aspectMin,
    aspectMax: options.aspectMax,
  });

  const rectValid = detection.valid;
  const accepted =
    rectValid && quality.sharpnessOK && quality.brightnessOK && quality.aspectOK;

  // 7. If the gate passed, crop + normalise in source coords. We
  // upscale the rect back from grid space to source space first
  // — the crop pulls from the original full-resolution pixels so
  // the embedding sees the highest-fidelity card we have.
  let cropped: Float32Array | null = null;
  let sourceRect = ZERO_RECT;
  if (rectValid) {
    sourceRect = scaleRectToSource(
      detection.rect,
      effectiveGridW,
      effectiveGridH,
      width,
      height,
    );
  }
  if (accepted) {
    cropped = cropAndNormalize(pixels, width, height, sourceRect, options.tensorSize);
  }

  return {
    rect: sourceRect,
    rectValid,
    quality,
    accepted,
    cropped,
  };
}
