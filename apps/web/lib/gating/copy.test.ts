import { describe, expect, it } from 'vitest';

import { ALL_PAID_FEATURES } from '@binderly/entitlements';

import { describeGate, FEATURE_LABELS } from './copy';

describe('FEATURE_LABELS', () => {
  it('has a non-empty label for every canonical paid feature', () => {
    for (const feature of ALL_PAID_FEATURES) {
      expect(FEATURE_LABELS[feature].length).toBeGreaterThan(0);
    }
  });

  it('covers exactly the 9 canonical features', () => {
    expect(Object.keys(FEATURE_LABELS).sort()).toEqual([...ALL_PAID_FEATURES].sort());
  });
});

describe('describeGate', () => {
  it('requires_pro names the feature label in the body', () => {
    const copy = describeGate('pricing_history', 'requires_pro');
    expect(copy.title).toBe('Upgrade to Pro');
    expect(copy.body).toContain(FEATURE_LABELS.pricing_history);
    expect(copy.body).toContain('Pro feature');
  });

  it('free_limit_reached includes the numeric limit', () => {
    const copy = describeGate('unlimited_custom_collections', 'free_limit_reached', 3);
    expect(copy.body).toContain('up to 3');
  });

  it('free_limit_reached with limit 1 reads correctly', () => {
    const copy = describeGate('unlimited_shareables', 'free_limit_reached', 1);
    expect(copy.body).toContain('up to 1');
  });

  it('free_limit_reached without a limit falls back to generic copy', () => {
    const copy = describeGate('unlimited_custom_collections', 'free_limit_reached');
    expect(copy.body).toContain('limit');
    expect(copy.body).not.toContain('undefined');
  });

  it('produces a title + non-empty body for every requires_pro feature', () => {
    for (const feature of ALL_PAID_FEATURES) {
      const copy = describeGate(feature, 'requires_pro');
      expect(copy.title).toBe('Upgrade to Pro');
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body).not.toContain('undefined');
    }
  });
});
