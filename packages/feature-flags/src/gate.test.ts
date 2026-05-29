import { describe, expect, it } from 'vitest';

import { ALL_PAID_FEATURES, FREE_LIMITS, type PaidFeature } from '@binderly/entitlements';

import {
  evaluateGate,
  evaluateLimitGate,
  isAllowed,
  resourceToFeature,
  type GateBlocked,
  type GateEntitlement,
} from './gate.js';

const FREE: GateEntitlement = { tier: 'free' };
const PRO: GateEntitlement = { tier: 'pro' };

function expectBlocked(result: ReturnType<typeof evaluateGate>): GateBlocked {
  expect(result.allowed).toBe(false);
  if (result.allowed) throw new Error('expected blocked');
  return result;
}

describe('evaluateGate — every feature × tier', () => {
  for (const feature of ALL_PAID_FEATURES) {
    it(`pro is allowed for ${feature}`, () => {
      const result = evaluateGate(PRO, feature);
      expect(result.allowed).toBe(true);
    });

    it(`free is blocked for ${feature} with requires_pro`, () => {
      const result = evaluateGate(FREE, feature);
      const blocked = expectBlocked(result);
      expect(blocked.reason).toBe('requires_pro');
      expect(blocked.feature).toBe(feature);
      expect(blocked.limit).toBeUndefined();
    });
  }
});

describe('evaluateGate — result shape', () => {
  it('allowed result is exactly { allowed: true }', () => {
    expect(evaluateGate(PRO, 'export_data')).toEqual({ allowed: true });
  });

  it('blocked result carries reason + feature, no limit for on/off gates', () => {
    expect(evaluateGate(FREE, 'pricing_history')).toEqual({
      allowed: false,
      reason: 'requires_pro',
      feature: 'pricing_history',
    });
  });

  it('covers the full canonical 9-entry feature surface', () => {
    expect(ALL_PAID_FEATURES).toHaveLength(9);
  });
});

describe('evaluateLimitGate — customCollections (free cap 3)', () => {
  it('FREE_LIMITS pins the cap at 3', () => {
    expect(FREE_LIMITS.customCollections).toBe(3);
  });

  it('free at 0/3 is allowed', () => {
    expect(evaluateLimitGate(FREE, 'customCollections', 0).allowed).toBe(true);
  });

  it('free at 1/3 is allowed', () => {
    expect(evaluateLimitGate(FREE, 'customCollections', 1).allowed).toBe(true);
  });

  it('free at 2/3 is allowed (boundary just below cap)', () => {
    expect(evaluateLimitGate(FREE, 'customCollections', 2).allowed).toBe(true);
  });

  it('free at 3/3 is blocked (boundary at cap)', () => {
    const blocked = expectBlocked(evaluateLimitGate(FREE, 'customCollections', 3));
    expect(blocked.reason).toBe('free_limit_reached');
    expect(blocked.feature).toBe('unlimited_custom_collections');
    expect(blocked.limit).toBe(3);
  });

  it('free at 4/3 is blocked (over cap)', () => {
    expect(evaluateLimitGate(FREE, 'customCollections', 4).allowed).toBe(false);
  });

  it('free with a negative count is treated as 0 (allowed)', () => {
    expect(evaluateLimitGate(FREE, 'customCollections', -5).allowed).toBe(true);
  });

  it('free with NaN count is treated as 0 (allowed)', () => {
    expect(evaluateLimitGate(FREE, 'customCollections', Number.NaN).allowed).toBe(true);
  });

  it('pro is unbounded at the cap', () => {
    expect(evaluateLimitGate(PRO, 'customCollections', 3).allowed).toBe(true);
  });

  it('pro is unbounded far past the cap', () => {
    expect(evaluateLimitGate(PRO, 'customCollections', 9999).allowed).toBe(true);
  });
});

describe('evaluateLimitGate — shareables (free cap 1)', () => {
  it('FREE_LIMITS pins the cap at 1', () => {
    expect(FREE_LIMITS.shareables).toBe(1);
  });

  it('free at 0/1 is allowed', () => {
    expect(evaluateLimitGate(FREE, 'shareables', 0).allowed).toBe(true);
  });

  it('free at 1/1 is blocked (boundary at cap)', () => {
    const blocked = expectBlocked(evaluateLimitGate(FREE, 'shareables', 1));
    expect(blocked.reason).toBe('free_limit_reached');
    expect(blocked.feature).toBe('unlimited_shareables');
    expect(blocked.limit).toBe(1);
  });

  it('free at 2/1 is blocked (over cap)', () => {
    expect(evaluateLimitGate(FREE, 'shareables', 2).allowed).toBe(false);
  });

  it('pro is unbounded at the cap', () => {
    expect(evaluateLimitGate(PRO, 'shareables', 1).allowed).toBe(true);
  });

  it('pro is unbounded far past the cap', () => {
    expect(evaluateLimitGate(PRO, 'shareables', 500).allowed).toBe(true);
  });
});

describe('resourceToFeature', () => {
  it('maps customCollections → unlimited_custom_collections', () => {
    expect(resourceToFeature('customCollections')).toBe('unlimited_custom_collections');
  });

  it('maps shareables → unlimited_shareables', () => {
    expect(resourceToFeature('shareables')).toBe('unlimited_shareables');
  });

  it('returns a member of the canonical PaidFeature surface', () => {
    const f: PaidFeature = resourceToFeature('customCollections');
    expect(ALL_PAID_FEATURES).toContain(f);
  });
});

describe('isAllowed narrowing helper', () => {
  it('is true for an allowed gate', () => {
    expect(isAllowed(evaluateGate(PRO, 'stack_scanner'))).toBe(true);
  });

  it('is false for a blocked gate', () => {
    expect(isAllowed(evaluateGate(FREE, 'stack_scanner'))).toBe(false);
  });

  it('is false for a blocked limit gate', () => {
    expect(isAllowed(evaluateLimitGate(FREE, 'shareables', 1))).toBe(false);
  });
});

describe('parity with the freemium matrix', () => {
  it('blocks free users on the two count-limited features only via limit gates', () => {
    // The on/off gate for the unlimited_* features is still requires_pro
    // (a free user cannot "use unlimited"), but real call sites use the
    // limit gate. Assert both forms agree on the verdict for free.
    expect(evaluateGate(FREE, 'unlimited_custom_collections').allowed).toBe(false);
    expect(evaluateGate(FREE, 'unlimited_shareables').allowed).toBe(false);
  });

  it('grants pro every on/off feature', () => {
    const denied = ALL_PAID_FEATURES.filter((f) => !evaluateGate(PRO, f).allowed);
    expect(denied).toEqual([]);
  });
});
