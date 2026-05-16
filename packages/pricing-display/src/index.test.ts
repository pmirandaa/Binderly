import { describe, expect, it } from 'vitest';

import * as pkg from './index.js';

describe('@binderly/pricing-display — public surface', () => {
  it('exports the four functions named in the task spec', () => {
    expect(typeof pkg.convertPrice).toBe('function');
    expect(typeof pkg.convertPriceRange).toBe('function');
    expect(typeof pkg.bestEffortConvert).toBe('function');
    expect(typeof pkg.formatPrice).toBe('function');
    expect(typeof pkg.convertCurrentPriceRow).toBe('function');
  });

  it('exports the currency-validation helpers', () => {
    expect(typeof pkg.isSupportedCurrency).toBe('function');
    expect(typeof pkg.isWellFormedCurrencyCode).toBe('function');
  });

  it('exports the named constants', () => {
    expect(pkg.FX_BASE_CURRENCY).toBe('USD');
    expect(pkg.DEFAULT_LOCALE).toBe('en-US');
    expect(pkg.DEFAULT_FALLBACK_WINDOW_DAYS).toBe(7);
    expect(Array.isArray(pkg.SUPPORTED_CURRENCIES)).toBe(true);
    expect(pkg.SUPPORTED_CURRENCIES.length).toBeGreaterThanOrEqual(6);
    expect(pkg.SUPPORTED_CURRENCIES).toContain('USD');
    expect(pkg.SUPPORTED_CURRENCIES).toContain('EUR');
    expect(pkg.SUPPORTED_CURRENCIES).toContain('JPY');
    expect(pkg.SUPPORTED_CURRENCIES).toContain('GBP');
    expect(pkg.SUPPORTED_CURRENCIES).toContain('CAD');
    expect(pkg.SUPPORTED_CURRENCIES).toContain('AUD');
  });

  it('barrel does not leak internal helpers', () => {
    // Internal module-level symbols (parsePeriodStart,
    // lookupSingleLeg, etc.) must not be re-exported. The
    // exhaustive list of public exports is what the README
    // documents and what consumers can rely on.
    const expected = new Set([
      'convertPrice',
      'convertPriceRange',
      'bestEffortConvert',
      'formatPrice',
      'isSupportedCurrency',
      'isWellFormedCurrencyCode',
      'convertCurrentPriceRow',
      'DEFAULT_FALLBACK_WINDOW_DAYS',
      'DEFAULT_LOCALE',
      'FX_BASE_CURRENCY',
      'SUPPORTED_CURRENCIES',
    ]);
    const actual = Object.keys(pkg).sort();
    const unexpected = actual.filter((k) => !expected.has(k));
    expect(unexpected).toEqual([]);
  });
});
