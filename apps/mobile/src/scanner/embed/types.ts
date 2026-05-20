// Shared types for the on-device embedding pipeline.
//
// The mobile-side scanner stages all flow through this module's
// `EmbeddingModelHandle` interface. T-SC-MATCH consumes the handle's
// `embed` function; T-SC-CAMERA produces the `EmbedFrameInput`.
//
// We DELIBERATELY keep `EmbedFrameInput` minimal — a structurally
// typed shape that overlaps with both `react-native-vision-camera`'s
// `Frame` and the test fixtures. The actual `Frame` type lands in
// T-SC-CAMERA; this file accepts anything that exposes `width`,
// `height`, and a `toArrayBuffer()` returning the raw pixel bytes.

/** Which TFLite delegate the loaded model is actually using. */
export type InferenceDelegate = 'gpu' | 'cpu';

/**
 * Minimal contract for a camera-pipeline frame. Wide enough to be
 * implemented by `react-native-vision-camera`'s `Frame` *and* by
 * the test doubles in the vitest suite without importing the native
 * module type graph.
 */
export interface EmbedFrameInput {
  readonly width: number;
  readonly height: number;
  /**
   * Raw pixel bytes. The on-device loader will resize this to the
   * model's `inputShape` before running inference. The bytes layout
   * is expected to be HWC uint8 RGB (vision-camera's frame processor
   * worklets emit this after a `crop` plugin). Test fixtures
   * synthesise an `ArrayBuffer` directly.
   */
  toArrayBuffer(): ArrayBuffer;
}

/**
 * Per-inference telemetry emitted by `EmbeddingModelHandle.embed`.
 *
 * T-SC-MATCH subscribes (via the EmbedTelemetry emitter in
 * `./telemetry.ts`) so we can warn the user if scans are slow.
 */
export interface EmbedTelemetryEvent {
  /** Wall-clock milliseconds spent inside `embed(frame)`. */
  durationMs: number;
  /** Which delegate the model is using (set at load time, constant). */
  delegate: InferenceDelegate;
  /** Pixel area of the input frame — useful for offline analysis. */
  framePixels: number;
}

/**
 * The handle returned by `loadEmbeddingModel`. Owned by the scanner
 * screen; freed via `dispose()` on unmount.
 */
export interface EmbeddingModelHandle {
  /** The L2-normalised embedding length the model emits. */
  readonly embeddingDim: number;

  /** Which delegate ended up active (after the GPU→CPU fallback). */
  readonly delegate: InferenceDelegate;

  /** Convenience: `delegate === 'gpu'` — for telemetry surfaces. */
  readonly isUsingGpu: boolean;

  /** Model identity, copied verbatim from the manifest. */
  readonly modelName: string;
  readonly modelVersion: string;

  /**
   * Run inference on a single frame. Returns an L2-normalised
   * `Float32Array` of length `embeddingDim`.
   *
   * The function throws if the model has been disposed or if the
   * underlying TFLite call rejects (e.g. ArrayBuffer wrong size).
   * Callers should treat throws as recoverable — usually by skipping
   * the frame.
   */
  embed(frame: EmbedFrameInput): Promise<Float32Array>;

  /** Release native handles. Safe to call multiple times. */
  dispose(): void;
}
