// Types for the edges sub-grade module.
//
// The Python module (`apps/api-python/grading/edges/`) is the authoritative
// implementation.  The TypeScript side ships a typed contract + v1 stub that
// returns `not_implemented`.  A future task replaces the stub with a real
// network call to the Python grading service (or on-device ONNX inference
// via `onnxruntime-react-native`; see #FU-46).
//
// Design follows T-GR-CORNERS's Python↔TS seam pattern exactly.

// ── Grade value types ────────────────────────────────────────────────

/**
 * Number of edge strips per card.  Always 4 per the multi-shot capture UX:
 * top, bottom, left, right.
 */
export const NUM_STRIPS = 4 as const;

/**
 * Canonical strip labels (same order as ``EdgesRequest.strip_uris``).
 * Matches ``STRIP_LABELS`` in the Python module.
 */
export type EdgeStripLabel = 'top' | 'bottom' | 'left' | 'right';

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
 * Per-edge prediction for one perimeter strip of the card.
 */
export interface EdgesSubgrade {
  readonly label: EdgeStripLabel;
  readonly band: ConfidenceBand;
}

// ── Request / result ─────────────────────────────────────────────────

/**
 * Input to the edges grading service.
 *
 * ``stripUris`` is a tuple of exactly 4 local file URIs in canonical order:
 * [top, bottom, left, right].  Each URI points to a cropped edge-strip image
 * (256 × 32 px for top/bottom; 32 × 256 px for left/right at full resolution).
 */
export interface EdgesRequest {
  readonly sessionId: string;
  /**
   * Exactly 4 local file URIs for the edge-strip crops.
   * Canonical order: [top, bottom, left, right].
   */
  readonly stripUris: readonly [string, string, string, string];
}

/**
 * Result from the edges sub-grade model.
 *
 * ``perEdge`` contains one prediction per strip.
 * ``aggregate`` is the weakest-edge aggregate for the edges sub-grade
 * as a whole (weakest edge dominates, consistent with PSA grader convention).
 * ``modelVersion`` is the ONNX artifact version used for inference.
 */
export interface EdgesResult {
  readonly sessionId: string;
  readonly perEdge: ReadonlyArray<EdgesSubgrade>;
  readonly aggregate: ConfidenceBand;
  readonly modelVersion: string;
}

// ── Service contract ─────────────────────────────────────────────────

/**
 * Error reasons the edges service can return.
 *
 * - `'not_implemented'` — v1 default; service is not yet wired.  UI degrades
 *   gracefully.
 * - `'session_not_found'` — the ``sessionId`` was not found in the store.
 * - `'network_error'` — the service call failed (future remote impl).
 * - `'invalid_image'` — a provided URI could not be decoded.
 * - `'wrong_strip_count'` — ``stripUris`` does not contain exactly 4 items.
 */
export type EdgesServiceErrorReason =
  | 'not_implemented'
  | 'session_not_found'
  | 'network_error'
  | 'invalid_image'
  | 'wrong_strip_count';

export interface EdgesServiceError {
  readonly reason: EdgesServiceErrorReason;
  readonly message: string;
}

/**
 * The edges sub-grade service interface.
 *
 * Implementations:
 * - Default (v1): returns a ``not_implemented`` error immediately.
 * - Future: makes a network call to the Python grading service endpoint.
 * - Future (on-device): loads ONNX model via ``onnxruntime-react-native``
 *   (#FU-46).
 * - Tests: injected mock.
 */
export interface EdgesService {
  grade(request: EdgesRequest): Promise<EdgesResult | EdgesServiceError>;
}

/** Type guard: is the value a {@link EdgesServiceError}? */
export function isEdgesError(
  value: EdgesResult | EdgesServiceError,
): value is EdgesServiceError {
  return 'reason' in value && 'message' in value;
}
