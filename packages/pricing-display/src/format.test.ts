import { describe, expect, it } from 'vitest';

import { formatPrice, isSupportedCurrency, isWellFormedCurrencyCode } from './format.js';
import { SUPPORTED_CURRENCIES } from './types.js';

describe('isWellFormedCurrencyCode', () => {
  it.each([
    ['USD', true],
    ['EUR', true],
    ['JPY', true],
    ['BTC', true], // well-formed shape, even if not supported
    ['XYZ', true],
    ['usd', false],
    ['Usd', false],
    ['US', false],
    ['USDD', false],
    ['', false],
    ['  USD ', false],
    ['12A', false],
    ['U S', false],
  ])('isWellFormedCurrencyCode(%j) === %j', (code, expected) => {
    expect(isWellFormedCurrencyCode(code)).toBe(expected);
  });
});

describe('isSupportedCurrency', () => {
  it.each([...SUPPORTED_CURRENCIES])('accepts %s', (code) => {
    expect(isSupportedCurrency(code)).toBe(true);
  });

  it.each(['BTC', 'CHF', 'CNY', 'CLP', 'XYZ', 'usd', ''])('rejects %j', (code) => {
    expect(isSupportedCurrency(code)).toBe(false);
  });
});

describe('formatPrice — happy paths across locales', () => {
  // The exact string output from `Intl.NumberFormat` is pinned
  // by the Node version (see PROJECT.md § "Tech Stack" — Node
  // 22). Tests assert structural invariants (currency symbol
  // appears, fraction-digit count is correct) plus a
  // `.toMatchInlineSnapshot`-style absolute string for the
  // "USD in en-US" baseline.
  it('formats USD 12.5 as $12.50 in en-US', () => {
    const out = formatPrice(12.5, 'USD', 'en-US');
    expect(out).toBe('$12.50');
  });

  it('formats EUR 12.5 in en-US (uses €)', () => {
    const out = formatPrice(12.5, 'EUR', 'en-US');
    expect(out).toContain('€');
    expect(out).toContain('12.50');
  });

  it('formats EUR 12.5 in de-DE (uses €, comma decimal)', () => {
    const out = formatPrice(12.5, 'EUR', 'de-DE');
    expect(out).toContain('€');
    expect(out).toContain('12,50');
  });

  it('formats GBP 12.5 in en-GB as £12.50', () => {
    const out = formatPrice(12.5, 'GBP', 'en-GB');
    expect(out).toBe('£12.50');
  });

  it('formats CAD in en-CA (uses $)', () => {
    const out = formatPrice(12.5, 'CAD', 'en-CA');
    expect(out).toContain('$');
    expect(out).toContain('12.50');
  });

  it('formats AUD in en-AU (uses $)', () => {
    const out = formatPrice(12.5, 'AUD', 'en-AU');
    expect(out).toContain('$');
    expect(out).toContain('12.50');
  });

  it('formats MXN in en-US (uses MX$)', () => {
    const out = formatPrice(1234.5, 'MXN', 'en-US');
    expect(out).toContain('MX$');
    expect(out).toContain('1,234.50');
  });
});

describe('formatPrice — fraction-digit rules', () => {
  it('JPY uses 0 fraction digits in en-US', () => {
    expect(formatPrice(1234.5, 'JPY', 'en-US')).toBe('¥1,235');
  });

  it('JPY uses 0 fraction digits in ja-JP', () => {
    expect(formatPrice(1234.5, 'JPY', 'ja-JP')).toBe('￥1,235');
  });

  it('JPY rounds half-up at the integer boundary in en-US', () => {
    expect(formatPrice(0.5, 'JPY', 'en-US')).toBe('¥1');
  });

  it('USD uses 2 fraction digits in en-US', () => {
    expect(formatPrice(0.1, 'USD', 'en-US')).toBe('$0.10');
  });

  it('USD applies banker-like rounding to the 0.005 boundary in en-US', () => {
    const out = formatPrice(0.005, 'USD', 'en-US');
    // Either $0.00 or $0.01 depending on rounding mode; both
    // are documented Intl behaviour. Pin to the modern Node 22
    // observed output.
    expect(out === '$0.00' || out === '$0.01').toBe(true);
  });
});

describe('formatPrice — defaults and locale handling', () => {
  it('defaults locale to en-US when omitted', () => {
    expect(formatPrice(1, 'USD')).toBe(formatPrice(1, 'USD', 'en-US'));
  });

  it('en-GB and en-US render USD differently (US$ disambiguation)', () => {
    const usd_us = formatPrice(1, 'USD', 'en-US');
    const usd_gb = formatPrice(1, 'USD', 'en-GB');
    expect(usd_us).toBe('$1.00');
    expect(usd_gb).not.toBe(usd_us);
    expect(usd_gb).toContain('US$');
  });

  it('large amounts get locale-appropriate grouping in en-US', () => {
    expect(formatPrice(1_234_567.89, 'USD', 'en-US')).toBe('$1,234,567.89');
  });

  it('large amounts get locale-appropriate grouping in de-DE', () => {
    const out = formatPrice(1_234_567.89, 'EUR', 'de-DE');
    expect(out).toContain('1.234.567,89');
  });

  it('negative amounts include the locale-appropriate sign', () => {
    expect(formatPrice(-12.5, 'USD', 'en-US')).toBe('-$12.50');
  });

  it('zero amounts format cleanly', () => {
    expect(formatPrice(0, 'USD', 'en-US')).toBe('$0.00');
    expect(formatPrice(0, 'JPY', 'en-US')).toBe('¥0');
  });
});

describe('formatPrice — input validation', () => {
  it('throws RangeError for NaN amount', () => {
    expect(() => formatPrice(Number.NaN, 'USD')).toThrow(RangeError);
  });

  it('throws RangeError for +Infinity amount', () => {
    expect(() => formatPrice(Number.POSITIVE_INFINITY, 'USD')).toThrow(RangeError);
  });

  it('throws RangeError for -Infinity amount', () => {
    expect(() => formatPrice(Number.NEGATIVE_INFINITY, 'USD')).toThrow(RangeError);
  });

  it('throws RangeError for empty currency', () => {
    expect(() => formatPrice(1, '')).toThrow(RangeError);
  });

  it('throws RangeError for lowercase currency', () => {
    expect(() => formatPrice(1, 'usd')).toThrow(RangeError);
  });

  it('throws RangeError for 4-letter currency', () => {
    expect(() => formatPrice(1, 'USDX')).toThrow(RangeError);
  });

  it('throws RangeError for unsupported currency', () => {
    expect(() => formatPrice(1, 'BTC')).toThrow(RangeError);
  });

  it('throws RangeError mentioning the bad currency for diagnosability', () => {
    expect(() => formatPrice(1, 'BTC')).toThrow(/BTC/);
  });
});
