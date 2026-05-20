// CornersService contract tests.
//
// These tests pin the `not_implemented` contract, the factory pattern, and
// the request/result type shapes.  They mirror the T-GR-CENTERING test
// suite pattern.

import { describe, expect, it } from 'vitest';

import {
  createCornersService,
  defaultCornersService,
} from '../corners-service.js';
import { isCornersError, NUM_CORNERS } from '../types.js';

import type {
  ConfidenceBand,
  CornersRequest,
  CornersResult,
  CornersService,
  CornersSubgrade,
} from '../types.js';

// ── Test fixtures ─────────────────────────────────────────────────────

const FOUR_URIS: [string, string, string, string] = [
  'file:///tmp/tl.jpg',
  'file:///tmp/tr.jpg',
  'file:///tmp/bl.jpg',
  'file:///tmp/br.jpg',
];

const dummyRequest: CornersRequest = {
  sessionId: 'gcs-corners-test',
  cornerUris: FOUR_URIS,
};

const mockBand: ConfidenceBand = { value: 8.5, confidence: 0.72 };

const mockSubgrades: CornersSubgrade[] = [
  { label: 'top_left', band: mockBand },
  { label: 'top_right', band: mockBand },
  { label: 'bottom_left', band: mockBand },
  { label: 'bottom_right', band: mockBand },
];

const mockResult: CornersResult = {
  sessionId: 'gcs-corners-test',
  perCorner: mockSubgrades,
  aggregate: mockBand,
  modelVersion: 'v0-test',
};

// ── Factory tests ─────────────────────────────────────────────────────

describe('createCornersService', () => {
  it('returns a service with a grade function', () => {
    const svc = createCornersService();
    expect(typeof svc.grade).toBe('function');
  });

  it('default service returns a not_implemented error', async () => {
    const svc = createCornersService();
    const result = await svc.grade(dummyRequest);
    expect(isCornersError(result)).toBe(true);
    if (isCornersError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });

  it('not_implemented error has a non-empty message', async () => {
    const svc = createCornersService();
    const result = await svc.grade(dummyRequest);
    if (isCornersError(result)) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('injected impl is used instead of the default', async () => {
    const mockSvc: CornersService = { grade: async () => mockResult };
    const svc = createCornersService(mockSvc);
    const result = await svc.grade(dummyRequest);
    expect(isCornersError(result)).toBe(false);
    expect(result).toBe(mockResult);
  });

  it('injected impl receives the request', async () => {
    const received: CornersRequest[] = [];
    const mockSvc: CornersService = {
      grade: async (req) => {
        received.push(req);
        return { reason: 'network_error', message: 'test' };
      },
    };
    await createCornersService(mockSvc).grade(dummyRequest);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(dummyRequest);
  });

  it('two calls with no impl both return not_implemented', async () => {
    const svc = createCornersService();
    const [r1, r2] = await Promise.all([svc.grade(dummyRequest), svc.grade(dummyRequest)]);
    expect(isCornersError(r1)).toBe(true);
    expect(isCornersError(r2)).toBe(true);
  });
});

// ── defaultCornersService singleton ───────────────────────────────────

describe('defaultCornersService', () => {
  it('is a singleton CornersService', () => {
    expect(typeof defaultCornersService.grade).toBe('function');
  });

  it('returns not_implemented immediately', async () => {
    const result = await defaultCornersService.grade(dummyRequest);
    expect(isCornersError(result)).toBe(true);
    if (isCornersError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });
});

// ── isCornersError type guard ─────────────────────────────────────────

describe('isCornersError', () => {
  it('returns true for a CornersServiceError', () => {
    expect(isCornersError({ reason: 'not_implemented', message: 'x' })).toBe(true);
  });

  it('returns false for a CornersResult', () => {
    expect(isCornersError(mockResult)).toBe(false);
  });

  it('returns true for network_error reason', () => {
    expect(isCornersError({ reason: 'network_error', message: 'fail' })).toBe(true);
  });

  it('returns true for wrong_corner_count reason', () => {
    expect(isCornersError({ reason: 'wrong_corner_count', message: '3 URIs given' })).toBe(true);
  });
});

// ── CornersResult shape pinning ───────────────────────────────────────

describe('CornersResult shape', () => {
  it('perCorner has exactly NUM_CORNERS entries', () => {
    expect(mockResult.perCorner.length).toBe(NUM_CORNERS);
    expect(NUM_CORNERS).toBe(4);
  });

  it('corner labels are in canonical order', () => {
    const labels = mockResult.perCorner.map((c) => c.label);
    expect(labels).toEqual(['top_left', 'top_right', 'bottom_left', 'bottom_right']);
  });

  it('aggregate confidence band is in valid range', () => {
    expect(mockResult.aggregate.value).toBeGreaterThanOrEqual(1.0);
    expect(mockResult.aggregate.value).toBeLessThanOrEqual(10.0);
    expect(mockResult.aggregate.confidence).toBeGreaterThanOrEqual(0.0);
    expect(mockResult.aggregate.confidence).toBeLessThanOrEqual(1.0);
  });

  it('per-corner bands are in valid range', () => {
    for (const subgrade of mockResult.perCorner) {
      expect(subgrade.band.value).toBeGreaterThanOrEqual(1.0);
      expect(subgrade.band.value).toBeLessThanOrEqual(10.0);
      expect(subgrade.band.confidence).toBeGreaterThanOrEqual(0.0);
      expect(subgrade.band.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it('sessionId is preserved in result', () => {
    expect(mockResult.sessionId).toBe('gcs-corners-test');
  });
});

// ── Mock injection pattern ─────────────────────────────────────────────

describe('mock implementation pattern', () => {
  it('mock service can return a successful result', async () => {
    const svc = createCornersService({ grade: async () => mockResult });
    const result = await svc.grade(dummyRequest);
    expect(isCornersError(result)).toBe(false);
    if (!isCornersError(result)) {
      expect(result.modelVersion).toBe('v0-test');
    }
  });

  it('mock service can return various error reasons', async () => {
    for (const reason of ['session_not_found', 'invalid_image', 'wrong_corner_count'] as const) {
      const svc = createCornersService({
        grade: async () => ({ reason, message: `test ${reason}` }),
      });
      const result = await svc.grade(dummyRequest);
      expect(isCornersError(result)).toBe(true);
      if (isCornersError(result)) {
        expect(result.reason).toBe(reason);
      }
    }
  });
});
