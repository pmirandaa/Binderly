// Types for the corners sub-grade module.
//
// The Python module (`apps/api-python/grading/corners/`) is the authoritative
// implementation.  The TypeScript side ships a typed contract + v1 stub that
// returns `not_implemented`.  A future task replaces the stub with a real
// network call to the Python grading service (or on-device ONNX inference
// via `onnxruntime-react-native`; see #FU-42).
//
// Design follows T-GR-CENTERING's Python↔TS seam pattern exactly.

// ── Grade value types ────────────────────────────────────────────────

/**
 * Number of corners per card.  Always 4 per the multi-shot capture UX.
 */
export const NUM_CORNERS = 4 as const;

/**
 * Canonical corner labels (same order as ``grading_submission.corner_urls``
 * array).
 */
export type CornerLabel = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

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
 * Per-corner prediction for one physical corner of the card.
 */
export interface CornersSubgrade {
  readonly label: CornerLabel;
  readonly band: ConfidenceBand;
}

// ── Request / result ─────────────────────────────────────────────────

/**
 * Input to the corners grading service.
 *
 * ``cornerUris`` is a list of exactly 4 local file URIs in canonical order:
 * [top_left, top_right, bottom_left, bottom_right].
 */
export interface CornersRequest {
  readonly sessionId: string;
  /**
   * Exactly 4 local file URIs for the corner crops.  Matches
   * ``grading_submission.corner_urls``.
   */
  readonly cornerUris: readonly [string, string, string, string];
}

/**
 * Result from the corners sub-grade model.
 *
 * ``perCorner`` contains one prediction per corner.
 * ``aggregate`` is the weakest-corner aggregate for the corners sub-grade
 * as a whole (consistent with PSA grader convention).
 * ``modelVersion`` is the ONNX artifact version used for inference.
 */
export interface CornersResult {
  readonly sessionId: string;
  readonly perCorner: ReadonlyArray<CornersSubgrade>;
  readonly aggregate: ConfidenceBand;
  readonly modelVersion: string;
}

// ── Service contract ─────────────────────────────────────────────────

/**
 * Error reasons the corners service can return.
 *
 * - `'not_implemented'` — v1 default; service is not yet wired.  UI degrades
 *   gracefully.
 * - `'session_not_found'` — the ``sessionId`` was not found in the store.
 * - `'network_error'` — the service call failed (future remote impl).
 * - `'invalid_image'` — a provided URI could not be decoded.
 * - `'wrong_corner_count'` — ``cornerUris`` does not contain exactly 4 items.
 */
export type CornersServiceErrorReason =
  | 'not_implemented'
  | 'session_not_found'
  | 'network_error'
  | 'invalid_image'
  | 'wrong_corner_count';

export interface CornersServiceError {
  readonly reason: CornersServiceErrorReason;
  readonly message: string;
}

/**
 * The corners sub-grade service interface.
 *
 * Implementations:
 * - Default (v1): returns a ``not_implemented`` error immediately.
 * - Future: makes a network call to the Python grading service endpoint.
 * - Future (on-device): loads ONNX model via ``onnxruntime-react-native``
 *   (#FU-42).
 * - Tests: injected mock.
 */
export interface CornersService {
  grade(request: CornersRequest): Promise<CornersResult | CornersServiceError>;
}

/** Type guard: is the value a {@link CornersServiceError}? */
export function isCornersError(
  value: CornersResult | CornersServiceError,
): value is CornersServiceError {
  return 'reason' in value && 'message' in value;
}
