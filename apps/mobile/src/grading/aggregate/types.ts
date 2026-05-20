// Types for the aggregate stage of the grading pipeline.
//
// The Python module (`apps/api-python/grading/aggregate/`) is the
// authoritative implementation.  The TypeScript side ships a typed contract
// + v1 stub that returns `not_implemented`.  A future task replaces the
// stub with a real network call to the Python grading service once the
// API endpoint is deployed (or on-device ONNX inference once the
// sub-grade models bundle on-device — see #FU-46 family).
//
// Design follows T-GR-CORNERS / T-GR-EDGES / T-GR-SURFACE's Python↔TS seam
// pattern exactly.

import type { CenteringResult } from '../centering/types.js';
import type { CornersResult } from '../corners/types.js';
import type { EdgesResult } from '../edges/types.js';
import type { SurfaceResult } from '../surface/types.js';

// ── Confidence band literal ──────────────────────────────────────────

/**
 * 3-band categorical confidence emitted by the aggregator.  Mapped from the
 * 4 sub-grade float confidences + a score-spread heuristic.
 *
 * Mirrors the Python `ConfidenceBandLabel` literal.  See `Q-018` in
 * `open-questions.md` for the rationale.
 */
export type ConfidenceBandLabel = 'low' | 'medium' | 'high';

// ── Sub-grade name literal ───────────────────────────────────────────

/**
 * Canonical sub-grade key order — matches the Python `SUBGRADE_NAMES`
 * constant.
 */
export type SubGradeName = 'centering' | 'corners' | 'edges' | 'surface';

/** Tuple of the canonical sub-grade names in canonical order. */
export const SUBGRADE_NAMES: readonly SubGradeName[] = [
  'centering',
  'corners',
  'edges',
  'surface',
] as const;

// ── Request / result ─────────────────────────────────────────────────

/**
 * Input to the aggregate service.
 *
 * The aggregator consumes the four upstream sub-grade prediction objects
 * (centering / corners / edges / surface) and is responsible for adapting
 * each shape into the linear-weighted-sum input.
 *
 * Centering ships a `CenteringResult` with a string `gradeHint` (and a
 * `lowConfidence` flag) rather than a `ConfidenceBand` — the Python
 * adapter normalises it; the TypeScript service stub does likewise once
 * the impl lands.
 */
export interface AggregateRequest {
  readonly sessionId: string;
  readonly centering: CenteringResult;
  readonly corners: CornersResult;
  readonly edges: EdgesResult;
  readonly surface: SurfaceResult;
}

/**
 * Result from the aggregate service.
 *
 * `overallGrade` is the un-rounded weighted-sum (clamped to [1.0, 10.0])
 * useful for downstream metrics.
 * `psaGrade` is the user-facing PSA grade, rounded to the nearest 0.5 tick.
 * `confidenceBand` is the 3-band categorical aggregate confidence.
 * `subGrades` mirrors the per-sub-grade scores used for the aggregation.
 * `calibrationNotes` is a free-form debug string surfaced in the UI's
 * "Why this grade?" affordance and in eval CLI output.
 */
export interface AggregateResult {
  readonly sessionId: string;
  readonly overallGrade: number;
  readonly psaGrade: number;
  readonly confidenceBand: ConfidenceBandLabel;
  readonly subGrades: Readonly<Record<SubGradeName, number>>;
  readonly calibrationNotes: string;
  readonly modelVersion: string;
}

// ── Service contract ─────────────────────────────────────────────────

/**
 * Error reasons the aggregate service can return.
 *
 * - `'not_implemented'` — v1 default; service is not yet wired.  UI
 *   degrades gracefully.
 * - `'session_not_found'` — the `sessionId` was not found in the store.
 * - `'network_error'` — the service call failed (future remote impl).
 * - `'missing_subgrade'` — one of the 4 upstream predictions was absent.
 * - `'invalid_input'` — a sub-grade score / confidence was out of range.
 */
export type AggregateServiceErrorReason =
  | 'not_implemented'
  | 'session_not_found'
  | 'network_error'
  | 'missing_subgrade'
  | 'invalid_input';

export interface AggregateServiceError {
  readonly reason: AggregateServiceErrorReason;
  readonly message: string;
}

/**
 * The aggregate service interface.
 *
 * Implementations:
 * - Default (v1): returns a `not_implemented` error immediately.
 * - Future: makes a network call to the Python grading service endpoint
 *   (T-GR-SERVING family).
 * - Future (on-device): runs the aggregator's ONNX artifact via
 *   `onnxruntime-react-native` after the sub-grade models ship on-device
 *   (#FU-43 family).
 * - Tests: injected mock.
 */
export interface AggregateService {
  aggregate(
    request: AggregateRequest,
  ): Promise<AggregateResult | AggregateServiceError>;
}

/** Type guard: is the value an {@link AggregateServiceError}? */
export function isAggregateError(
  value: AggregateResult | AggregateServiceError,
): value is AggregateServiceError {
  return 'reason' in value && 'message' in value;
}
