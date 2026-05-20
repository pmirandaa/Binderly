// CenteringService contract tests.

import { describe, expect, it } from 'vitest';

import {
  createCenteringService,
  defaultCenteringService,
} from '../centering-service.js';
import { isCenteringError } from '../types.js';

import type { CenteringRequest, CenteringResult, CenteringService } from '../types.js';

const dummyRequest: CenteringRequest = {
  sessionId: 'gcs-test',
  frontUri: 'file:///tmp/front.jpg',
  backUri: 'file:///tmp/back.jpg',
};

describe('createCenteringService', () => {
  it('returns a service with a measure function', () => {
    const svc = createCenteringService();
    expect(typeof svc.measure).toBe('function');
  });

  it('default service returns a not_implemented error', async () => {
    const svc = createCenteringService();
    const result = await svc.measure(dummyRequest);
    expect(isCenteringError(result)).toBe(true);
    if (isCenteringError(result)) {
      expect(result.reason).toBe('not_implemented');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('injected impl is used instead of the default', async () => {
    const mockResult: CenteringResult = {
      sessionId: 'gcs-test',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      hRatio: 1.0,
      vRatio: 1.0,
      gradeHint: '10',
      lowConfidence: false,
      lowConfidenceHolographic: false,
      flags: [],
    };
    const mockSvc: CenteringService = {
      measure: async () => mockResult,
    };
    const svc = createCenteringService(mockSvc);
    const result = await svc.measure(dummyRequest);
    expect(isCenteringError(result)).toBe(false);
    expect(result).toBe(mockResult);
  });

  it('injected impl receives the request', async () => {
    const received: CenteringRequest[] = [];
    const mockSvc: CenteringService = {
      measure: async (req) => {
        received.push(req);
        return { reason: 'network_error', message: 'test' };
      },
    };
    await createCenteringService(mockSvc).measure(dummyRequest);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(dummyRequest);
  });
});

describe('defaultCenteringService', () => {
  it('is a singleton CenteringService', () => {
    expect(typeof defaultCenteringService.measure).toBe('function');
  });

  it('returns not_implemented immediately', async () => {
    const result = await defaultCenteringService.measure(dummyRequest);
    expect(isCenteringError(result)).toBe(true);
    if (isCenteringError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });
});

describe('isCenteringError', () => {
  it('returns true for an error object', () => {
    expect(isCenteringError({ reason: 'not_implemented', message: 'x' })).toBe(true);
  });

  it('returns false for a result object', () => {
    const result: CenteringResult = {
      sessionId: 's',
      margins: null,
      hRatio: null,
      vRatio: null,
      gradeHint: 'unknown',
      lowConfidence: true,
      lowConfidenceHolographic: false,
      flags: [],
    };
    expect(isCenteringError(result)).toBe(false);
  });
});
