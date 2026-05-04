import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetSetCodeAliasesForTests,
  lookupCanonicalSetCode,
  normalizeSetCode,
  registerSetCodeAlias,
} from './set-code.js';

afterEach(() => {
  _resetSetCodeAliasesForTests();
});

describe('normalizeSetCode', () => {
  it('lowercases and strips whitespace', () => {
    expect(normalizeSetCode('SWSH9')).toBe('swsh9');
    expect(normalizeSetCode('  swsh9  ')).toBe('swsh9');
    expect(normalizeSetCode('Brilliant Stars')).toBe('brilliantstars');
    expect(normalizeSetCode('SV/1')).toBe('sv1');
  });

  it('is idempotent', () => {
    const a = normalizeSetCode('SWSH9');
    const b = normalizeSetCode(a);
    expect(a).toBe(b);
  });

  it('throws on empty', () => {
    expect(() => normalizeSetCode('   ')).toThrow();
  });
});

describe('registerSetCodeAlias / lookupCanonicalSetCode', () => {
  it('returns null when no alias is registered', () => {
    expect(lookupCanonicalSetCode('test', 'foo')).toBeNull();
  });

  it('round-trips registered aliases', () => {
    registerSetCodeAlias('test', 'wizards-promo', 'wizpromo');
    expect(lookupCanonicalSetCode('test', 'wizards-promo')).toBe('wizpromo');
  });

  it('lookups are case-insensitive on the source-code side', () => {
    registerSetCodeAlias('test', 'WIZARDS-PROMO', 'wizpromo');
    expect(lookupCanonicalSetCode('test', 'wizards-promo')).toBe('wizpromo');
  });
});
