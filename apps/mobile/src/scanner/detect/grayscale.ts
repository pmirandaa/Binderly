// Grayscale conversion + downsampling.
//
// The detection pipeline operates on a small grayscale projection
// of the frame for two reasons:
//
//   1. Card-edge detection cares about luminance, not chrominance.
//      Converting RGB → grayscale lets us collapse 3× bytes into
//      1× before the gradient pass.
//   2. The analysis grid is much smaller than typical camera
//      resolutions (96×128 vs. 1920×1080), so the per-frame work
//      is bounded by the grid size, not the source resolution.
//
// Both helpers are pure functions over typed arrays — no closures,
// no async, worklet-safe by construction.

/**
 * Convert an HWC uint8 RGB pixel buffer to a flat uint8 grayscale
 * buffer of length `width * height`. Uses Rec. 601 luma
 * coefficients (`0.299 R + 0.587 G + 0.114 B`), the same recipe
 * every common demosaicer and JPEG decoder uses — it preserves
 * perceived brightness against the human visual system.
 *
 * Throws if `pixels.length` does not match `width * height * 3`.
 */
export function rgbToGrayscale(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  'worklet';
  const expected = width * height * 3;
  if (pixels.length !== expected) {
    throw new Error(
      `rgbToGrayscale: pixels length ${pixels.length} does not match ${width}×${height}×3 (= ${expected})`,
    );
  }
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 3, j += 1) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    // 0.299 R + 0.587 G + 0.114 B, rounded to nearest integer.
    // Integer-domain math via fixed-point coefficients keeps the
    // pure-JS hot path branch-light.
    out[j] = (r * 77 + g * 150 + b * 29 + 128) >> 8;
  }
  return out;
}

/**
 * Nearest-neighbour downsample a grayscale buffer from
 * `(srcW, srcH)` to `(dstW, dstH)`. Returns a fresh Uint8Array of
 * length `dstW * dstH`. We deliberately pick nearest-neighbour
 * over bilinear: the detection pipeline cares about edge
 * positions, not smoothed pixel values, and nearest preserves
 * edges sharply.
 *
 * The function does not allocate scratch space beyond the output
 * buffer. Throws if any dimension is non-positive.
 */
export function downsampleGrayscale(
  gray: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  'worklet';
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    throw new Error(
      `downsampleGrayscale: all dimensions must be positive, got src=${srcW}×${srcH} dst=${dstW}×${dstH}`,
    );
  }
  if (gray.length !== srcW * srcH) {
    throw new Error(
      `downsampleGrayscale: gray length ${gray.length} does not match ${srcW}×${srcH}`,
    );
  }
  const out = new Uint8Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
    const srcRow = srcY * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x += 1) {
      const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
      out[dstRow + x] = gray[srcRow + srcX] ?? 0;
    }
  }
  return out;
}
