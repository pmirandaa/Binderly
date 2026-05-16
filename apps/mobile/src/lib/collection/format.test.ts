import { describe, expect, it } from 'vitest';

import { clampPercent, formatCount, formatPercent } from './format';

describe('formatPercent', () => {
  it('rounds to the nearest integer', () => {
    expect(formatPercent(42.4)).toBe('42%');
    expect(formatPercent(42.6)).toBe('43%');
  });

  it('clamps below-range values to 0%', () => {
    expect(formatPercent(-5)).toBe('0%');
  });

  it('clamps above-range values to 100%', () => {
    expect(formatPercent(105)).toBe('100%');
  });

  it('returns 0% for non-finite values', () => {
    expect(formatPercent(Number.NaN)).toBe('0%');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0%');
  });
});

describe('formatCount', () => {
  it('formats owned/total as a plain fraction string', () => {
    expect(formatCount(12, 100)).toBe('12/100');
  });

  it('floors fractional inputs', () => {
    expect(formatCount(3.7, 9.2)).toBe('3/9');
  });

  it('clamps negative inputs to zero', () => {
    expect(formatCount(-2, -5)).toBe('0/0');
  });
});

describe('clampPercent', () => {
  it('passes through in-range values unchanged', () => {
    expect(clampPercent(42.5)).toBe(42.5);
  });

  it('clamps low and high', () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(150)).toBe(100);
  });

  it('returns 0 for NaN', () => {
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});
