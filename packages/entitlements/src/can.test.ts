import { describe, expect, it } from 'vitest';

import { canUseFeature, withinFreeLimit } from './can.js';
import { ALL_PAID_FEATURES, type PaidFeature } from './model.js';

describe('canUseFeature — pro tier unlocks every paid feature', () => {
  it.each(ALL_PAID_FEATURES)('pro can use %s', (feature) => {
    expect(canUseFeature('pro', feature)).toBe(true);
  });
});

describe('canUseFeature — free tier is blocked from every paid feature', () => {
  it.each(ALL_PAID_FEATURES)('free cannot use %s', (feature) => {
    expect(canUseFeature('free', feature)).toBe(false);
  });
});

describe('canUseFeature — spot checks for the named § 16 capabilities', () => {
  it('gates the stack scanner', () => {
    expect(canUseFeature('free', 'stack_scanner')).toBe(false);
    expect(canUseFeature('pro', 'stack_scanner')).toBe(true);
  });

  it('gates grading prediction', () => {
    expect(canUseFeature('free', 'grading_prediction')).toBe(false);
    expect(canUseFeature('pro', 'grading_prediction')).toBe(true);
  });

  it('gates saved smart collections', () => {
    expect(canUseFeature('free', 'save_smart_collections')).toBe(false);
    expect(canUseFeature('pro', 'save_smart_collections')).toBe(true);
  });

  it('gates shareable themes', () => {
    expect(canUseFeature('free', 'shareable_themes')).toBe(false);
    expect(canUseFeature('pro', 'shareable_themes')).toBe(true);
  });

  it('gates pricing history', () => {
    expect(canUseFeature('free', 'pricing_history')).toBe(false);
    expect(canUseFeature('pro', 'pricing_history')).toBe(true);
  });

  it('gates data export', () => {
    expect(canUseFeature('free', 'export_data')).toBe(false);
    expect(canUseFeature('pro', 'export_data')).toBe(true);
  });

  it('gates the cloud-AI scan fallback', () => {
    expect(canUseFeature('free', 'cloud_ai_scan')).toBe(false);
    expect(canUseFeature('pro', 'cloud_ai_scan')).toBe(true);
  });
});

describe('withinFreeLimit — custom collections (free cap = 3)', () => {
  it('allows creating from 0 owned', () => {
    expect(withinFreeLimit('free', 'customCollections', 0)).toBe(true);
  });

  it('allows creating at 2/3', () => {
    expect(withinFreeLimit('free', 'customCollections', 2)).toBe(true);
  });

  it('blocks creating at the 3/3 boundary', () => {
    expect(withinFreeLimit('free', 'customCollections', 3)).toBe(false);
  });

  it('blocks creating when already over the cap', () => {
    expect(withinFreeLimit('free', 'customCollections', 4)).toBe(false);
  });
});

describe('withinFreeLimit — shareables (free cap = 1)', () => {
  it('allows creating the first shareable from 0 owned', () => {
    expect(withinFreeLimit('free', 'shareables', 0)).toBe(true);
  });

  it('blocks creating at the 1/1 boundary', () => {
    expect(withinFreeLimit('free', 'shareables', 1)).toBe(false);
  });

  it('blocks creating when already over the cap', () => {
    expect(withinFreeLimit('free', 'shareables', 2)).toBe(false);
  });
});

describe('withinFreeLimit — pro is unbounded', () => {
  it('allows custom collections regardless of count', () => {
    expect(withinFreeLimit('pro', 'customCollections', 0)).toBe(true);
    expect(withinFreeLimit('pro', 'customCollections', 3)).toBe(true);
    expect(withinFreeLimit('pro', 'customCollections', 9999)).toBe(true);
  });

  it('allows shareables regardless of count', () => {
    expect(withinFreeLimit('pro', 'shareables', 1)).toBe(true);
    expect(withinFreeLimit('pro', 'shareables', 500)).toBe(true);
  });
});

describe('withinFreeLimit — defensive count normalization', () => {
  it('treats a negative custom-collection count as 0 (still allowed)', () => {
    expect(withinFreeLimit('free', 'customCollections', -1)).toBe(true);
  });

  it('treats a negative shareable count as 0 (still allowed)', () => {
    expect(withinFreeLimit('free', 'shareables', -5)).toBe(true);
  });

  it('treats NaN as 0 (still allowed under the cap)', () => {
    expect(withinFreeLimit('free', 'customCollections', Number.NaN)).toBe(true);
  });

  it('treats non-finite Infinity as 0 (garbage input → guard, not a real count)', () => {
    expect(withinFreeLimit('free', 'customCollections', Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('canUseFeature — full matrix is exhaustive', () => {
  it('returns a boolean for every (tier, feature) pair', () => {
    const tiers = ['free', 'pro'] as const;
    for (const tier of tiers) {
      for (const feature of ALL_PAID_FEATURES) {
        expect(typeof canUseFeature(tier, feature satisfies PaidFeature)).toBe('boolean');
      }
    }
  });
});
