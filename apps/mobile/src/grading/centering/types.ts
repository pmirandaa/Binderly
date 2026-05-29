// Types for the centering measurement module.
//
// The Python module (`apps/api-python/grading/centering/`) is the
// authoritative implementation.  The TypeScript side ships a typed
// contract + session-routing seam for v1; the actual measurement runs
// off-device (the Python service, when deployed).  See T-GR-CENTERING.md
// § Design trade-off for the rationale.

import type { GradingCaptureSession } from '../capture/types.js';

// ── Grade hint ────────────────────────────────────────────────────────

/**
 * PSA centering grade hint.  Maps to the standard PSA tolerance table:
 *
 * | Hint    | H tolerance | V tolerance |
 * |:-------:|:-----------:|:-----------:|
 * | `"10"`  |  55/45      |  55/45      |
 * | `"9"`   |  60/40      |  60/40      |
 * | `"8"`   |  65/35      |  65/35      |
 * | `"7"`   |  70/30      |  70/30      |
 * | `"worse"` | below 70/30 |           |
 * | `"unknown"` | detection failed |    |
 */
export type CenteringGradeHint =
  | '10'
  | '9'
  | '8'
  | '7'
  | 'worse'
  | 'unknown';

// ── Measurement types ────────────────────────────────────────────────

/** Centering input: the two URIs from the completed capture session. */
export interface CenteringRequest {
  readonly sessionId: string;
  /** Local file URI of the front full-portrait shot. */
  readonly frontUri: string;
  /** Local file URI of the back full-portrait shot. */
  readonly backUri: string;
}

/** Margin widths in pixels (as detected by the Python service). */
export interface CenteringMargins {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Centering measurement result from the Python service. */
export interface CenteringResult {
  readonly sessionId: string;
  readonly margins: CenteringMargins | null;
  /**
   * Horizontal centering ratio: ``min(left, right) / max(left, right)``.
   * Ranges from 0 (fully off-centre) to 1.0 (perfectly centred).
   */
  readonly hRatio: number | null;
  /**
   * Vertical centering ratio: ``min(top, bottom) / max(top, bottom)``.
   */
  readonly vRatio: number | null;
  readonly gradeHint: CenteringGradeHint;
  /**
   * True when the measurement is unreliable (single-face measurement,
   * holographic / full-art border, or insufficient contrast).
   */
  readonly lowConfidence: boolean;
  readonly lowConfidenceHolographic: boolean;
  readonly flags: ReadonlyArray<string>;
}

// ── Service contract ─────────────────────────────────────────────────

/**
 * Error reasons the centering service can return.
 *
 * - `'not_implemented'` — the v1 default impl; the service is not yet
 *   wired to the Python endpoint.  The UI should degrade gracefully.
 * - `'session_not_found'` — the `sessionId` was not found in the store.
 * - `'network_error'` — the service call failed (future remote impl).
 * - `'invalid_image'` — the provided URI could not be decoded.
 */
export type CenteringServiceErrorReason =
  | 'not_implemented'
  | 'session_not_found'
  | 'network_error'
  | 'invalid_image';

export interface CenteringServiceError {
  readonly reason: CenteringServiceErrorReason;
  readonly message: string;
}

/**
 * The centering service interface.
 *
 * Implementations:
 * - Default (v1): returns a `not_implemented` error immediately.
 * - Future: makes a network call to the Python grading service.
 * - Tests: injected mock.
 */
export interface CenteringService {
  measure(request: CenteringRequest): Promise<CenteringResult | CenteringServiceError>;
}

/** Type guard: is the value a {@link CenteringServiceError}? */
export function isCenteringError(
  value: CenteringResult | CenteringServiceError,
): value is CenteringServiceError {
  return 'reason' in value && 'message' in value;
}

// ── Session-store types ───────────────────────────────────────────────

/**
 * The in-process session store contract.  The router-param hand-off that
 * replaced the removed `__getLastEmittedSession` / `__setLastEmittedSession`
 * ref from `T-GR-CAPTURE-UX` (#FU-32).
 *
 * The store is keyed by `session.id` (a `gcs-<ts>-<rand>` string generated
 * by `createInitialSessionState()`).  Future sibling grading tasks
 * (T-GR-CORNERS, T-GR-EDGES, T-GR-SURFACE) import `getSession` from the
 * centering barrel and use the same `?sessionId=` query param convention.
 *
 * See T-GR-CENTERING.md § Session-routing strategy for the full rationale.
 */
export interface SessionStore {
  store(session: GradingCaptureSession): void;
  get(sessionId: string): GradingCaptureSession | undefined;
  clear(sessionId: string): void;
  /** The number of sessions currently held in the store. */
  size(): number;
}
