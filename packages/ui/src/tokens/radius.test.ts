import { describe, expect, it } from 'vitest';

import { RADIUS_LINEAR_ORDER, radius } from './radius.js';

describe('radius tokens', () => {
  it('declares the canonical names', () => {
    expect(radius.none).toBe(0);
    expect(radius.xs).toBe(2);
    expect(radius.sm).toBe(4);
    expect(radius.md).toBe(8);
    expect(radius.lg).toBe(12);
    expect(radius.xl).toBe(16);
    expect(radius['2xl']).toBe(24);
  });

  it('exposes pill and circle as a single large value', () => {
    expect(radius.pill).toBe(9999);
    expect(radius.circle).toBe(9999);
  });

  it('RADIUS_LINEAR_ORDER is strictly monotone', () => {
    let prev = -1;
    for (const key of RADIUS_LINEAR_ORDER) {
      const value = radius[key];
      expect(value).toBeGreaterThan(prev);
      prev = value;
    }
  });

  it('every value is a non-negative integer', () => {
    for (const value of Object.values(radius)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
