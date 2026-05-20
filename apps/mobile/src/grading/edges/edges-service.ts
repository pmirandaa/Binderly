// EdgesService — typed contract + default v1 implementation.
//
// The default implementation returns a `not_implemented` error.  The UI
// degrades gracefully by showing an informational message instead of a
// sub-grade score.  A future task replaces the default with a real network
// call to the Python grading service once the API endpoint is deployed
// (or on-device ONNX inference via `onnxruntime-react-native`; see #FU-46).
//
// # Factory pattern (mirrors T-GR-CORNERS exactly)
//
// `createEdgesService(impl?)` returns an `EdgesService`.  Tests inject
// a mock implementation; the route file uses the default.

import type {
  EdgesRequest,
  EdgesResult,
  EdgesService,
  EdgesServiceError,
} from './types.js';

/**
 * Default v1 implementation — always returns `not_implemented`.
 *
 * Replace with a real implementation once the Python grading service
 * endpoint is deployed, or once on-device ONNX inference is wired in (#FU-46).
 * The impl swap is isolated to this factory — consumers depend only on the
 * `EdgesService` interface.
 */
const _notImplementedService: EdgesService = {
  grade: async (_request: EdgesRequest): Promise<EdgesResult | EdgesServiceError> => {
    return {
      reason: 'not_implemented',
      message:
        'Edges sub-grade inference is not yet available. ' +
        'The Python grading service must be deployed and the client wired to it. ' +
        'See T-GR-EDGES.md § Out of scope (#FU-45, #FU-46).',
    } satisfies EdgesServiceError;
  },
};

/**
 * Create an {@link EdgesService}.
 *
 * @param impl - Optional custom implementation.  Defaults to the v1
 *   `not_implemented` stub that returns a graceful error without crashing.
 *
 * @example
 * ```ts
 * // In a test:
 * const mockService = createEdgesService({
 *   grade: async (req) => ({
 *     sessionId: req.sessionId,
 *     perEdge: [...],
 *     aggregate: { value: 8.5, confidence: 0.72 },
 *     modelVersion: 'v0-test',
 *   }),
 * });
 *
 * // In the route file (v1 — uses the default stub):
 * const service = createEdgesService();
 * ```
 */
export function createEdgesService(impl?: EdgesService): EdgesService {
  return impl ?? _notImplementedService;
}

/** Singleton service instance for use outside of tests. */
export const defaultEdgesService: EdgesService = createEdgesService();
