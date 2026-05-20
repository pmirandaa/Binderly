// SurfaceService contract tests.
//
// These tests pin the `not_implemented` contract, the factory pattern, the
// raking-light-optional request shape, and the request/result type shapes.
// They mirror the T-GR-CORNERS test suite pattern.

import { describe, expect, it } from 'vitest';

import {
  createSurfaceService,
  defaultSurfaceService,
} from '../surface-service.js';
import { isSurfaceError } from '../types.js';

import type {
  ConfidenceBand,
  SurfaceRequest,
  SurfaceResult,
  SurfaceService,
  SurfaceShotBand,
} from '../types.js';

// ── Test fixtures ─────────────────────────────────────────────────────

const dummyRequestV1: SurfaceRequest = {
  sessionId: 'gcs-surface-test',
  frontFullUri: 'file:///tmp/front.jpg',
  backFullUri: 'file:///tmp/back.jpg',
};

const dummyRequestWithRaking: SurfaceRequest = {
  sessionId: 'gcs-surface-raking',
  frontFullUri: 'file:///tmp/front.jpg',
  backFullUri: 'file:///tmp/back.jpg',
  rakingLightUri: 'file:///tmp/raking.jpg',
};

const mockBand: ConfidenceBand = { value: 8.5, confidence: 0.72 };

const mockShotsV1: SurfaceShotBand[] = [
  { label: 'front_full', band: mockBand },
  { label: 'back_full', band: mockBand },
];

const mockShotsWithRaking: SurfaceShotBand[] = [
  { label: 'front_full', band: mockBand },
  { label: 'back_full', band: mockBand },
  { label: 'raking_light', band: mockBand },
];

const mockResultV1: SurfaceResult = {
  sessionId: 'gcs-surface-test',
  perShot: mockShotsV1,
  aggregate: mockBand,
  modelVersion: 'v0-test',
};

const mockResultWithRaking: SurfaceResult = {
  sessionId: 'gcs-surface-raking',
  perShot: mockShotsWithRaking,
  aggregate: mockBand,
  modelVersion: 'v0-test',
};

// ── Factory tests ─────────────────────────────────────────────────────

describe('createSurfaceService', () => {
  it('returns a service with a grade function', () => {
    const svc = createSurfaceService();
    expect(typeof svc.grade).toBe('function');
  });

  it('default service returns a not_implemented error', async () => {
    const svc = createSurfaceService();
    const result = await svc.grade(dummyRequestV1);
    expect(isSurfaceError(result)).toBe(true);
    if (isSurfaceError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });

  it('not_implemented error has a non-empty message', async () => {
    const svc = createSurfaceService();
    const result = await svc.grade(dummyRequestV1);
    if (isSurfaceError(result)) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('injected impl is used instead of the default', async () => {
    const mockSvc: SurfaceService = { grade: async () => mockResultV1 };
    const svc = createSurfaceService(mockSvc);
    const result = await svc.grade(dummyRequestV1);
    expect(isSurfaceError(result)).toBe(false);
    expect(result).toBe(mockResultV1);
  });

  it('injected impl receives the request', async () => {
    const received: SurfaceRequest[] = [];
    const mockSvc: SurfaceService = {
      grade: async (req) => {
        received.push(req);
        return { reason: 'network_error', message: 'test' };
      },
    };
    await createSurfaceService(mockSvc).grade(dummyRequestV1);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(dummyRequestV1);
  });

  it('two calls with no impl both return not_implemented', async () => {
    const svc = createSurfaceService();
    const [r1, r2] = await Promise.all([
      svc.grade(dummyRequestV1),
      svc.grade(dummyRequestV1),
    ]);
    expect(isSurfaceError(r1)).toBe(true);
    expect(isSurfaceError(r2)).toBe(true);
  });

  it('raking-light request also returns not_implemented for default service', async () => {
    const svc = createSurfaceService();
    const result = await svc.grade(dummyRequestWithRaking);
    expect(isSurfaceError(result)).toBe(true);
    if (isSurfaceError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });
});

// ── defaultSurfaceService singleton ───────────────────────────────────

describe('defaultSurfaceService', () => {
  it('is a singleton SurfaceService', () => {
    expect(typeof defaultSurfaceService.grade).toBe('function');
  });

  it('returns not_implemented immediately', async () => {
    const result = await defaultSurfaceService.grade(dummyRequestV1);
    expect(isSurfaceError(result)).toBe(true);
    if (isSurfaceError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });
});

// ── isSurfaceError type guard ─────────────────────────────────────────

describe('isSurfaceError', () => {
  it('returns true for a SurfaceServiceError', () => {
    expect(isSurfaceError({ reason: 'not_implemented', message: 'x' })).toBe(true);
  });

  it('returns false for a SurfaceResult', () => {
    expect(isSurfaceError(mockResultV1)).toBe(false);
  });

  it('returns true for network_error reason', () => {
    expect(isSurfaceError({ reason: 'network_error', message: 'fail' })).toBe(true);
  });

  it('returns true for missing_required_shot reason', () => {
    expect(isSurfaceError({ reason: 'missing_required_shot', message: 'no front' })).toBe(true);
  });
});

// ── SurfaceResult shape pinning ───────────────────────────────────────

describe('SurfaceResult shape', () => {
  it('v1 result has exactly 2 perShot entries', () => {
    expect(mockResultV1.perShot.length).toBe(2);
  });

  it('raking-light result has exactly 3 perShot entries', () => {
    expect(mockResultWithRaking.perShot.length).toBe(3);
  });

  it('v1 shot labels are in canonical order', () => {
    const labels = mockResultV1.perShot.map((s) => s.label);
    expect(labels).toEqual(['front_full', 'back_full']);
  });

  it('raking shot labels include raking_light', () => {
    const labels = mockResultWithRaking.perShot.map((s) => s.label);
    expect(labels).toContain('raking_light');
  });

  it('aggregate confidence band is in valid range', () => {
    expect(mockResultV1.aggregate.value).toBeGreaterThanOrEqual(1.0);
    expect(mockResultV1.aggregate.value).toBeLessThanOrEqual(10.0);
    expect(mockResultV1.aggregate.confidence).toBeGreaterThanOrEqual(0.0);
    expect(mockResultV1.aggregate.confidence).toBeLessThanOrEqual(1.0);
  });

  it('per-shot bands are in valid range', () => {
    for (const shot of mockResultV1.perShot) {
      expect(shot.band.value).toBeGreaterThanOrEqual(1.0);
      expect(shot.band.value).toBeLessThanOrEqual(10.0);
      expect(shot.band.confidence).toBeGreaterThanOrEqual(0.0);
      expect(shot.band.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it('sessionId is preserved in result', () => {
    expect(mockResultV1.sessionId).toBe('gcs-surface-test');
  });
});

// ── SurfaceRequest raking-light-optional contract ─────────────────────

describe('SurfaceRequest raking-light-optional contract', () => {
  it('v1 request has no rakingLightUri', () => {
    expect(dummyRequestV1.rakingLightUri).toBeUndefined();
  });

  it('raking-light request includes rakingLightUri', () => {
    expect(dummyRequestWithRaking.rakingLightUri).toBe('file:///tmp/raking.jpg');
  });

  it('both requests have sessionId, frontFullUri, backFullUri', () => {
    for (const req of [dummyRequestV1, dummyRequestWithRaking]) {
      expect(req.sessionId).toBeTruthy();
      expect(req.frontFullUri).toBeTruthy();
      expect(req.backFullUri).toBeTruthy();
    }
  });
});

// ── Mock injection pattern ─────────────────────────────────────────────

describe('mock implementation pattern', () => {
  it('mock service can return a successful v1 result', async () => {
    const svc = createSurfaceService({ grade: async () => mockResultV1 });
    const result = await svc.grade(dummyRequestV1);
    expect(isSurfaceError(result)).toBe(false);
    if (!isSurfaceError(result)) {
      expect(result.modelVersion).toBe('v0-test');
    }
  });

  it('mock service can return a raking-light result', async () => {
    const svc = createSurfaceService({ grade: async () => mockResultWithRaking });
    const result = await svc.grade(dummyRequestWithRaking);
    expect(isSurfaceError(result)).toBe(false);
    if (!isSurfaceError(result)) {
      expect(result.perShot.length).toBe(3);
    }
  });

  it('mock service can return various error reasons', async () => {
    for (const reason of ['session_not_found', 'invalid_image', 'missing_required_shot'] as const) {
      const svc = createSurfaceService({
        grade: async () => ({ reason, message: `test ${reason}` }),
      });
      const result = await svc.grade(dummyRequestV1);
      expect(isSurfaceError(result)).toBe(true);
      if (isSurfaceError(result)) {
        expect(result.reason).toBe(reason);
      }
    }
  });
});
