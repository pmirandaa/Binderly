// Public types for the card-detection layer.
//
// Kept narrow and readonly because they form the contract that
// T-SC-MATCH docks onto. Changes here ripple downstream.

/**
 * Axis-aligned bounding rectangle in source-frame pixel
 * coordinates. `x` / `y` are the top-left corner (image
 * convention: y grows downward); `width` / `height` are positive
 * pixel extents. A rect with non-positive `width` or `height` is
 * a sentinel "no rect detected" value — callers check
 * {@link DetectionResult.rectValid} instead of probing the rect
 * directly.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Quality metrics computed inside the detected rect. Each metric
 * is reported alongside a boolean `*OK` flag so callers can
 * surface the actual numeric reason for a rejection in telemetry.
 *
 * Three failure modes get their own flag:
 *
 * - `sharpnessOK`: mean absolute gradient ≥ `QUALITY_SHARPNESS_MIN`.
 * - `brightnessOK`: mean luminance in
 *   `[QUALITY_BRIGHTNESS_MIN, QUALITY_BRIGHTNESS_MAX]`.
 * - `aspectOK`: detected rect aspect inside
 *   `[CARD_ASPECT_MIN, CARD_ASPECT_MAX]` AND portrait orientation
 *   (height ≥ width). Landscape orientation fails this flag for
 *   v1 — see the elaborated task brief, "Out of scope".
 */
export interface QualityMetrics {
  /** Mean absolute gradient inside the rect (0-255 luminance scale). */
  readonly sharpness: number;
  /** Mean luminance inside the rect, normalised to `[0, 1]`. */
  readonly brightness: number;
  /** `max(h, w) / min(h, w)` of the detected rect. */
  readonly aspectRatio: number;
  /** `true` iff the rect's height ≥ its width (portrait card). */
  readonly portraitOrientation: boolean;
  readonly sharpnessOK: boolean;
  readonly brightnessOK: boolean;
  readonly aspectOK: boolean;
}

/**
 * Result of a single-frame detection pass. The shape is friendly
 * to a worklet-side `runOnJS` hop because every field is a JSON
 * scalar or a typed-array (structurally cloneable).
 *
 * - `rect` always populated, even when `rectValid` is `false`
 *   (the sentinel is `{ x: 0, y: 0, width: 0, height: 0 }`).
 * - `quality` always populated so telemetry can be plotted even
 *   for rejected frames.
 * - `cropped` is `null` when `accepted === false` — this is the
 *   key short-circuit that keeps the embedding-budget out of the
 *   blurry/cut-off path. When non-null, it is a Float32Array of
 *   length `CROP_TENSOR_SIZE² · 3` normalised to `[-1, +1]` per
 *   the mobilenet_v3 recipe.
 */
export interface DetectionResult {
  readonly rect: Rect;
  readonly rectValid: boolean;
  readonly quality: QualityMetrics;
  readonly accepted: boolean;
  readonly cropped: Float32Array | null;
}

/**
 * Input to {@link detectCard}. Decoupled from
 * `vision-camera`'s `Frame` so the pure detection logic can be
 * unit-tested against synthetic pixel buffers without depending
 * on the native module.
 *
 * `pixels` is expected to be **HWC uint8 RGB** — the same byte
 * layout T-SC-EMBED-MODEL's `EmbedFrameInput.toArrayBuffer()`
 * promises. The detection layer never copies the buffer; it
 * reads it in-place. Callers (the worklet adapter) own the
 * lifetime of the underlying buffer.
 */
export interface DetectionInput {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Structural subset of a vision-camera `Frame` the detect-layer
 * worklet adapter reads. Wide enough to accept the real
 * production frame *and* the test fixtures, narrow enough to
 * avoid dragging in the `vision-camera` type graph.
 */
export interface DetectFrameLike {
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow?: number;
  readonly timestamp?: number;
  toArrayBuffer(): ArrayBuffer;
}

/**
 * Event the detection worklet forwards to the JS thread via
 * `useRunOnJS`. We include the `accepted` flag and the
 * `quality` block so subscribers can render a "frame rejected
 * for X" hint even before the embedding stage runs.
 *
 * The optional `cropped` is `null` when the frame was rejected
 * and a typed-array buffer otherwise. We deliberately ship the
 * tensor over the `runOnJS` bridge as a `Float32Array` because
 * the worklets-core JSI runtime preserves typed-array identity —
 * no expensive structured-clone copy.
 */
export interface DetectionEvent {
  /** Monotonic worklet-side timestamp the frame was observed at. */
  readonly ts: number;
  readonly rect: Rect;
  readonly rectValid: boolean;
  readonly quality: QualityMetrics;
  readonly accepted: boolean;
  readonly cropped: Float32Array | null;
}

/**
 * JS-thread bus the worklet hops onto via `useRunOnJS`. Mirrors
 * the camera task's `FrameTelemetrySink` posture — subscriber
 * pattern; one bus per scan-screen mount.
 */
export interface DetectionSink {
  /** Record a detection event arriving from the worklet. */
  observe(event: DetectionEvent): void;
  /** Subscribe to updates. Returns an unsubscribe function. */
  subscribe(listener: DetectionListener): () => void;
  /** Most recent event, or `null` when none yet observed. */
  last(): DetectionEvent | null;
  /** Drop the cached last-event. */
  clear(): void;
}

export type DetectionListener = (event: DetectionEvent) => void;
