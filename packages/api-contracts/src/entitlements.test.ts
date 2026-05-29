import { describe, expect, it } from 'vitest';

import {
  ENTITLEMENT_SOURCES,
  entitlementsDto,
  PAID_FEATURES,
  paidFeatureSchema,
} from './entitlements.js';

const VALID_PRO = {
  tier: 'pro' as const,
  activeFeatures: [...PAID_FEATURES],
  source: 'revenuecat' as const,
  checkedAt: '2026-05-29T12:00:00.000Z',
};

const VALID_FREE_FALLBACK = {
  tier: 'free' as const,
  activeFeatures: [],
  source: 'fallback' as const,
  checkedAt: '2026-05-29T12:00:00.000Z',
};

describe('PAID_FEATURES — pinned to PROJECT.md § 16', () => {
  it('is exactly the 9 pro-only capabilities (lockstep with @binderly/entitlements)', () => {
    expect([...PAID_FEATURES]).toEqual([
      'stack_scanner',
      'grading_prediction',
      'unlimited_custom_collections',
      'save_smart_collections',
      'unlimited_shareables',
      'shareable_themes',
      'pricing_history',
      'export_data',
      'cloud_ai_scan',
    ]);
  });
});

describe('ENTITLEMENT_SOURCES', () => {
  it('is revenuecat | fallback', () => {
    expect([...ENTITLEMENT_SOURCES]).toEqual(['revenuecat', 'fallback']);
  });
});

describe('entitlementsDto', () => {
  it('accepts a pro / revenuecat payload', () => {
    expect(entitlementsDto.parse(VALID_PRO)).toEqual(VALID_PRO);
  });

  it('accepts a free / fallback payload', () => {
    expect(entitlementsDto.parse(VALID_FREE_FALLBACK)).toEqual(VALID_FREE_FALLBACK);
  });

  it('rejects an unknown tier', () => {
    expect(entitlementsDto.safeParse({ ...VALID_PRO, tier: 'enterprise' }).success).toBe(false);
  });

  it('rejects an unknown source', () => {
    expect(entitlementsDto.safeParse({ ...VALID_PRO, source: 'stripe' }).success).toBe(false);
  });

  it('rejects an unknown feature in activeFeatures', () => {
    expect(
      entitlementsDto.safeParse({ ...VALID_PRO, activeFeatures: ['teleportation'] }).success,
    ).toBe(false);
  });

  it('rejects a non-offset checkedAt', () => {
    expect(entitlementsDto.safeParse({ ...VALID_PRO, checkedAt: '2026-05-29' }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys (.strict())', () => {
    expect(entitlementsDto.safeParse({ ...VALID_PRO, extra: true }).success).toBe(false);
  });
});

describe('paidFeatureSchema', () => {
  it('accepts each canonical feature', () => {
    for (const feature of PAID_FEATURES) {
      expect(paidFeatureSchema.parse(feature)).toBe(feature);
    }
  });
});
