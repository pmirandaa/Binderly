import { describe, expect, it } from 'vitest';

import { SHADOW_ORDER, shadows } from './shadows.js';

describe('shadow tokens', () => {
  it('declares 5 elevation tiers (none, xs, sm, md, lg)', () => {
    expect(SHADOW_ORDER).toEqual(['none', 'xs', 'sm', 'md', 'lg']);
  });

  it('every tier exposes a web boxShadow + native shadow tuple', () => {
    for (const tier of SHADOW_ORDER) {
      const spec = shadows[tier];
      expect(typeof spec.web.boxShadow).toBe('string');
      expect(typeof spec.native.shadowColor).toBe('string');
      expect(typeof spec.native.shadowOffset.height).toBe('number');
      expect(typeof spec.native.shadowOpacity).toBe('number');
      expect(typeof spec.native.shadowRadius).toBe('number');
      expect(typeof spec.native.elevation).toBe('number');
    }
  });

  it('the `none` tier is fully transparent', () => {
    expect(shadows.none.web.boxShadow).toBe('none');
    expect(shadows.none.native.shadowOpacity).toBe(0);
    expect(shadows.none.native.shadowRadius).toBe(0);
    expect(shadows.none.native.elevation).toBe(0);
  });

  it('elevation grows monotonically across the order', () => {
    let prev = -1;
    for (const tier of SHADOW_ORDER) {
      const elevation = shadows[tier].native.elevation;
      expect(elevation).toBeGreaterThanOrEqual(prev);
      prev = elevation;
    }
  });

  it('shadowRadius grows non-decreasingly across the order', () => {
    let prev = -1;
    for (const tier of SHADOW_ORDER) {
      const radius = shadows[tier].native.shadowRadius;
      expect(radius).toBeGreaterThanOrEqual(prev);
      prev = radius;
    }
  });

  it('boxShadow strings differ across non-trivial tiers', () => {
    const seen = new Set<string>();
    for (const tier of SHADOW_ORDER) {
      seen.add(shadows[tier].web.boxShadow);
    }
    expect(seen.size).toBe(SHADOW_ORDER.length);
  });
});
