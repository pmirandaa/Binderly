// Rectangle detection from row + column gradient activity
// profiles.
//
// The algorithm is a "first-from-each-side over threshold" scan:
//
//   1. Compute a threshold for each profile = `max * ratio`,
//      clamped at a noise floor.
//   2. Scan from each boundary (left, right, top, bottom) until we
//      find the first position whose activity exceeds the
//      threshold. Those four positions bound the rect.
//
// This is intentionally simple. For a well-framed card on a
// contrasting surface it produces a tight bounding rect; for a
// uniform / noisy frame it produces a degenerate rect that the
// quality gate rejects.

import {
  RECT_ACTIVITY_FLOOR,
  RECT_ACTIVITY_THRESHOLD_RATIO,
} from './constants.js';

import type { ActivityProfiles } from './gradient.js';
import type { Rect } from './types.js';

/**
 * Result of {@link findRectFromProjections}. `valid` is `false`
 * when no peak in either profile exceeds the noise floor — i.e.
 * the frame has no usable edges. Callers should treat the rect
 * as a sentinel in that case.
 */
export interface RectDetection {
  readonly rect: Rect;
  readonly valid: boolean;
}

interface FindRectOptions {
  /** Override {@link RECT_ACTIVITY_THRESHOLD_RATIO} for tests. */
  readonly thresholdRatio?: number;
  /** Override {@link RECT_ACTIVITY_FLOOR} for tests. */
  readonly activityFloor?: number;
}

/**
 * Locate the bounding rect in **grid space** from the row/column
 * activity profiles. Coordinates are inclusive on both sides; the
 * returned `Rect` has `width = right - left + 1` etc.
 *
 * If either profile's peak falls below the noise floor we return
 * `valid: false` with a zero-rect sentinel. This is the common
 * "no card in view" path — the camera is pointed at a uniform
 * surface and there is no edge to lock onto.
 */
export function findRectFromProjections(
  profiles: ActivityProfiles,
  options: FindRectOptions = {},
): RectDetection {
  'worklet';
  const { rowActivity, colActivity, width, height } = profiles;
  const ratio = options.thresholdRatio ?? RECT_ACTIVITY_THRESHOLD_RATIO;
  const floor = options.activityFloor ?? RECT_ACTIVITY_FLOOR;

  // peakOf walks a typed array once; cheaper than spreading into
  // Math.max for the larger profiles we operate on.
  function peakOf(profile: Float32Array): number {
    let peak = 0;
    for (let i = 0; i < profile.length; i += 1) {
      const v = profile[i] ?? 0;
      if (v > peak) peak = v;
    }
    return peak;
  }

  const rowPeak = peakOf(rowActivity);
  const colPeak = peakOf(colActivity);

  // The "no usable edge" sentinel. The quality gate flags this
  // as a rejection (`rectValid: false` → `accepted: false`) but
  // we still return populated quality metrics so the telemetry
  // sink can report *why* the frame was rejected.
  if (rowPeak < floor || colPeak < floor) {
    return { rect: ZERO_RECT, valid: false };
  }

  const rowThreshold = rowPeak * ratio;
  const colThreshold = colPeak * ratio;

  // Scan inward from each boundary. The inclusive-on-both-sides
  // posture is intentional: card edges typically span 2-3 pixels
  // after downsampling, and we want the rect to cover the full
  // span.
  let top = 0;
  while (top < height && (rowActivity[top] ?? 0) < rowThreshold) top += 1;
  let bottom = height - 1;
  while (bottom > top && (rowActivity[bottom] ?? 0) < rowThreshold) bottom -= 1;
  let left = 0;
  while (left < width && (colActivity[left] ?? 0) < colThreshold) left += 1;
  let right = width - 1;
  while (right > left && (colActivity[right] ?? 0) < colThreshold) right -= 1;

  // Degenerate result: every entry of one profile fell below the
  // threshold (impossible by construction once we've cleared the
  // floor check, but defend against pathological inputs).
  if (top >= bottom || left >= right) {
    return { rect: ZERO_RECT, valid: false };
  }

  return {
    rect: {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    },
    valid: true,
  };
}

/**
 * Rescale a rect from grid space `(gridW × gridH)` to the source
 * frame's pixel coordinates `(srcW × srcH)`. The inverse of the
 * downsample step. Output coordinates are clamped to the source
 * extents.
 */
export function scaleRectToSource(
  rect: Rect,
  gridW: number,
  gridH: number,
  srcW: number,
  srcH: number,
): Rect {
  'worklet';
  if (gridW <= 0 || gridH <= 0) {
    throw new Error(
      `scaleRectToSource: grid dimensions must be positive (got ${gridW}×${gridH})`,
    );
  }
  // Each grid cell `i` maps to the half-open source interval
  // `[i * scale, (i + 1) * scale)`. A grid rect spanning grid
  // cells `[x, x + width)` therefore covers source pixels
  // `[x * scale, (x + width) * scale)`. We round to ints by
  // flooring the left/top edges and ceiling the right/bottom
  // edges so the source rect contains every grid cell.
  const xScale = srcW / gridW;
  const yScale = srcH / gridH;
  const xLeft = Math.max(0, Math.floor(rect.x * xScale));
  const yTop = Math.max(0, Math.floor(rect.y * yScale));
  const xRightExclusive = Math.min(srcW, Math.ceil((rect.x + rect.width) * xScale));
  const yBottomExclusive = Math.min(srcH, Math.ceil((rect.y + rect.height) * yScale));
  return {
    x: xLeft,
    y: yTop,
    width: Math.max(0, xRightExclusive - xLeft),
    height: Math.max(0, yBottomExclusive - yTop),
  };
}

/**
 * The "no rect detected" sentinel. Exported because both the
 * detect-pipeline and the quality-gate code reference it.
 */
export const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };
