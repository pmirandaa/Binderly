// AggregateService contract tests.
//
// These tests pin the `not_implemented` contract, the factory pattern, the
// request/result type shapes, the confidence-band literal, and the error
// guard.  They mirror the T-GR-SURFACE / T-GR-EDGES / T-GR-CORNERS test
// suite patterns exactly.

import { describe, expect, it } from 'vitest';

import { isAggregateError as isAggregateErrorFromErrors } from '../errors.js';
import {
  createAggregateService,
  defaultAggregateService,
} from '../service.js';
import {
  isAggregateError,
  SUBGRADE_NAMES,
} from '../types.js';

import type { CenteringResult } from '../../centering/types.js';
import type { CornersResult } from '../../corners/types.js';
import type { EdgesResult } from '../../edges/types.js';
import type { SurfaceResult } from '../../surface/types.js';
import type {
  AggregateRequest,
  AggregateResult,
  AggregateService,
  AggregateServiceErrorReason,
  ConfidenceBandLabel,
  SubGradeName,
} from '../types.js';

// ── Test fixtures ─────────────────────────────────────────────────────

const SESSION_ID = 'gcs-agg-test';

const mockCentering: CenteringResult = {
  sessionId: SESSION_ID,
  margins: null,
  hRatio: 0.7,
  vRatio: 0.7,
  gradeHint: '9',
  lowConfidence: false,
  lowConfidenceHolographic: false,
  flags: [],
};

const mockCorners: CornersResult = {
  sessionId: SESSION_ID,
  perCorner: [
    { label: 'top_left', band: { value: 8.5, confidence: 0.72 } },
    { label: 'top_right', band: { value: 8.5, confidence: 0.72 } },
    { label: 'bottom_left', band: { value: 8.5, confidence: 0.72 } },
    { label: 'bottom_right', band: { value: 8.5, confidence: 0.72 } },
  ],
  aggregate: { value: 8.5, confidence: 0.72 },
  modelVersion: 'v0-test',
};

const mockEdges: EdgesResult = {
  sessionId: SESSION_ID,
  perEdge: [
    { label: 'top', band: { value: 9.0, confidence: 0.7 } },
    { label: 'bottom', band: { value: 9.0, confidence: 0.7 } },
    { label: 'left', band: { value: 9.0, confidence: 0.7 } },
    { label: 'right', band: { value: 9.0, confidence: 0.7 } },
  ],
  aggregate: { value: 9.0, confidence: 0.7 },
  modelVersion: 'v0-test',
};

const mockSurface: SurfaceResult = {
  sessionId: SESSION_ID,
  perShot: [
    { label: 'front_full', band: { value: 8.0, confidence: 0.6 } },
    { label: 'back_full', band: { value: 8.0, confidence: 0.6 } },
  ],
  aggregate: { value: 8.0, confidence: 0.6 },
  modelVersion: 'v0-test',
};

const dummyRequest: AggregateRequest = {
  sessionId: SESSION_ID,
  centering: mockCentering,
  corners: mockCorners,
  edges: mockEdges,
  surface: mockSurface,
};

const mockSubGrades: Record<SubGradeName, number> = {
  centering: 9.0,
  corners: 8.5,
  edges: 9.0,
  surface: 8.0,
};

const mockResult: AggregateResult = {
  sessionId: SESSION_ID,
  overallGrade: 8.625,
  psaGrade: 8.5,
  confidenceBand: 'medium',
  subGrades: mockSubGrades,
  calibrationNotes: 'mock',
  modelVersion: 'v0-test',
};

// ── Factory tests ─────────────────────────────────────────────────────

describe('createAggregateService', () => {
  it('returns a service with an aggregate function', () => {
    const svc = createAggregateService();
    expect(typeof svc.aggregate).toBe('function');
  });

  it('default service returns a not_implemented error', async () => {
    const svc = createAggregateService();
    const result = await svc.aggregate(dummyRequest);
    expect(isAggregateError(result)).toBe(true);
    if (isAggregateError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });

  it('not_implemented error has a non-empty message', async () => {
    const svc = createAggregateService();
    const result = await svc.aggregate(dummyRequest);
    if (isAggregateError(result)) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('injected impl is used instead of the default', async () => {
    const mockSvc: AggregateService = {
      aggregate: async () => mockResult,
    };
    const svc = createAggregateService(mockSvc);
    const result = await svc.aggregate(dummyRequest);
    expect(isAggregateError(result)).toBe(false);
    expect(result).toBe(mockResult);
  });

  it('injected impl receives the full request', async () => {
    const received: AggregateRequest[] = [];
    const mockSvc: AggregateService = {
      aggregate: async (req) => {
        received.push(req);
        return { reason: 'network_error', message: 'test' };
      },
    };
    await createAggregateService(mockSvc).aggregate(dummyRequest);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(dummyRequest);
  });

  it('two calls with no impl both return not_implemented', async () => {
    const svc = createAggregateService();
    const [r1, r2] = await Promise.all([
      svc.aggregate(dummyRequest),
      svc.aggregate(dummyRequest),
    ]);
    expect(isAggregateError(r1)).toBe(true);
    expect(isAggregateError(r2)).toBe(true);
  });
});

// ── defaultAggregateService singleton ─────────────────────────────────

describe('defaultAggregateService', () => {
  it('is a singleton AggregateService', () => {
    expect(typeof defaultAggregateService.aggregate).toBe('function');
  });

  it('returns not_implemented immediately', async () => {
    const result = await defaultAggregateService.aggregate(dummyRequest);
    expect(isAggregateError(result)).toBe(true);
    if (isAggregateError(result)) {
      expect(result.reason).toBe('not_implemented');
    }
  });
});

// ── isAggregateError type guard ───────────────────────────────────────

describe('isAggregateError', () => {
  it('returns true for an AggregateServiceError', () => {
    expect(
      isAggregateError({ reason: 'not_implemented', message: 'x' }),
    ).toBe(true);
  });

  it('returns false for an AggregateResult', () => {
    expect(isAggregateError(mockResult)).toBe(false);
  });

  it('covers all error reasons', () => {
    const reasons: AggregateServiceErrorReason[] = [
      'not_implemented',
      'session_not_found',
      'network_error',
      'missing_subgrade',
      'invalid_input',
    ];
    for (const reason of reasons) {
      expect(
        isAggregateError({ reason, message: `test ${reason}` }),
      ).toBe(true);
    }
  });

  it('errors barrel re-export matches main export', () => {
    expect(isAggregateErrorFromErrors).toBe(isAggregateError);
  });
});

// ── AggregateResult shape pinning ─────────────────────────────────────

describe('AggregateResult shape', () => {
  it('SUBGRADE_NAMES contains canonical order', () => {
    expect([...SUBGRADE_NAMES]).toEqual([
      'centering',
      'corners',
      'edges',
      'surface',
    ]);
  });

  it('subGrades has all four canonical keys', () => {
    for (const name of SUBGRADE_NAMES) {
      expect(mockResult.subGrades[name]).toBeGreaterThanOrEqual(1.0);
      expect(mockResult.subGrades[name]).toBeLessThanOrEqual(10.0);
    }
  });

  it('overallGrade is in the valid PSA range', () => {
    expect(mockResult.overallGrade).toBeGreaterThanOrEqual(1.0);
    expect(mockResult.overallGrade).toBeLessThanOrEqual(10.0);
  });

  it('psaGrade is in the valid PSA range', () => {
    expect(mockResult.psaGrade).toBeGreaterThanOrEqual(1.0);
    expect(mockResult.psaGrade).toBeLessThanOrEqual(10.0);
  });

  it('psaGrade is a 0.5 tick', () => {
    const ticks = mockResult.psaGrade * 2;
    expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-6);
  });

  it('confidenceBand is one of the literal labels', () => {
    const valid: ConfidenceBandLabel[] = ['low', 'medium', 'high'];
    expect(valid).toContain(mockResult.confidenceBand);
  });

  it('sessionId is preserved in result', () => {
    expect(mockResult.sessionId).toBe(SESSION_ID);
  });

  it('modelVersion is present', () => {
    expect(mockResult.modelVersion.length).toBeGreaterThan(0);
  });
});

// ── Mock implementation pattern ───────────────────────────────────────

describe('mock implementation pattern', () => {
  it('mock service can return a successful result', async () => {
    const svc = createAggregateService({
      aggregate: async () => mockResult,
    });
    const result = await svc.aggregate(dummyRequest);
    expect(isAggregateError(result)).toBe(false);
    if (!isAggregateError(result)) {
      expect(result.modelVersion).toBe('v0-test');
      expect(result.confidenceBand).toBe('medium');
    }
  });

  it('mock service can return high-confidence result', async () => {
    const svc = createAggregateService({
      aggregate: async () => ({
        ...mockResult,
        confidenceBand: 'high',
      }),
    });
    const result = await svc.aggregate(dummyRequest);
    if (!isAggregateError(result)) {
      expect(result.confidenceBand).toBe('high');
    }
  });

  it('mock service can return low-confidence result', async () => {
    const svc = createAggregateService({
      aggregate: async () => ({
        ...mockResult,
        confidenceBand: 'low',
      }),
    });
    const result = await svc.aggregate(dummyRequest);
    if (!isAggregateError(result)) {
      expect(result.confidenceBand).toBe('low');
    }
  });

  it('mock service can return various error reasons', async () => {
    const reasons: AggregateServiceErrorReason[] = [
      'session_not_found',
      'network_error',
      'missing_subgrade',
      'invalid_input',
    ];
    for (const reason of reasons) {
      const svc = createAggregateService({
        aggregate: async () => ({ reason, message: `test ${reason}` }),
      });
      const result = await svc.aggregate(dummyRequest);
      expect(isAggregateError(result)).toBe(true);
      if (isAggregateError(result)) {
        expect(result.reason).toBe(reason);
      }
    }
  });
});
