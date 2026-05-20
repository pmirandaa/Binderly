// Quality-gate metrics evaluated inside the detected rect.
//
// The quality gate is what keeps the embedding-budget out of the
// blurry / dark / mis-framed path. Each metric is computed inside
// the rect — not whole-frame — so a blurry card on a sharp
// background is correctly flagged as low-sharpness rather than
// being saved by the background's detail.

import {
  CARD_ASPECT_MAX,
  CARD_ASPECT_MIN,
  QUALITY_BRIGHTNESS_MAX,
  QUALITY_BRIGHTNESS_MIN,
  QUALITY_SHARPNESS_MIN,
} from './constants.js';

import type { GradientField } from './gradient.js';
import type { QualityMetrics, Rect } from './types.js';

interface QualityOptions {
  readonly sharpnessMin?: number;
  readonly brightnessMin?: number;
  readonly brightnessMax?: number;
  readonly aspectMin?: number;
  readonly aspectMax?: number;
}

/**
 * Compute the quality metrics for a detected rect.
 *
 * - **Sharpness** is the mean of the gradient magnitude
 *   (`field.data`) over the rect's interior.
 * - **Brightness** is the mean luminance (`gray`) over the
 *   rect's interior, normalised to `[0, 1]`.
 * - **Aspect** is `max(w, h) / min(w, h)` (always ≥ 1).
 *
 * All three values are real measurements regardless of whether
 * the frame passes the gate; the boolean `*OK` flags encode
 * pass/fail using the thresholds from {@link constants.ts}.
 *
 * The rect is expected to be in **grid space** — same coordinate
 * frame as `gray` and `field`. The detection pipeline computes
 * the rect in grid space first, runs quality on it, and only
 * upscales to source coords for the final crop step.
 */
export function computeQualityMetrics(
  field: GradientField,
  gray: Uint8Array,
  rect: Rect,
  options: QualityOptions = {},
): QualityMetrics {
  'worklet';
  const sharpnessMin = options.sharpnessMin ?? QUALITY_SHARPNESS_MIN;
  const brightnessMin = options.brightnessMin ?? QUALITY_BRIGHTNESS_MIN;
  const brightnessMax = options.brightnessMax ?? QUALITY_BRIGHTNESS_MAX;
  const aspectMin = options.aspectMin ?? CARD_ASPECT_MIN;
  const aspectMax = options.aspectMax ?? CARD_ASPECT_MAX;

  const { width, height, data } = field;
  if (gray.length !== width * height) {
    throw new Error(
      `computeQualityMetrics: gray length ${gray.length} does not match ${width}×${height}`,
    );
  }

  // Degenerate-rect path: every metric reports its conservative
  // sentinel and every gate flag is false. We still return a
  // populated metrics block so the telemetry surface can show
  // the user a useful "no card detected" hint.
  if (rect.width <= 0 || rect.height <= 0) {
    return {
      sharpness: 0,
      brightness: 0,
      aspectRatio: 0,
      portraitOrientation: false,
      sharpnessOK: false,
      brightnessOK: false,
      aspectOK: false,
    };
  }

  // Clamp the rect against the grid extents. Defensive in case a
  // caller hands us a rect already in source coords by mistake;
  // we'd rather quietly degrade than throw on the hot path.
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(width, rect.x + rect.width);
  const y1 = Math.min(height, rect.y + rect.height);

  let sumGradient = 0;
  let sumGray = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    const row = y * width;
    for (let x = x0; x < x1; x += 1) {
      const i = row + x;
      sumGradient += data[i] ?? 0;
      sumGray += gray[i] ?? 0;
      count += 1;
    }
  }
  // `count` can be 0 if the clamp emptied the rect. Treat that
  // as the degenerate-rect path.
  if (count === 0) {
    return {
      sharpness: 0,
      brightness: 0,
      aspectRatio: 0,
      portraitOrientation: false,
      sharpnessOK: false,
      brightnessOK: false,
      aspectOK: false,
    };
  }

  const sharpness = sumGradient / count;
  const brightness = sumGray / count / 255;
  const w = rect.width;
  const h = rect.height;
  const longSide = w > h ? w : h;
  const shortSide = w > h ? h : w;
  const aspectRatio = longSide / shortSide;
  const portraitOrientation = h >= w;
  const aspectInRange = aspectRatio >= aspectMin && aspectRatio <= aspectMax;
  const aspectOK = portraitOrientation && aspectInRange;

  return {
    sharpness,
    brightness,
    aspectRatio,
    portraitOrientation,
    sharpnessOK: sharpness >= sharpnessMin,
    brightnessOK: brightness >= brightnessMin && brightness <= brightnessMax,
    aspectOK,
  };
}
