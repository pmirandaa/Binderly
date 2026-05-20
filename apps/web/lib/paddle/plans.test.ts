import { describe, expect, it } from 'vitest';

import {
  PLANS,
  PRO_ENTITLEMENT_ID,
  resolveEntitlementForPriceId,
  resolvePriceId,
  type PaddlePriceIds,
} from './plans';

describe('PLANS', () => {
  it('declares both monthly and annual variants', () => {
    const ids = PLANS.map((p) => p.id);
    expect(ids).toContain('pro_monthly');
    expect(ids).toContain('pro_annual');
  });

  it('every plan grants the pro entitlement', () => {
    for (const plan of PLANS) {
      expect(plan.entitlementId).toBe(PRO_ENTITLEMENT_ID);
    }
  });

  it('every plan includes a non-empty feature list', () => {
    for (const plan of PLANS) {
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });
});

describe('resolvePriceId', () => {
  const prices: PaddlePriceIds = { monthly: 'pri_m', annual: 'pri_a' };

  it('returns the monthly price id for monthly plans', () => {
    const monthly = PLANS.find((p) => p.interval === 'monthly');
    expect(monthly).toBeDefined();
    if (monthly === undefined) return;
    expect(resolvePriceId(monthly, prices)).toBe('pri_m');
  });

  it('returns the annual price id for annual plans', () => {
    const annual = PLANS.find((p) => p.interval === 'annual');
    expect(annual).toBeDefined();
    if (annual === undefined) return;
    expect(resolvePriceId(annual, prices)).toBe('pri_a');
  });

  it('returns null when the matching env price id is null', () => {
    const monthly = PLANS.find((p) => p.interval === 'monthly');
    if (monthly === undefined) return;
    expect(resolvePriceId(monthly, { monthly: null, annual: 'pri_a' })).toBeNull();
  });
});

describe('resolveEntitlementForPriceId', () => {
  const prices: PaddlePriceIds = { monthly: 'pri_m', annual: 'pri_a' };

  it('finds the monthly plan for the monthly price id', () => {
    const result = resolveEntitlementForPriceId('pri_m', prices);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.plan.interval).toBe('monthly');
    expect(result.entitlementId).toBe(PRO_ENTITLEMENT_ID);
  });

  it('finds the annual plan for the annual price id', () => {
    const result = resolveEntitlementForPriceId('pri_a', prices);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.plan.interval).toBe('annual');
  });

  it('returns null for unknown price ids', () => {
    expect(resolveEntitlementForPriceId('pri_unknown', prices)).toBeNull();
  });

  it('does not match when the corresponding env id is null', () => {
    expect(resolveEntitlementForPriceId('pri_m', { monthly: null, annual: 'pri_a' })).toBeNull();
  });
});
