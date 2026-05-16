import { describe, expect, it } from 'vitest';

import { convertCurrentPriceRow } from './row-helpers.js';
import { CANONICAL_WEEK, makeFixtureLookup, utcDate } from './test-fixtures.js';

import type { CurrentPriceRow } from './types.js';

const lookup = makeFixtureLookup(CANONICAL_WEEK);

const baseRow: CurrentPriceRow = {
  printingId: '11111111-1111-4111-8111-111111111111',
  gradeTier: 'PSA_10',
  market: 'EBAY_US',
  currency: 'USD',
  periodStart: '2026-04-30',
  medianPrice: '1240.00',
};

describe('convertCurrentPriceRow — happy path', () => {
  it('USD row with USD target ⇒ identity, keys round-tripped', () => {
    const result = convertCurrentPriceRow(baseRow, {
      targetCurrency: 'USD',
      rateLookup: lookup,
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBe(1240);
    expect(result.value.currency).toBe('USD');
    expect(result.value.isIdentity).toBe(true);
    expect(result.value.printingId).toBe(baseRow.printingId);
    expect(result.value.gradeTier).toBe(baseRow.gradeTier);
    expect(result.value.market).toBe(baseRow.market);
    expect(result.value.display).toBe('$1,240.00');
  });

  it('USD row with JPY target uses APR_30 rate and rounds to integer yen', () => {
    const result = convertCurrentPriceRow(baseRow, {
      targetCurrency: 'JPY',
      rateLookup: lookup,
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(1240 * 156.56, 4);
    expect(result.value.display).toBe('¥194,134');
    expect(result.value.rateDate).toEqual(utcDate('2026-04-30'));
  });

  it('accepts numeric medianPrice (not just string form)', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, medianPrice: 1240 },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo(1240 * 0.85455, 4);
  });

  it('honors the locale option for display formatting', () => {
    const result = convertCurrentPriceRow(baseRow, {
      targetCurrency: 'EUR',
      rateLookup: lookup,
      locale: 'de-DE',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.display).toContain('€');
    // 1240 * 0.85455 = 1059.642 ⇒ rounded to 1.059,64 in de-DE.
    expect(result.value.display).toContain('1.059,64');
  });

  it('cross-currency row: EUR → JPY composes via USD', () => {
    const result = convertCurrentPriceRow(
      {
        ...baseRow,
        currency: 'EUR',
        medianPrice: '100.00',
      },
      { targetCurrency: 'JPY', rateLookup: lookup },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.amount).toBeCloseTo((100 / 0.85455) * 156.56, 4);
  });
});

describe('convertCurrentPriceRow — failures', () => {
  it('null medianPrice ⇒ no-rate', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, medianPrice: null },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
    expect(result.message).toMatch(/medianPrice === null/);
  });

  it('non-numeric string medianPrice ⇒ invalid-input', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, medianPrice: 'not-a-number' },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('malformed periodStart ⇒ invalid-input', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, periodStart: '2026/04/30' },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(result.message).toMatch(/periodStart/);
  });

  it('over/under-flow periodStart (month=13) ⇒ invalid-input', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, periodStart: '2026-13-01' },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('over/under-flow periodStart (Feb 30) ⇒ invalid-input', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, periodStart: '2026-02-30' },
      { targetCurrency: 'EUR', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('unsupported source currency in row ⇒ invalid-input', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, currency: 'BTC' },
      { targetCurrency: 'USD', rateLookup: lookup },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
  });

  it('unsupported target currency ⇒ unsupported-currency', () => {
    const result = convertCurrentPriceRow(baseRow, {
      targetCurrency: 'XYZ',
      rateLookup: lookup,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-currency');
  });

  it('no rate available within fallback window ⇒ no-rate', () => {
    const result = convertCurrentPriceRow(
      { ...baseRow, currency: 'EUR', periodStart: '2030-01-01' },
      { targetCurrency: 'USD', rateLookup: lookup, fallbackWindowDays: 0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-rate');
  });
});

describe('convertCurrentPriceRow — round-tripping keys + determinism', () => {
  it('keys round-trip across multiple rows', () => {
    const rows: CurrentPriceRow[] = [
      { ...baseRow, printingId: 'a', gradeTier: 'PSA_10', market: 'EBAY_US' },
      { ...baseRow, printingId: 'b', gradeTier: 'PSA_9', market: 'EBAY_US' },
      { ...baseRow, printingId: 'c', gradeTier: 'RAW_NM', market: 'CARDMARKET_EU' },
    ];
    const opts = { targetCurrency: 'USD' as const, rateLookup: lookup };
    const out = rows.map((r) => convertCurrentPriceRow(r, opts));
    out.forEach((r, i) => {
      const expected = rows[i];
      if (!expected) throw new Error('fixture row missing');
      if (!r.ok) throw new Error('expected ok');
      expect(r.value.printingId).toBe(expected.printingId);
      expect(r.value.gradeTier).toBe(expected.gradeTier);
      expect(r.value.market).toBe(expected.market);
    });
  });

  it('determinism: 100 calls yield deepEqual outputs', () => {
    const opts = {
      targetCurrency: 'JPY' as const,
      rateLookup: lookup,
      locale: 'ja-JP',
    };
    const first = convertCurrentPriceRow(baseRow, opts);
    for (let i = 0; i < 100; i++) {
      const next = convertCurrentPriceRow(baseRow, opts);
      expect(next).toEqual(first);
    }
  });
});
