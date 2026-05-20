// SurfaceService — typed contract + default v1 implementation.
//
// The default implementation returns a `not_implemented` error.  The UI
// degrades gracefully by showing an informational message instead of a
// sub-grade score.  A future task replaces the default with a real network
// call to the Python grading service once the API endpoint is deployed
// (#FU-46), or with on-device ONNX inference via `onnxruntime-react-native`.
//
// # Factory pattern (mirrors T-GR-CORNERS exactly)
//
// `createSurfaceService(impl?)` returns a `SurfaceService`.  Tests inject
// a mock implementation; the route file uses the default.

import type {
  SurfaceRequest,
  SurfaceResult,
  SurfaceService,
  SurfaceServiceError,
} from './types.js';

/**
 * Default v1 implementation — always returns `not_implemented`.
 *
 * Replace with a real implementation once the Python grading service
 * endpoint is deployed (#FU-46), or once on-device ONNX inference is wired in.
 * The impl swap is isolated to this factory — consumers depend only on the
 * `SurfaceService` interface.
 */
const _notImplementedService: SurfaceService = {
  grade: async (_request: SurfaceRequest): Promise<SurfaceResult | SurfaceServiceError> => {
    return {
      reason: 'not_implemented',
      message:
        'Surface sub-grade inference is not yet available. ' +
        'The Python grading service must be deployed and the client wired to it. ' +
        'See T-GR-SURFACE.md (#FU-46). ' +
        'Note: raking-light input improves accuracy but is not yet captured (#FU-31).',
    } satisfies SurfaceServiceError;
  },
};

/**
 * Create a {@link SurfaceService}.
 *
 * @param impl - Optional custom implementation.  Defaults to the v1
 *   `not_implemented` stub that returns a graceful error without crashing.
 *
 * @example
 * ```ts
 * // In a test:
 * const mockService = createSurfaceService({
 *   grade: async (req) => ({
 *     sessionId: req.sessionId,
 *     perShot: [
 *       { label: 'front_full', band: { value: 8.5, confidence: 0.72 } },
 *       { label: 'back_full',  band: { value: 9.0, confidence: 0.68 } },
 *     ],
 *     aggregate: { value: 8.75, confidence: 0.70 },
 *     modelVersion: 'v0-test',
 *   }),
 * });
 *
 * // In the route file (v1 — uses the default stub):
 * const service = createSurfaceService();
 * ```
 */
export function createSurfaceService(impl?: SurfaceService): SurfaceService {
  return impl ?? _notImplementedService;
}

/** Singleton service instance for use outside of tests. */
export const defaultSurfaceService: SurfaceService = createSurfaceService();
