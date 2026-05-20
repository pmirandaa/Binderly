// Public types for the scanner camera infrastructure.
//
// Kept narrow and well-typed because they form the contract that
// T-SC-DETECT, T-SC-MATCH, and T-SC-UX dock onto. Breaking changes
// here ripple into every downstream task.

/**
 * Metadata about a single camera frame, forwarded from the worklet
 * thread to the JS thread.
 *
 * Crucially this is **not** the frame buffer itself — only small
 * scalars. Image bytes never cross `runOnJS` in MVP per
 * `rules/06-scanner.md` ("on-device only; no frame leaves the
 * phone"). The placeholder `processFrame()` worklet may produce
 * derived metrics in the future; whatever it returns must be
 * structurally cloneable.
 */
export interface FrameTelemetryEvent {
  /** Monotonic timestamp (ms since epoch) sampled inside the worklet. */
  readonly ts: number;
  /** Frame pixel width as reported by the camera surface. */
  readonly width: number;
  /** Frame pixel height as reported by the camera surface. */
  readonly height: number;
  /** Stride between adjacent rows in bytes; 0 when unknown. */
  readonly bytesPerRow: number;
}

/**
 * Output of the stack-mode detector. The detector watches the
 * incoming frame stream and tells the scan controller whether the
 * pipeline should treat the next stable frame as a **new** card
 * (`'reset'`) or keep merging into the in-flight match attempt
 * (`'stable'`).
 *
 * T-SC-DETECT fills in the real geometry-stability algorithm; for
 * now the detector always returns `'stable'`. The signal API is
 * already in place so T-SC-UX can wire its session counter to the
 * reset events without waiting on T-SC-DETECT.
 */
export type StackModeSignal = 'stable' | 'reset';

/**
 * The contract a `FrameTelemetrySink` exposes. The JS-side bridge
 * the frame-processor worklet hits via `runOnJS`. Subscribers
 * (FPS badge, debug overlays, future analytics) attach via
 * `subscribe()`; the sink computes a sliding-window FPS estimate
 * over the most recent frame events.
 */
export interface FrameTelemetrySink {
  /** Record a frame event arriving from the worklet. */
  observe(event: FrameTelemetryEvent): void;
  /** Subscribe to updates. Returns an unsubscribe function. */
  subscribe(listener: FrameTelemetryListener): () => void;
  /**
   * Sliding-window FPS estimate over the most recent ring of
   * events. `null` when fewer than two events have been observed
   * (no rate is meaningful with one sample).
   */
  fps(): number | null;
  /** Drop all retained samples and notify subscribers. */
  clear(): void;
}

export interface FrameTelemetryListener {
  (snapshot: FrameTelemetrySnapshot): void;
}

export interface FrameTelemetrySnapshot {
  readonly fps: number | null;
  readonly lastEvent: FrameTelemetryEvent | null;
  readonly sampleCount: number;
}
