import { describe, expect, it } from 'vitest';

import { SPACE_ORDER, space } from './space.js';

describe('space tokens', () => {
  it('declares every key in SPACE_ORDER', () => {
    for (const key of SPACE_ORDER) {
      expect(typeof space[key]).toBe('number');
    }
  });

  it('starts at $0 = 0', () => {
    expect(space.$0).toBe(0);
  });

  it('uses px-aligned values for the integer keys (4-step rhythm)', () => {
    expect(space.$1).toBe(4);
    expect(space.$2).toBe(8);
    expect(space.$3).toBe(12);
    expect(space.$4).toBe(16);
    expect(space.$6).toBe(24);
    expect(space.$24).toBe(96);
  });

  it('exposes the half-step values', () => {
    expect(space['$0.5']).toBe(2);
    expect(space['$1.5']).toBe(6);
  });

  it('SPACE_ORDER is monotone non-decreasing', () => {
    let prev = -1;
    for (const key of SPACE_ORDER) {
      const value = space[key];
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it('SPACE_ORDER is strictly monotone increasing', () => {
    let prev = -1;
    for (const key of SPACE_ORDER) {
      const value = space[key];
      expect(value).toBeGreaterThan(prev);
      prev = value;
    }
  });

  it('has no duplicate values', () => {
    const values = SPACE_ORDER.map((key) => space[key]);
    expect(new Set(values).size).toBe(values.length);
  });
});
