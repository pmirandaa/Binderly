// `useCentering` hook tests.

import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetSessionStore,
  storeSession,
} from '../session-store.js';
import { useCentering } from '../use-centering.js';

import type { GradingCaptureSession } from '../../capture/types.js';
import type {
  CenteringRequest,
  CenteringResult,
  CenteringService,
  CenteringServiceError,
} from '../types.js';

const okQuality = {
  metrics: { sharpness: 12, brightness: 0.5, coverage: 0.6 },
  sharpnessOK: true,
  brightnessOK: true,
  coverageOK: true,
  accepted: true,
  reason: 'great' as const,
};

function makeShot(kind: GradingCaptureSession['frontFull']['kind']) {
  return {
    kind,
    uri: `file:///tmp/${kind}.jpg`,
    width: 1080,
    height: 1440,
    quality: okQuality,
    capturedAt: 1_700_000_000_000,
  };
}

function makeSession(id = 'gcs-hook-1'): GradingCaptureSession {
  return {
    id,
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_000,
    frontFull: makeShot('frontFull'),
    backFull: makeShot('backFull'),
    frontCorner: makeShot('frontCorner'),
    backCorner: makeShot('backCorner'),
    bottomLeftCorner: makeShot('bottomLeftCorner'),
    bottomRightCorner: makeShot('bottomRightCorner'),
    surface: makeShot('surface'),
  };
}

const successResult: CenteringResult = {
  sessionId: 'gcs-hook-1',
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  hRatio: 1.0,
  vRatio: 1.0,
  gradeHint: '10',
  lowConfidence: false,
  lowConfidenceHolographic: false,
  flags: [],
};

const notImplementedError: CenteringServiceError = {
  reason: 'not_implemented',
  message: 'not implemented',
};

afterEach((): void => {
  __resetSessionStore();
});

describe('useCentering — missing sessionId', () => {
  it('returns error state immediately when sessionId is undefined', async () => {
    const { result } = renderHook(() =>
      useCentering({ sessionId: undefined })
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.reason).toBe('session_not_found');
    expect(result.current.result).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it('returns error state when sessionId is an empty string', async () => {
    const { result } = renderHook(() =>
      useCentering({ sessionId: '' })
    );
    await waitFor(() => expect(result.current.error?.reason).toBe('session_not_found'));
  });
});

describe('useCentering — session not found', () => {
  it('returns error when sessionId is present but not in store', async () => {
    const { result } = renderHook(() =>
      useCentering({ sessionId: 'gcs-unknown' })
    );
    await waitFor(() => expect(result.current.error?.reason).toBe('session_not_found'));
  });
});

describe('useCentering — service not implemented (default)', () => {
  it('calls through to service and returns error', async () => {
    const session = makeSession('gcs-hook-1');
    storeSession(session);

    const mockService: CenteringService = {
      measure: vi.fn().mockResolvedValue(notImplementedError),
    };

    const { result } = renderHook(() =>
      useCentering({ sessionId: 'gcs-hook-1', service: mockService })
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.reason).toBe('not_implemented');
    expect(result.current.session).toBe(session);
  });
});

describe('useCentering — successful measurement', () => {
  it('returns success state with the result', async () => {
    const session = makeSession('gcs-hook-1');
    storeSession(session);

    const mockService: CenteringService = {
      measure: vi.fn().mockResolvedValue(successResult),
    };

    const { result } = renderHook(() =>
      useCentering({ sessionId: 'gcs-hook-1', service: mockService })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.result).toEqual(successResult);
    expect(result.current.session).toBe(session);
    expect(result.current.error).toBeNull();
  });

  it('calls service with frontUri and backUri from session', async () => {
    const session = makeSession('gcs-hook-1');
    storeSession(session);

    const received: CenteringRequest[] = [];
    const mockService: CenteringService = {
      measure: vi.fn(async (req: CenteringRequest) => {
        received.push(req);
        return successResult;
      }),
    };

    const { result } = renderHook(() =>
      useCentering({ sessionId: 'gcs-hook-1', service: mockService })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(received).toHaveLength(1);
    expect(received[0]!.frontUri).toBe(session.frontFull.uri);
    expect(received[0]!.backUri).toBe(session.backFull.uri);
    expect(received[0]!.sessionId).toBe('gcs-hook-1');
  });
});

describe('useCentering — injected getSessionFn', () => {
  it('uses injected getSessionFn instead of the module store', async () => {
    const session = makeSession('gcs-injected');
    const getSessionFn = vi.fn((_id: string) => session);
    const mockService: CenteringService = {
      measure: vi.fn().mockResolvedValue(successResult),
    };

    const { result } = renderHook(() =>
      useCentering({
        sessionId: 'gcs-injected',
        service: mockService,
        getSessionFn,
      })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(getSessionFn).toHaveBeenCalledWith('gcs-injected');
    expect(result.current.session).toBe(session);
  });
});

describe('useCentering — loading state', () => {
  it('passes through loading state before the service resolves', async () => {
    const session = makeSession('gcs-loading');
    storeSession(session);

    let resolvePromise!: (v: CenteringResult) => void;
    const pendingPromise = new Promise<CenteringResult>((res) => {
      resolvePromise = res;
    });
    const mockService: CenteringService = {
      measure: vi.fn().mockReturnValue(pendingPromise),
    };

    const { result } = renderHook(() =>
      useCentering({ sessionId: 'gcs-loading', service: mockService })
    );

    await waitFor(() => expect(result.current.status).toBe('loading'));

    act(() => { resolvePromise(successResult); });
    await waitFor(() => expect(result.current.status).toBe('success'));
  });
});
