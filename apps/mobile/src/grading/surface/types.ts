// Types for the surface sub-grade module.
//
// The Python module (`apps/api-python/grading/surface/`) is the authoritative
// implementation.  The TypeScript side ships a typed contract + v1 stub that
// returns `not_implemented`.  A future task replaces the stub with a real
// network call to the Python grading service (or on-device ONNX inference
// via `onnxruntime-react-native`; see #FU-46).
//
// Design follows T-GR-CORNERS's Python↔TS seam pattern exactly.
//
// Raking-light seam (#FU-31)
// --------------------------
// The v1 capture session (T-GR-CAPTURE-UX) ships only four shots:
// frontFull, backFull, frontCorner, backCorner.  The raking-light shot
// is deferred to T-GR-CAPTURE-FULL-SCHEMA (#FU-31).  `SurfaceRequest`
// accepts `rakingLightUri` as an OPTIONAL field so that:
//   - v1 callers omit it without any contract change.
//   - Post-#FU-31 callers add it and get improved accuracy automatically.

// ── Grade value types ────────────────────────────────────────────────

/**
 * Confidence band — uniform output shape used by all sub-grade models.
 * T-GR-AGGREGATE reads four of these.
 *
 * ``value`` is the predicted PSA sub-grade (1.0–10.0).
 * ``confidence`` is a [0.0, 1.0] estimate of model certainty.
 */
export interface ConfidenceBand {
  readonly value: number;
  readonly confidence: number;
}

/**
 * Prediction for one input shot used by the surface model.
 *
 * In v1 there are two shots: ``front_full`` and ``back_full``.
 * After #FU-31 lands a third shot ``raking_light`` is added.
 */
export interface SurfaceShotBand {
  /** Shot identifier matching the Python ``SURFACE_SHOT_LABELS_*`` constants. */
  readonly label: 'front_full' | 'back_full' | 'raking_light';
  readonly band: ConfidenceBand;
}

// ── Request / result ─────────────────────────────────────────────────

/**
 * Input to the surface grading service.
 *
 * ``frontFullUri`` and ``backFullUri`` are the full-face shot URIs captured
 * in every v1 grading session (``GradingCaptureSession.frontFull.uri`` and
 * ``GradingCaptureSession.backFull.uri``).
 *
 * ``rakingLightUri`` is **optional** — absent until the raking-light capture
 * step ships in #FU-31 (T-GR-CAPTURE-FULL-SCHEMA).  When present, the Python
 * inference engine switches to the 3-shot path for improved surface accuracy.
 * No breaking contract change is required on the caller side.
 */
export interface SurfaceRequest {
  readonly sessionId: string;
  /** Local file URI for the full front face of the card. */
  readonly frontFullUri: string;
  /** Local file URI for the full back face of the card. */
  readonly backFullUri: string;
  /**
   * Optional raking-light shot URI — improves surface accuracy by revealing
   * whitening, scratches, and print indentations.  Not captured in v1;
   * added by #FU-31 (T-GR-CAPTURE-FULL-SCHEMA).
   */
  readonly rakingLightUri?: string;
}

/**
 * Result from the surface sub-grade model.
 *
 * ``perShot`` contains one prediction per active input shot (2 in v1, 3 with
 * raking light from #FU-31).
 * ``aggregate`` is the average of per-shot predictions — consistent with PSA
 * grader practice for surface assessment.
 * ``modelVersion`` is the ONNX artifact version used for inference.
 */
export interface SurfaceResult {
  readonly sessionId: string;
  readonly perShot: ReadonlyArray<SurfaceShotBand>;
  readonly aggregate: ConfidenceBand;
  readonly modelVersion: string;
}

// ── Service contract ─────────────────────────────────────────────────

/**
 * Error reasons the surface service can return.
 *
 * - `'not_implemented'` — v1 default; service is not yet wired.  UI degrades
 *   gracefully.
 * - `'session_not_found'` — the ``sessionId`` was not found in the store.
 * - `'network_error'` — the service call failed (future remote impl).
 * - `'invalid_image'` — a provided URI could not be decoded.
 * - `'missing_required_shot'` — ``frontFullUri`` or ``backFullUri`` is absent.
 */
export type SurfaceServiceErrorReason =
  | 'not_implemented'
  | 'session_not_found'
  | 'network_error'
  | 'invalid_image'
  | 'missing_required_shot';

export interface SurfaceServiceError {
  readonly reason: SurfaceServiceErrorReason;
  readonly message: string;
}

/**
 * The surface sub-grade service interface.
 *
 * Implementations:
 * - Default (v1): returns a ``not_implemented`` error immediately.
 * - Future: makes a network call to the Python grading service endpoint
 *   (#FU-46).
 * - Future (on-device): loads ONNX model via ``onnxruntime-react-native``.
 * - Tests: injected mock.
 */
export interface SurfaceService {
  grade(request: SurfaceRequest): Promise<SurfaceResult | SurfaceServiceError>;
}

/** Type guard: is the value a {@link SurfaceServiceError}? */
export function isSurfaceError(
  value: SurfaceResult | SurfaceServiceError,
): value is SurfaceServiceError {
  return 'reason' in value && 'message' in value;
}
