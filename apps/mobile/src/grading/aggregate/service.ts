// AggregateService — typed contract + default v1 implementation.
//
// The default implementation returns a `not_implemented` error.  The UI
// degrades gracefully by showing an informational message instead of an
// overall PSA grade.  A future task replaces the default with a real
// network call to the Python grading service once the API endpoint is
// deployed (or on-device ONNX inference once the sub-grade models bundle
// on-device; see #FU-43 / #FU-46 family).
//
// # Factory pattern (mirrors T-GR-CORNERS / T-GR-EDGES / T-GR-SURFACE)
//
// `createAggregateService(impl?)` returns an `AggregateService`.  Tests
// inject a mock implementation; the route file uses the default.

import type {
  AggregateRequest,
  AggregateResult,
  AggregateService,
  AggregateServiceError,
} from './types.js';

/**
 * Default v1 implementation — always returns `not_implemented`.
 *
 * Replace with a real implementation once the Python grading service
 * endpoint is deployed (T-GR-SERVING), or once on-device ONNX inference
 * is wired in (#FU-43 family).  The impl swap is isolated to this factory —
 * consumers depend only on the `AggregateService` interface.
 */
const _notImplementedService: AggregateService = {
  aggregate: async (
    _request: AggregateRequest,
  ): Promise<AggregateResult | AggregateServiceError> => {
    return {
      reason: 'not_implemented',
      message:
        'Overall-grade aggregation is not yet available. ' +
        'The Python grading service must be deployed and the client wired to it. ' +
        'See T-GR-AGGREGATE.md § Out of scope (#FU-46, #FU-48).',
    } satisfies AggregateServiceError;
  },
};

/**
 * Create an {@link AggregateService}.
 *
 * @param impl - Optional custom implementation.  Defaults to the v1
 *   `not_implemented` stub that returns a graceful error without crashing.
 *
 * @example
 * ```ts
 * // In a test:
 * const mockService = createAggregateService({
 *   aggregate: async (req) => ({
 *     sessionId: req.sessionId,
 *     overallGrade: 8.7,
 *     psaGrade: 8.5,
 *     confidenceBand: 'medium',
 *     subGrades: { centering: 9, corners: 8.5, edges: 9, surface: 8 },
 *     calibrationNotes: 'mock',
 *     modelVersion: 'v0-test',
 *   }),
 * });
 *
 * // In the route file (v1 — uses the default stub):
 * const service = createAggregateService();
 * ```
 */
export function createAggregateService(
  impl?: AggregateService,
): AggregateService {
  return impl ?? _notImplementedService;
}

/** Singleton service instance for use outside of tests. */
export const defaultAggregateService: AggregateService =
  createAggregateService();
