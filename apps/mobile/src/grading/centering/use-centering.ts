// `useCentering` — React hook for the centering measurement.
//
// Reads the capture session from the session store (keyed by `sessionId`),
// builds a `CenteringRequest`, and invokes the centering service.
//
// The hook is injected with both the session store and the service so
// tests can drive it without any network or file-system access.

import { useCallback, useEffect, useState } from 'react';

import { defaultCenteringService } from './centering-service.js';
import { getSession } from './session-store.js';

import type {
  CenteringRequest,
  CenteringResult,
  CenteringService,
  CenteringServiceError,
} from './types.js';
import type { GradingCaptureSession } from '../capture/types.js';


// ── Status type ──────────────────────────────────────────────────────

export type CenteringStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error';

export interface UseCenteringState {
  readonly status: CenteringStatus;
  readonly result: CenteringResult | null;
  readonly error: CenteringServiceError | null;
  /** The session retrieved from the store (null if not found). */
  readonly session: GradingCaptureSession | null;
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface UseCenteringOptions {
  /** Session id from `useLocalSearchParams()`. */
  readonly sessionId: string | undefined;
  /** Override the service (for testing). */
  readonly service?: CenteringService;
  /** Override `getSession` (for testing). */
  readonly getSessionFn?: (id: string) => GradingCaptureSession | undefined;
}

const _sessionNotFoundError: CenteringServiceError = {
  reason: 'session_not_found',
  message: 'No capture session found for this session id. '
    + 'Please start a new capture from the grading tab.',
};

const _missingIdError: CenteringServiceError = {
  reason: 'session_not_found',
  message: 'No session id provided.',
};

/**
 * Measure centering for the capture session identified by `sessionId`.
 *
 * @param options.sessionId - From `useLocalSearchParams()`.  If `undefined`
 *   or empty, the hook immediately returns an error state.
 * @param options.service - Centering service to use.  Defaults to the
 *   module-level singleton (v1: `not_implemented` stub).
 * @param options.getSessionFn - Session lookup function.  Defaults to the
 *   module-scoped store's `getSession`.
 */
export function useCentering(options: UseCenteringOptions): UseCenteringState {
  const {
    sessionId,
    service = defaultCenteringService,
    getSessionFn = getSession,
  } = options;

  const [state, setState] = useState<UseCenteringState>({
    status: 'idle',
    result: null,
    error: null,
    session: null,
  });

  const run = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      setState({ status: 'error', result: null, error: _missingIdError, session: null });
      return;
    }

    const session = getSessionFn(sessionId);
    if (!session) {
      setState({ status: 'error', result: null, error: _sessionNotFoundError, session: null });
      return;
    }

    setState({ status: 'loading', result: null, error: null, session });

    const request: CenteringRequest = {
      sessionId,
      frontUri: session.frontFull.uri,
      backUri: session.backFull.uri,
    };

    const response = await service.measure(request);

    if ('reason' in response) {
      setState({
        status: 'error',
        result: null,
        error: response,
        session,
      });
    } else {
      setState({
        status: 'success',
        result: response,
        error: null,
        session,
      });
    }
  }, [sessionId, service, getSessionFn]);

  useEffect((): void => {
    void run();
  }, [run]);

  return state;
}
