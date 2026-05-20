// Crop the source frame to the detected rect, resize to the
// model's tensor size, and normalise per the mobilenet_v3 recipe.
//
// The output is drop-in for T-SC-EMBED-MODEL's `embed(frame)`
// call: a `Float32Array` of length `tensorSize² · 3` with values
// in `[-1, +1]` (matching
// `tf.keras.applications.mobilenet_v3.preprocess_input`).
//
// We deliberately re-implement the mobilenet_v3 normalisation
// locally rather than import the embed module's helper — the two
// modules live in disjoint owns_paths (`scanner/detect/` vs.
// `scanner/embed/`) and we don't want a cross-module dependency
// on the worklet hot path. A regression test in `crop.test.ts`
// cross-checks the two recipes byte-for-byte.

import { CROP_TENSOR_SIZE } from './constants.js';

import type { Rect } from './types.js';

/**
 * MobileNetV3 preprocessing recipe: `x / 127.5 - 1`. Output range
 * is `[-1, +1]` for input range `[0, 255]`. Re-implemented locally;
 * see file-level comment.
 *
 * Exported so the regression test in `crop.test.ts` can call it
 * directly and the cross-module identity check is explicit.
 */
export function normalizeMobilenetV3(byte: number): number {
  'worklet';
  return byte / 127.5 - 1;
}

/**
 * Crop the source pixels to `rect`, resize with nearest-neighbour
 * to `tensorSize × tensorSize`, and normalise to Float32 in
 * `[-1, +1]`.
 *
 * - `pixels` MUST be HWC uint8 RGB of length `srcW × srcH × 3`.
 * - The rect is in source-frame pixel coords. We do NOT clip /
 *   warp — callers must provide an in-bounds rect; the detection
 *   pipeline guarantees this by clamping inside
 *   `scaleRectToSource`.
 * - `tensorSize` defaults to {@link CROP_TENSOR_SIZE} (224) so
 *   the output drops in to MobileNetV3-Small.
 *
 * Returns a `Float32Array` of length `tensorSize² · 3`.
 */
export function cropAndNormalize(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  rect: Rect,
  tensorSize: number = CROP_TENSOR_SIZE,
): Float32Array {
  'worklet';
  if (pixels.length !== srcW * srcH * 3) {
    throw new Error(
      `cropAndNormalize: pixels length ${pixels.length} does not match ${srcW}×${srcH}×3`,
    );
  }
  if (tensorSize <= 0) {
    throw new Error(`cropAndNormalize: tensorSize must be positive, got ${tensorSize}`);
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(
      `cropAndNormalize: degenerate rect (${rect.width}×${rect.height}); detect-layer should filter these out`,
    );
  }

  const out = new Float32Array(tensorSize * tensorSize * 3);
  // We resample directly from the source pixels using
  // nearest-neighbour. Two-step (crop, then resize) would
  // allocate an intermediate buffer; one-step skips it.
  const xRatio = rect.width / tensorSize;
  const yRatio = rect.height / tensorSize;
  for (let dy = 0; dy < tensorSize; dy += 1) {
    const srcY = Math.min(rect.y + Math.floor(dy * yRatio), srcH - 1);
    const srcRowStart = srcY * srcW * 3;
    const dstRowStart = dy * tensorSize * 3;
    for (let dx = 0; dx < tensorSize; dx += 1) {
      const srcX = Math.min(rect.x + Math.floor(dx * xRatio), srcW - 1);
      const srcI = srcRowStart + srcX * 3;
      const dstI = dstRowStart + dx * 3;
      out[dstI] = normalizeMobilenetV3(pixels[srcI] ?? 0);
      out[dstI + 1] = normalizeMobilenetV3(pixels[srcI + 1] ?? 0);
      out[dstI + 2] = normalizeMobilenetV3(pixels[srcI + 2] ?? 0);
    }
  }
  return out;
}
