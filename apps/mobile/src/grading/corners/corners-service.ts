// CornersService — typed contract + default v1 implementation.
//
// The default implementation returns a `not_implemented` error.  The UI
// degrades gracefully by showing an informational message instead of a
// sub-grade score.  A future task replaces the default with a real network
// call to the Python grading service once the API endpoint is deployed
// (or on-device ONNX inference via `onnxruntime-react-native`; see #FU-42).
//
// # Factory pattern (mirrors T-GR-CENTERING exactly)
//
// `createCornersService(impl?)` returns a `CornersService`.  Tests inject
// a mock implementation; the route file uses the default.

import type {
  CornersRequest,
  CornersResult,
  CornersService,
  CornersServiceError,
} from './types.js';

/**
 * Default v1 implementation — always returns `not_implemented`.
 *
 * Replace with a real implementation once the Python grading service
 * endpoint is deployed, or once on-device ONNX inference is wired in (#FU-42).
 * The impl swap is isolated to this factory — consumers depend only on the
 * `CornersService` interface.
 */
const _notImplementedService: CornersService = {
  grade: async (_request: CornersRequest): Promise<CornersResult | CornersServiceError> => {
    return {
      reason: 'not_implemented',
      message:
        'Corners sub-grade inference is not yet available. ' +
        'The Python grading service must be deployed and the client wired to it. ' +
        'See T-GR-CORNERS.md § Out of scope (#FU-41, #FU-42).',
    } satisfies CornersServiceError;
  },
};

/**
 * Create a {@link CornersService}.
 *
 * @param impl - Optional custom implementation.  Defaults to the v1
 *   `not_implemented` stub that returns a graceful error without crashing.
 *
 * @example
 * ```ts
 * // In a test:
 * const mockService = createCornersService({
 *   grade: async (req) => ({
 *     sessionId: req.sessionId,
 *     perCorner: [...],
 *     aggregate: { value: 8.5, confidence: 0.72 },
 *     modelVersion: 'v0-test',
 *   }),
 * });
 *
 * // In the route file (v1 — uses the default stub):
 * const service = createCornersService();
 * ```
 */
export function createCornersService(impl?: CornersService): CornersService {
  return impl ?? _notImplementedService;
}

/** Singleton service instance for use outside of tests. */
export const defaultCornersService: CornersService = createCornersService();
