// comparator.test.ts — pure LWW comparator semantics.

import { describe, expect, it } from 'vitest';

import { compareLocalNewer } from '../resolver.js';

describe('compareLocalNewer', () => {
  it('local strictly newer → local wins', () => {
    expect(
      compareLocalNewer('2026-06-01T12:00:01.000Z', '2026-06-01T12:00:00.000Z'),
    ).toBe(true);
  });

  it('server strictly newer → server wins', () => {
    expect(
      compareLocalNewer('2026-06-01T12:00:00.000Z', '2026-06-01T12:00:01.000Z'),
    ).toBe(false);
  });

  it('exact tie → server wins (false)', () => {
    expect(
      compareLocalNewer('2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z'),
    ).toBe(false);
  });

  it('local null → server wins (no compare possible)', () => {
    expect(compareLocalNewer(null, '2026-06-01T12:00:00.000Z')).toBe(false);
  });

  it('server null → server wins (no compare possible)', () => {
    expect(compareLocalNewer('2026-06-01T12:00:00.000Z', null)).toBe(false);
  });

  it('both null → server wins', () => {
    expect(compareLocalNewer(null, null)).toBe(false);
  });

  it('compares ISO-8601 strings lexicographically (UTC Z)', () => {
    // 23:59:59 < 24:00:00 (next day) lexicographically and chronologically
    expect(
      compareLocalNewer('2026-06-02T00:00:00.000Z', '2026-06-01T23:59:59.000Z'),
    ).toBe(true);
  });

  it('millisecond resolution matters', () => {
    expect(
      compareLocalNewer('2026-06-01T12:00:00.001Z', '2026-06-01T12:00:00.000Z'),
    ).toBe(true);
    expect(
      compareLocalNewer('2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.001Z'),
    ).toBe(false);
  });

  it('non-UTC timezone defensive fallback uses Date.parse', () => {
    // Same instant, different representations. Lex would say
    // '...+00:00' < '...-05:00'; Date.parse normalises both to UTC ms.
    const a = '2026-06-01T12:00:01-00:00';
    const b = '2026-06-01T12:00:00+00:00';
    expect(compareLocalNewer(a, b)).toBe(true);
  });

  it('un-parseable timestamps fall through to server-wins', () => {
    expect(compareLocalNewer('not-a-date', 'also-not')).toBe(false);
  });
});
