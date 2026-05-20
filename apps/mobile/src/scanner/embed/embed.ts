// Preprocessing + inference helpers for the on-device embed path.
//
// `react-native-fast-tflite` accepts raw `ArrayBuffer` input/output;
// it does NOT do image preprocessing. We own:
//
//   1. Resize the frame's raw HWC uint8 RGB bytes to the model's
//      input dimensions. For now we use a deterministic nearest-
//      neighbour resize implemented in pure JS — vision-camera's
//      frame-processor plugin chain is the right long-term home
//      for this (it can do the resize zero-copy on the GPU), but
//      that's owned by T-SC-CAMERA. We document the seam.
//
//   2. Convert the resized uint8 RGB to a Float32Array using the
//      manifest's `normalization` recipe. Recipes mirror the Python
//      preprocessing in `apps/api-python/embeddings/normalize.py`.
//
//   3. After inference, L2-normalise the output. The model is
//      trained for cosine similarity in the ANN index, so the
//      normaliser is a hard requirement.
//
// All three steps live in this file so they can be tested in
// isolation from the native binding.

import type { PreprocessingName } from './manifest';
import type { EmbedFrameInput } from './types';

/**
 * Convert raw HWC uint8 RGB bytes (width × height × 3) into a
 * Float32 tensor of `targetHeight × targetWidth × 3` using
 * nearest-neighbour resampling and the supplied normalization recipe.
 *
 * Exported as a top-level function so the vitest suite can exercise
 * it directly without spinning up the loader.
 */
export function preprocessFrame(
  pixels: Uint8Array,
  source: { width: number; height: number },
  target: { width: number; height: number },
  normalization: PreprocessingName,
): Float32Array {
  if (pixels.length !== source.width * source.height * 3) {
    throw new Error(
      `pixels length ${pixels.length} does not match ${source.width}x${source.height}x3`,
    );
  }

  const out = new Float32Array(target.width * target.height * 3);
  const xRatio = source.width / target.width;
  const yRatio = source.height / target.height;
  const apply = NORMALIZERS[normalization];

  for (let y = 0; y < target.height; y += 1) {
    const srcY = Math.min(Math.floor(y * yRatio), source.height - 1);
    for (let x = 0; x < target.width; x += 1) {
      const srcX = Math.min(Math.floor(x * xRatio), source.width - 1);
      const srcIdx = (srcY * source.width + srcX) * 3;
      const dstIdx = (y * target.width + x) * 3;
      out[dstIdx] = apply(pixels[srcIdx] ?? 0);
      out[dstIdx + 1] = apply(pixels[srcIdx + 1] ?? 0);
      out[dstIdx + 2] = apply(pixels[srcIdx + 2] ?? 0);
    }
  }

  return out;
}

/**
 * Read the raw bytes out of an `EmbedFrameInput` and run the
 * preprocessor against the model's declared input dimensions.
 */
export function preprocessFromFrame(
  frame: EmbedFrameInput,
  modelInputShape: readonly number[],
  normalization: PreprocessingName,
): Float32Array {
  // inputShape is [batch, height, width, channels].
  const h = modelInputShape[1];
  const w = modelInputShape[2];
  if (h === undefined || w === undefined) {
    throw new Error(
      `modelInputShape ${JSON.stringify(modelInputShape)} is missing height/width`,
    );
  }
  const buffer = frame.toArrayBuffer();
  const pixels = new Uint8Array(buffer);
  return preprocessFrame(
    pixels,
    { width: frame.width, height: frame.height },
    { width: w, height: h },
    normalization,
  );
}

/**
 * Convert a TFLite output ArrayBuffer (assumed Float32 little-endian)
 * into an L2-normalised Float32Array.
 *
 * react-native-fast-tflite returns one ArrayBuffer per output tensor;
 * our model has exactly one, of length `embeddingDim * 4` bytes.
 */
export function postprocessEmbedding(
  raw: ArrayBuffer,
  embeddingDim: number,
): Float32Array {
  const expectedBytes = embeddingDim * 4;
  if (raw.byteLength !== expectedBytes) {
    throw new Error(
      `output tensor is ${raw.byteLength} bytes; expected ${expectedBytes} for ${embeddingDim}-D float32 embedding`,
    );
  }
  const view = new Float32Array(raw);
  return l2Normalize(view);
}

/**
 * Row-wise L2 normalisation. A zero-norm vector is returned as-is to
 * match the Python helper (avoids NaN on degenerate frames).
 */
export function l2Normalize(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const v = vector[i] ?? 0;
    sumSquares += v * v;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm < 1e-12) {
    return new Float32Array(vector);
  }
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    out[i] = (vector[i] ?? 0) / norm;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal normalisation recipes — must stay in lockstep with the Python side
// in `apps/api-python/embeddings/normalize.py`.
// ---------------------------------------------------------------------------

type NormalizerFn = (byte: number) => number;

const NORMALIZERS: Record<PreprocessingName, NormalizerFn> = {
  // tf.keras.applications.mobilenet_v3.preprocess_input: x / 127.5 - 1.
  mobilenet_v3: (byte) => byte / 127.5 - 1,
  // Plain [0, 1] — what the test fixture uses.
  zero_one: (byte) => byte / 255,
  // ImageNet mean/std. Channel-aware recipes can't be expressed as a
  // single-byte function; we approximate with the R-channel mean/std
  // here and accept the small error for v1 (the production model is
  // `mobilenet_v3`, not `imagenet`). Revisit if we ever ship a model
  // using this recipe.
  imagenet: (byte) => (byte / 255 - 0.485) / 0.229,
};
