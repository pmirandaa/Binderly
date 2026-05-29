import { describe, expect, it } from 'vitest';

import {
  ALL_PAID_FEATURES,
  FREE_LIMITS,
  PRO_ENTITLEMENT_ID,
  type PaidFeature,
} from './model.js';

describe('PRO_ENTITLEMENT_ID', () => {
  it('is the literal "pro" both billing surfaces grant/read', () => {
    expect(PRO_ENTITLEMENT_ID).toBe('pro');
  });
});

describe('ALL_PAID_FEATURES', () => {
  it('contains exactly the 9 pro-only capabilities from PROJECT.md § 16', () => {
    expect(ALL_PAID_FEATURES).toEqual([
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

  it('has no duplicate entries', () => {
    const unique = new Set<PaidFeature>(ALL_PAID_FEATURES);
    expect(unique.size).toBe(ALL_PAID_FEATURES.length);
  });
});

describe('FREE_LIMITS', () => {
  it('caps free custom collections at 3 (PROJECT.md § 16)', () => {
    expect(FREE_LIMITS.customCollections).toBe(3);
  });

  it('caps free shareables at 1 (PROJECT.md § 16)', () => {
    expect(FREE_LIMITS.shareables).toBe(1);
  });
});
