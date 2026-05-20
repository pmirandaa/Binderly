// EdgesService contract tests.
//
// These tests pin the `not_implemented` contract, the factory pattern, and
// the request/result type shapes.  They mirror the T-GR-CORNERS test
// suite pattern.

import { describe, expect, it } from 'vitest';

import {
  createEdgesService,
  defaultEdgesService,
} from '../edges-service.js';
import { isEdgesError, NUM_STRIPS } from '../types.js';

import type {
  ConfidenceBand,
  EdgesRequest,
  EdgesResult,
  EdgesService,
  EdgesSubgrade,
} from '../types.js';

// ── Test fixtures ─────────────────────────────────────────────────────

const FOUR_URIS: [string, string, string, string] = [
  'file:///tmp/top.jpg',
  'file:///tmp/bottom.jpg',
  'file:///tmp/left.jpg',
  'file:///tmp/right.jpg',
];

const dummyRequest: EdgesRequest = {
  sessionId: 'gcs-edges-test',
  stripUris: FOUR_URIS,
};

const mockBand: ConfidenceBand = { value: 8.5, confidence: 0.72 };

const mockSubgrades: EdgesSubgrade[] = [
  { label: 'top', band: mockBand },
  { label: 'bottom', band: mockBand },
  { label: 'left', band: mockBand },
  { label: 'right', band: mockBand },
];

const mockResult: EdgesResult = {
  sessionId: 'gcs-edges-test',
  perEdge: mockSubgrades,
  aggregate: mockBand,
  modelVersion: 'v0-test',
};

// ── Factory tests ─────────────────────────────────────────────────────

describe('createEdgesService', () => {
  it('returns a service with a grade function', () => {
    const svc = createEdgesService();
    expect(typeof svc.grade).toBe('function');
  });

  it('default service returns a not_implemented error', async () => {
    const svc = createEdgesService();
    const result = await svc.grade(dummyRequest);
    expect(isEdgesError(result)).toBe(true);
    if (isEdgesError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });

  it('not_implemented error has a non-empty message', async () => {
    const svc = createEdgesService();
    const result = await svc.grade(dummyRequest);
    if (isEdgesError(result)) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('injected impl is used instead of the default', async () => {
    const mockSvc: EdgesService = { grade: async () => mockResult };
    const svc = createEdgesService(mockSvc);
    const result = await svc.grade(dummyRequest);
    expect(isEdgesError(result)).toBe(false);
    expect(result).toBe(mockResult);
  });

  it('injected impl receives the request', async () => {
    const received: EdgesRequest[] = [];
    const mockSvc: EdgesService = {
      grade: async (req) => {
        received.push(req);
        return { reason: 'network_error', message: 'test' };
      },
    };
    await createEdgesService(mockSvc).grade(dummyRequest);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(dummyRequest);
  });

  it('two calls with no impl both return not_implemented', async () => {
    const svc = createEdgesService();
    const [r1, r2] = await Promise.all([svc.grade(dummyRequest), svc.grade(dummyRequest)]);
    expect(isEdgesError(r1)).toBe(true);
    expect(isEdgesError(r2)).toBe(true);
  });
});

// ── defaultEdgesService singleton ─────────────────────────────────────

describe('defaultEdgesService', () => {
  it('is a singleton EdgesService', () => {
    expect(typeof defaultEdgesService.grade).toBe('function');
  });

  it('returns not_implemented immediately', async () => {
    const result = await defaultEdgesService.grade(dummyRequest);
    expect(isEdgesError(result)).toBe(true);
    if (isEdgesError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });
});

// ── isEdgesError type guard ────────────────────────────────────────────

describe('isEdgesError', () => {
  it('returns true for an EdgesServiceError', () => {
    expect(isEdgesError({ reason: 'not_implemented', message: 'x' })).toBe(true);
  });

  it('returns false for an EdgesResult', () => {
    expect(isEdgesError(mockResult)).toBe(false);
  });

  it('returns true for network_error reason', () => {
    expect(isEdgesError({ reason: 'network_error', message: 'fail' })).toBe(true);
  });

  it('returns true for wrong_strip_count reason', () => {
    expect(isEdgesError({ reason: 'wrong_strip_count', message: '3 URIs given' })).toBe(true);
  });
});

// ── EdgesResult shape pinning ──────────────────────────────────────────

describe('EdgesResult shape', () => {
  it('perEdge has exactly NUM_STRIPS entries', () => {
    expect(mockResult.perEdge.length).toBe(NUM_STRIPS);
    expect(NUM_STRIPS).toBe(4);
  });

  it('strip labels are in canonical order', () => {
    const labels = mockResult.perEdge.map((e) => e.label);
    expect(labels).toEqual(['top', 'bottom', 'left', 'right']);
  });

  it('aggregate confidence band is in valid range', () => {
    expect(mockResult.aggregate.value).toBeGreaterThanOrEqual(1.0);
    expect(mockResult.aggregate.value).toBeLessThanOrEqual(10.0);
    expect(mockResult.aggregate.confidence).toBeGreaterThanOrEqual(0.0);
    expect(mockResult.aggregate.confidence).toBeLessThanOrEqual(1.0);
  });

  it('per-edge bands are in valid range', () => {
    for (const subgrade of mockResult.perEdge) {
      expect(subgrade.band.value).toBeGreaterThanOrEqual(1.0);
      expect(subgrade.band.value).toBeLessThanOrEqual(10.0);
      expect(subgrade.band.confidence).toBeGreaterThanOrEqual(0.0);
      expect(subgrade.band.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it('sessionId is preserved in result', () => {
    expect(mockResult.sessionId).toBe('gcs-edges-test');
  });

  it('modelVersion is a string', () => {
    expect(typeof mockResult.modelVersion).toBe('string');
  });
});

// ── Mock injection pattern ─────────────────────────────────────────────

describe('mock implementation pattern', () => {
  it('mock service can return a successful result', async () => {
    const svc = createEdgesService({ grade: async () => mockResult });
    const result = await svc.grade(dummyRequest);
    expect(isEdgesError(result)).toBe(false);
    if (!isEdgesError(result)) {
      expect(result.modelVersion).toBe('v0-test');
    }
  });

  it('mock service can return various error reasons', async () => {
    for (const reason of ['session_not_found', 'invalid_image', 'wrong_strip_count'] as const) {
      const svc = createEdgesService({
        grade: async () => ({ reason, message: `test ${reason}` }),
      });
      const result = await svc.grade(dummyRequest);
      expect(isEdgesError(result)).toBe(true);
      if (isEdgesError(result)) {
        expect(result.reason).toBe(reason);
      }
    }
  });

  it('request passes sessionId through to impl', async () => {
    let capturedId = '';
    const svc = createEdgesService({
      grade: async (req) => {
        capturedId = req.sessionId;
        return mockResult;
      },
    });
    await svc.grade({ ...dummyRequest, sessionId: 'captured-id' });
    expect(capturedId).toBe('captured-id');
  });

  it('request passes stripUris through to impl', async () => {
    let capturedUris: readonly [string, string, string, string] | null = null;
    const svc = createEdgesService({
      grade: async (req) => {
        capturedUris = req.stripUris;
        return mockResult;
      },
    });
    await svc.grade(dummyRequest);
    expect(capturedUris).toEqual(FOUR_URIS);
  });
});
