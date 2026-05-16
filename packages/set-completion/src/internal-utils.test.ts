// Direct unit tests for the shared helpers. The downstream modules
// already exercise these via their own tests, but we keep a
// dedicated suite so a regression in `safePct` / `uniqueIds` shows
// up immediately rather than smearing across four test files.

import { describe, expect, it } from 'vitest';

import { safePct, uniqueIds } from './internal-utils.js';

describe('safePct', () => {
  it('returns 0 for 0/0 (NOT NaN)', () => {
    expect(safePct(0, 0)).toBe(0);
  });

  it('returns 0 when denominator is negative (defensive)', () => {
    // Numerator-positive / denominator-negative would be ill-defined;
    // safePct treats `denominator <= 0` as "empty population" and
    // returns 0. Documented in the source.
    expect(safePct(5, -1)).toBe(0);
  });

  it('returns 0 when denominator is exactly 0 with non-zero numerator', () => {
    expect(safePct(7, 0)).toBe(0);
  });

  it('100% case: numerator === denominator', () => {
    expect(safePct(3, 3)).toBe(100);
    expect(safePct(1000, 1000)).toBe(100);
  });

  it('50% case', () => {
    expect(safePct(1, 2)).toBe(50);
  });

  it('25% case', () => {
    expect(safePct(1, 4)).toBe(25);
  });

  it('0% case (empty numerator, non-empty denominator)', () => {
    expect(safePct(0, 100)).toBe(0);
  });

  it('does not round — preserves full precision', () => {
    // 1/3 → 33.333... ; assert no clamping to two decimals.
    expect(safePct(1, 3)).toBeCloseTo(33.3333333333333, 10);
  });

  it('linear scale-invariance: f(2n, 2d) == f(n, d)', () => {
    expect(safePct(7, 21)).toBeCloseTo(safePct(14, 42), 10);
  });

  it('numerator > denominator (caller bug) — math is unbounded; documented contract', () => {
    // We do NOT clamp; the caller's responsibility is to ensure
    // numerator <= denominator. The public compute* functions
    // enforce that bound by construction (numerator is a subset of
    // denominator's pool), so this is a safety statement that the
    // helper itself is unbounded.
    expect(safePct(5, 1)).toBe(500);
  });
});

describe('uniqueIds', () => {
  it('empty input ⇒ empty Set', () => {
    expect(uniqueIds([]).size).toBe(0);
  });

  it('dedups duplicates', () => {
    expect(uniqueIds(['a', 'a', 'b', 'a', 'c', 'b']).size).toBe(3);
  });

  it('returns a Set instance with O(1) `.has`', () => {
    const set = uniqueIds(['x', 'y', 'z']);
    expect(set instanceof Set).toBe(true);
    expect(set.has('x')).toBe(true);
    expect(set.has('w')).toBe(false);
  });

  it('preserves insertion order in iteration (Set semantics)', () => {
    expect([...uniqueIds(['c', 'a', 'b'])]).toEqual(['c', 'a', 'b']);
  });

  it('handles empty strings as distinct ids', () => {
    expect(uniqueIds(['', '']).size).toBe(1);
    expect(uniqueIds(['', 'a']).size).toBe(2);
  });

  it('does not mutate input', () => {
    const input = ['a', 'a', 'b'];
    const copy = [...input];
    uniqueIds(input);
    expect(input).toEqual(copy);
  });
});
