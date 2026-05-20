// CenteringService — typed contract + default v1 implementation.
//
// The default implementation returns a `not_implemented` error.  The UI
// degrades gracefully by showing an informational message instead of a
// score.  A future task replaces the default with a real network call to
// the Python grading service once the API endpoint is deployed.
//
// # Factory pattern
//
// `createCenteringService(impl?)` returns a `CenteringService`.  Tests
// inject a mock implementation; the route file uses the default.

import type {
  CenteringRequest,
  CenteringResult,
  CenteringService,
  CenteringServiceError,
} from './types.js';

/**
 * Default v1 implementation — always returns `not_implemented`.
 *
 * Replace with a real implementation once the Python grading service
 * endpoint is deployed.  The impl swap is isolated to this factory —
 * the screen and hook depend only on the `CenteringService` interface.
 */
const _notImplementedService: CenteringService = {
  measure: async (_request: CenteringRequest): Promise<CenteringResult | CenteringServiceError> => {
    return {
      reason: 'not_implemented',
      message:
        'Centering measurement is not yet available on-device. ' +
        'The Python service must be deployed and the client wired to it. ' +
        'See T-GR-CENTERING.md § Design trade-off.',
    } satisfies CenteringServiceError;
  },
};

/**
 * Create a {@link CenteringService}.
 *
 * @param impl - Optional custom implementation.  Defaults to the v1
 *   `not_implemented` stub that returns a graceful error without crashing.
 *
 * @example
 * ```ts
 * // In a test:
 * const mockService = createCenteringService({
 *   measure: async (req) => ({ sessionId: req.sessionId, ... }),
 * });
 *
 * // In the route file (v1 — uses the default stub):
 * const service = createCenteringService();
 * ```
 */
export function createCenteringService(impl?: CenteringService): CenteringService {
  return impl ?? _notImplementedService;
}

/** Singleton service instance for use outside of tests. */
export const defaultCenteringService: CenteringService = createCenteringService();
