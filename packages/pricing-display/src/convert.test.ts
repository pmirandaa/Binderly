import { describe, expect, it } from 'vitest';

import { bestEffortConvert, convertPrice, convertPriceRange } from './convert.js';
import { CANONICAL_WEEK, makeFixtureLookup, utcDate } from './test-fixtures.js';
import {
  DEFAULT_FALLBACK_WINDOW_DAYS,
  SUPPORTED_CURRENCIES,
  type FxRateLookup,
  type SupportedCurrency,
} from './types.js';

const lookup = makeFixtureLookup(CANONICAL_WEEK);
const APR_30 = utcDate('2026-04-30');

// ---------------------------------------------------------------
// 1. Identity (input ccy === target ccy) for each supported ccy
// ---------------------------------------------------------------

describe('convertPrice — identity (source === target)', () => {
  it.each([...SUPPORTED_CURRENCIES])('identity for %s skips FX entirely', (ccy) => {
    const result = convertPrice(
      { amount: 12.5, currency: ccy, observedAt: APR_30 },
      { targetCurrency: ccy, rateLookup: lookup },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isIdentity).toBe(true);
    expect(result.value.usedFallback).toBe(false);
    expect(result.value.amount).toBe(12.5);
    expect(result.value.currency).toBe(ccy);
    expect(result.value.rate).toBe(1);
    expect(result.value.rateDate).toEqual(APR_30);
  });

  it('identity does NOT consult the rateLookup', () => {
    let calls = 0;
    const tattlingLookup: FxRateLookup = (currency, date) => {
      calls++;
      return lookup(currency, date);
    };
    convertPrice(
      { amount: 9.99, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: tattlingLookup },
    );
    expect(calls).toBe(0);
  });

  it('identity formats with the requested locale', () => {
    const result = convertPrice(
      { amount: 1234.5, currency: 'JPY', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup, locale: 'ja-JP' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toBe('￥1,235');
  });
});

// ---------------------------------------------------------------
// 2. Direct conversion (USD <-> X)
// ---------------------------------------------------------------

describe('convertPrice — direct USD ↔ X', () => {
  it('USD → JPY at 156.56 multiplies cleanly', () => {
    const result = convertPrice(
      { amount: 10, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(10 * 156.56, 6);
    expect(result.value.rate).toBe(156.56);
    expect(result.value.usedFallback).toBe(false);
    expect(result.value.isIdentity).toBe(false);
    expect(result.value.rateDate).toEqual(APR_30);
    expect(result.value.display).toBe('¥1,566');
  });

  it('USD → EUR at 0.85455 multiplies cleanly', () => {
    const result = convertPrice(
      { amount: 100, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup, locale: 'en-US' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(85.455, 6);
    expect(result.value.rate).toBe(0.85455);
    expect(result.value.display).toBe('€85.46');
  });

  it('JPY → USD divides by 156.56', () => {
    const result = convertPrice(
      { amount: 1565.6, currency: 'JPY', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(10, 6);
    expect(result.value.rate).toBeCloseTo(1 / 156.56, 12);
    expect(result.value.display).toBe('$10.00');
  });

  it('EUR → USD divides by 0.85455', () => {
    const result = convertPrice(
      { amount: 100, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(100 / 0.85455, 6);
  });

  it('GBP → USD divides by 0.74026', () => {
    const result = convertPrice(
      { amount: 50, currency: 'GBP', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(50 / 0.74026, 6);
  });

  it('USD → CAD multiplies by 1.3789', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'CAD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(1.3789, 6);
  });

  it('USD → AUD multiplies by 1.5478', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'AUD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(1.5478, 6);
  });

  it('USD → MXN multiplies by 17.2945', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'MXN', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(17.2945, 6);
  });
});

// ---------------------------------------------------------------
// 3. Cross conversion (X → Y via USD)
// ---------------------------------------------------------------

describe('convertPrice — cross-currency (X → Y via USD)', () => {
  it('EUR → JPY: composes 1/rate(EUR) * rate(JPY)', () => {
    const result = convertPrice(
      { amount: 100, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    const expected = (100 / 0.85455) * 156.56;
    expect(result.value.amount).toBeCloseTo(expected, 6);
    expect(result.value.rate).toBeCloseTo((1 / 0.85455) * 156.56, 12);
    expect(result.value.usedFallback).toBe(false);
  });

  it('GBP → EUR via USD', () => {
    const result = convertPrice(
      { amount: 100, currency: 'GBP', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    const expected = (100 / 0.74026) * 0.85455;
    expect(result.value.amount).toBeCloseTo(expected, 6);
  });

  it('JPY → EUR — fails the "I forgot which way the rate goes" smoke test', () => {
    // Important regression test: if the math accidentally
    // multiplied JPY by rate(JPY) (instead of dividing), 1000
    // JPY would balloon to 156,560 EUR. The right answer is
    // 1000 / 156.56 * 0.85455 ≈ 5.46 EUR.
    const result = convertPrice(
      { amount: 1000, currency: 'JPY', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo((1000 / 156.56) * 0.85455, 6);
    expect(result.value.amount).toBeLessThan(10);
  });

  it('CAD → AUD', () => {
    const result = convertPrice(
      { amount: 100, currency: 'CAD', observedAt: APR_30 },
      { targetCurrency: 'AUD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo((100 / 1.3789) * 1.5478, 6);
  });

  it('cross-currency round-trip is the identity (modulo float)', () => {
    const eurResult = convertPrice(
      { amount: 100, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!eurResult.ok) throw new Error('expected ok');
    const back = convertPrice(
      { amount: eurResult.value.amount, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    if (!back.ok) throw new Error('expected ok');
    expect(back.value.amount).toBeCloseTo(100, 8);
  });
});

// ---------------------------------------------------------------
// 4. Date hits + fallback window
// ---------------------------------------------------------------

describe('convertPrice — date / fallback semantics', () => {
  it('exact-date hit reports usedFallback=false and rateDate=observedAt', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.usedFallback).toBe(false);
    expect(result.value.rateDate).toEqual(APR_30);
  });

  it('1-day fallback hit when observedAt has no rate', () => {
    // Hole on 2026-05-01; nearest prior is 2026-04-30.
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: utcDate('2026-05-01') },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.usedFallback).toBe(true);
    expect(result.value.rateDate).toEqual(APR_30);
    expect(result.value.rate).toBe(0.85455);
  });

  it('7-day fallback hit at the default-window edge', () => {
    // observedAt = 2026-05-01; 2026-04-24 is 7 days back ⇒
    // last hit allowed by the default window. (Saturday/Sunday
    // 2026-04-25/26 + Mon 27 + Tue 28 + Wed 29 + Thu 30 + Fri
    // 2026-05-01 not in fixture.)
    const observedAt = utcDate('2026-05-01');
    // Use a fixture that ONLY has 2026-04-24 to force the
    // walk-back to the edge of the default window.
    const sparseLookup = makeFixtureLookup([
      { currency: 'EUR', date: '2026-04-24', rate: 0.85901 },
    ]);
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt },
      { targetCurrency: 'EUR', rateLookup: sparseLookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.usedFallback).toBe(true);
    expect(result.value.rateDate).toEqual(utcDate('2026-04-24'));
    expect(result.value.rate).toBe(0.85901);
  });

  it('fallback exhausted ⇒ no-rate (default window of 7 days)', () => {
    // observedAt = 2026-05-02; 2026-04-24 is 8 days back ⇒
    // outside the default 7-day window.
    const observedAt = utcDate('2026-05-02');
    const sparseLookup = makeFixtureLookup([
      { currency: 'EUR', date: '2026-04-24', rate: 0.85901 },
    ]);
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt },
      { targetCurrency: 'EUR', rateLookup: sparseLookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });

  it('extending fallbackWindowDays past the gap recovers the rate', () => {
    const observedAt = utcDate('2026-05-15');
    const sparseLookup = makeFixtureLookup([
      { currency: 'EUR', date: '2026-04-24', rate: 0.85901 },
    ]);
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt },
      { targetCurrency: 'EUR', rateLookup: sparseLookup, fallbackWindowDays: 30 },
    );
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.value.rateDate).toEqual(utcDate('2026-04-24'));
    expect(result.value.usedFallback).toBe(true);
  });

  it('fallbackWindowDays=0 disables fallback (only exact-date considered)', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: utcDate('2026-05-01') },
      { targetCurrency: 'EUR', rateLookup: lookup, fallbackWindowDays: 0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });

  it('NEVER walks forward — future-only rates do not count', () => {
    // observedAt = 2026-04-23; nearest fixture rate is on
    // 2026-04-24 (one day FORWARD). Even with a generous
    // window, we must not use it.
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: utcDate('2026-04-23') },
      { targetCurrency: 'EUR', rateLookup: lookup, fallbackWindowDays: 365 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });

  it('future observedAt with no past rate returns no-rate (no time travel)', () => {
    // Hand the SUT a far-future observedAt; no fixture rate
    // backwards from it within the window.
    const sparseLookup = makeFixtureLookup([
      { currency: 'EUR', date: '2030-01-01', rate: 0.9 }, // future relative to observedAt
    ]);
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: utcDate('2026-05-01') },
      { targetCurrency: 'EUR', rateLookup: sparseLookup, fallbackWindowDays: 365 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });

  it('cross-currency reports rateDate as the OLDER of the two legs', () => {
    // Source rate (EUR) on 2026-04-30; target rate (JPY)
    // missing on 2026-04-30 — must fall back one day.
    const sparseLookup = makeFixtureLookup([
      { currency: 'EUR', date: '2026-04-30', rate: 0.85455 },
      { currency: 'JPY', date: '2026-04-29', rate: 158.95 },
    ]);
    const result = convertPrice(
      { amount: 100, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: sparseLookup },
    );
    if (!result.ok) throw new Error('expected ok');
    // The composite rate uses each leg's actual reported rate
    // — EUR's exact-date rate, JPY's fallback rate.
    expect(result.value.amount).toBeCloseTo((100 / 0.85455) * 158.95, 6);
    // RateDate is the OLDER (the limiting factor).
    expect(result.value.rateDate).toEqual(utcDate('2026-04-29'));
    expect(result.value.usedFallback).toBe(true);
  });

  it('cross-currency: both legs hit exact date ⇒ usedFallback=false', () => {
    const result = convertPrice(
      { amount: 100, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.usedFallback).toBe(false);
    expect(result.value.rateDate).toEqual(APR_30);
  });

  it('time-of-day in observedAt is ignored (canonicalized to UTC midnight)', () => {
    const noonUtc = new Date(Date.UTC(2026, 3, 30, 12, 30, 45, 999));
    const noonResult = convertPrice(
      { amount: 1, currency: 'USD', observedAt: noonUtc },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    const midnightResult = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(noonResult).toEqual(midnightResult);
  });

  it('negative fallbackWindowDays normalizes to 0 (exact-date only)', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: utcDate('2026-05-01') },
      { targetCurrency: 'EUR', rateLookup: lookup, fallbackWindowDays: -10 },
    );
    expect(result.ok).toBe(false);
  });

  it('fractional fallbackWindowDays floors to integer days', () => {
    const observedAt = utcDate('2026-05-01');
    const sparseLookup = makeFixtureLookup([{ currency: 'EUR', date: '2026-04-30', rate: 0.85 }]);
    // 0.5 days floors to 0 ⇒ only exact-date considered ⇒ miss.
    const halfDay = convertPrice(
      { amount: 1, currency: 'USD', observedAt },
      { targetCurrency: 'EUR', rateLookup: sparseLookup, fallbackWindowDays: 0.5 },
    );
    expect(halfDay.ok).toBe(false);
    // 1.5 days floors to 1 ⇒ hits 2026-04-30.
    const oneAndAHalf = convertPrice(
      { amount: 1, currency: 'USD', observedAt },
      { targetCurrency: 'EUR', rateLookup: sparseLookup, fallbackWindowDays: 1.5 },
    );
    expect(oneAndAHalf.ok).toBe(true);
  });

  it('default fallback window constant matches DEFAULT_FALLBACK_WINDOW_DAYS=7', () => {
    expect(DEFAULT_FALLBACK_WINDOW_DAYS).toBe(7);
  });
});

// ---------------------------------------------------------------
// 5. Failure reasons
// ---------------------------------------------------------------

describe('convertPrice — failure modes', () => {
  it('unsupported source currency ⇒ invalid-input (caught at observation validation)', () => {
    const result = convertPrice(
      { amount: 1, currency: 'BTC', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(result.message).toMatch(/BTC/);
  });

  it('unsupported target currency ⇒ unsupported-currency', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'BTC', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-currency');
    expect(result.message).toMatch(/BTC/);
  });

  it('NaN amount ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: Number.NaN, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('+Infinity amount ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: Number.POSITIVE_INFINITY, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('empty currency ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: '', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('lowercase source currency ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: 'usd', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('empty targetCurrency ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: '', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('lowercase targetCurrency ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'eur', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('invalid Date observedAt ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: new Date('not-a-date') },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('non-Date observedAt ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: '2026-04-30' as any },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('non-string source currency ⇒ invalid-input', () => {
    const result = convertPrice(
      { amount: 1, currency: 123 as any, observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('lookup returning rate=0 for source ⇒ no-rate (avoid division by zero)', () => {
    const zeroLookup: FxRateLookup = (c) => (c === 'EUR' ? { rate: 0, rateDate: APR_30 } : null);
    const result = convertPrice(
      { amount: 1, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: zeroLookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });

  it('cross-currency: missing source rate ⇒ no-rate', () => {
    const onlyJpy = makeFixtureLookup([{ currency: 'JPY', date: '2026-04-30', rate: 156.56 }]);
    const result = convertPrice(
      { amount: 1, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: onlyJpy },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });

  it('cross-currency: missing target rate ⇒ no-rate', () => {
    const onlyEur = makeFixtureLookup([{ currency: 'EUR', date: '2026-04-30', rate: 0.85455 }]);
    const result = convertPrice(
      { amount: 1, currency: 'EUR', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: onlyEur },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });
});

// ---------------------------------------------------------------
// 6. Display string + locale propagation
// ---------------------------------------------------------------

describe('convertPrice — display formatting', () => {
  it('display defaults to en-US when locale omitted', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toBe('€0.85');
  });

  it('display respects de-DE for EUR', () => {
    const result = convertPrice(
      { amount: 100, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup, locale: 'de-DE' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toContain('€');
    expect(result.value.display).toContain('85,46');
  });

  it('display rounds JPY to integer', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup, locale: 'en-US' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toBe('¥157');
  });

  it('display uses ja-JP for JPY (full-width yen)', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup, locale: 'ja-JP' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toBe('￥157');
  });

  it('display uses en-GB for GBP', () => {
    const result = convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'GBP', rateLookup: lookup, locale: 'en-GB' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toBe('£0.74');
  });
});

// ---------------------------------------------------------------
// 7. convertPriceRange
// ---------------------------------------------------------------

describe('convertPriceRange', () => {
  it('converts both ends with the same FX rate', () => {
    const result = convertPriceRange(
      { low: 50, high: 200, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.low.amount).toBeCloseTo(50 * 0.85455, 6);
    expect(result.value.high.amount).toBeCloseTo(200 * 0.85455, 6);
    expect(result.value.low.rate).toBe(result.value.high.rate);
    expect(result.value.low.rateDate).toEqual(result.value.high.rateDate);
    expect(result.value.low.usedFallback).toBe(result.value.high.usedFallback);
  });

  it('preserves low <= high after conversion', () => {
    const result = convertPriceRange(
      { low: 1, high: 1000, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.low.amount).toBeLessThanOrEqual(result.value.high.amount);
  });

  it('range identity (USD → USD) returns identity for both ends', () => {
    const result = convertPriceRange(
      { low: 5, high: 50, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.low.isIdentity).toBe(true);
    expect(result.value.high.isIdentity).toBe(true);
  });

  it('range fails as a unit when no rate available', () => {
    const result = convertPriceRange(
      { low: 1, high: 2, currency: 'EUR', observedAt: utcDate('2030-01-01') },
      { targetCurrency: 'USD', rateLookup: lookup, fallbackWindowDays: 0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
    expect(result.message).toMatch(/^low:/);
  });

  it('range surfaces invalid-input on bad amount', () => {
    const result = convertPriceRange(
      { low: Number.NaN, high: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('range surfaces unsupported-currency on bad targetCurrency', () => {
    const result = convertPriceRange(
      { low: 1, high: 2, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'XYZ', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-currency');
  });
});

// ---------------------------------------------------------------
// 8. bestEffortConvert (throws-on-failure variant)
// ---------------------------------------------------------------

describe('bestEffortConvert', () => {
  it('returns the value on success', () => {
    const value = bestEffortConvert(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(value.amount).toBeCloseTo(0.85455, 6);
    expect(value.display).toBe('€0.85');
  });

  it('throws Error (not RangeError) on no-rate', () => {
    expect(() =>
      bestEffortConvert(
        { amount: 1, currency: 'USD', observedAt: utcDate('2030-01-01') },
        { targetCurrency: 'EUR', rateLookup: lookup, fallbackWindowDays: 0 },
      ),
    ).toThrow(/no FX rate available/);
  });

  it('throws RangeError on invalid-input', () => {
    expect(() =>
      bestEffortConvert(
        { amount: Number.NaN, currency: 'USD', observedAt: APR_30 },
        { targetCurrency: 'EUR', rateLookup: lookup },
      ),
    ).toThrow(RangeError);
  });

  it('throws RangeError on unsupported-currency', () => {
    expect(() =>
      bestEffortConvert(
        { amount: 1, currency: 'USD', observedAt: APR_30 },
        { targetCurrency: 'BTC', rateLookup: lookup },
      ),
    ).toThrow(RangeError);
  });

  it('identity round-trip via bestEffortConvert', () => {
    const value = bestEffortConvert(
      { amount: 9.99, currency: 'JPY', observedAt: APR_30 },
      { targetCurrency: 'JPY', rateLookup: lookup },
    );
    expect(value.isIdentity).toBe(true);
    expect(value.rate).toBe(1);
  });
});

// ---------------------------------------------------------------
// 9. Determinism — same inputs always produce same outputs
// ---------------------------------------------------------------

describe('convertPrice — determinism', () => {
  it('1000 calls with the same inputs produce 1000 deepEqual outputs', () => {
    const input = { amount: 12.5, currency: 'EUR' as const, observedAt: APR_30 };
    const opts = { targetCurrency: 'JPY' as const, rateLookup: lookup, locale: 'ja-JP' };
    const first = convertPrice(input, opts);
    expect(first.ok).toBe(true);
    for (let i = 0; i < 1000; i++) {
      const next = convertPrice(input, opts);
      expect(next).toEqual(first);
    }
  });

  it('determinism across all SUPPORTED_CURRENCIES cross-pairs', () => {
    // For every (source, target) pair, calling twice yields
    // structurally equal results. Exhaustive 7×7 = 49 pair
    // grid in one go.
    for (const source of SUPPORTED_CURRENCIES) {
      for (const target of SUPPORTED_CURRENCIES) {
        const a = convertPrice(
          { amount: 1, currency: source, observedAt: APR_30 },
          { targetCurrency: target, rateLookup: lookup },
        );
        const b = convertPrice(
          { amount: 1, currency: source, observedAt: APR_30 },
          { targetCurrency: target, rateLookup: lookup },
        );
        expect(a).toEqual(b);
      }
    }
  });

  it('does not depend on the system clock — explicit observedAt is the source of truth', () => {
    // Manually mutate Date.now and verify nothing about
    // convertPrice's output changes.
    const realNow = Date.now;
    try {
      (Date as any).now = () => 0;
      const result = convertPrice(
        { amount: 1, currency: 'USD', observedAt: APR_30 },
        { targetCurrency: 'EUR', rateLookup: lookup },
      );
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.rateDate).toEqual(APR_30);
    } finally {
      (Date as any).now = realNow;
    }
  });

  it('lookup is called O(1) per leg (no excessive walking on a hit)', () => {
    let calls = 0;
    const counter: FxRateLookup = (currency, date) => {
      calls++;
      return lookup(currency, date);
    };
    convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: counter },
    );
    expect(calls).toBe(1);
  });

  it('lookup is called at most fallbackWindowDays+1 times per leg on a miss', () => {
    let calls = 0;
    const counter: FxRateLookup = () => {
      calls++;
      return null;
    };
    convertPrice(
      { amount: 1, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: 'EUR', rateLookup: counter, fallbackWindowDays: 7 },
    );
    expect(calls).toBe(8);
  });
});

// ---------------------------------------------------------------
// 10. Type-narrowing safety on the SupportedCurrency type
// ---------------------------------------------------------------

describe('convertPrice — output type narrowing', () => {
  it('returned currency is the targetCurrency cast to SupportedCurrency', () => {
    const target: SupportedCurrency = 'CAD';
    const result = convertPrice(
      { amount: 100, currency: 'USD', observedAt: APR_30 },
      { targetCurrency: target, rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.currency).toBe(target);
  });
});
