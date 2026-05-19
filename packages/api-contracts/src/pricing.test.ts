// Tests for `pricing.ts`. Each schema gets a positive +
// negative case.

import { describe, expect, it } from 'vitest';

import {
  currentPriceDto,
  fxRateDto,
  marketDto,
  marketTierSchema,
  priceAggregateDto,
  priceHistoryQuery,
  priceObservationKindSchema,
  printingCurrentPriceDto,
  printingCurrentPriceFreshnessSchema,
} from './pricing.js';

const NOW = '2026-05-05T12:00:00Z';
const PRINTING_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

describe('marketTierSchema', () => {
  it('accepts primary and secondary', () => {
    expect(marketTierSchema.parse('primary')).toBe('primary');
    expect(marketTierSchema.parse('secondary')).toBe('secondary');
  });

  it('rejects unknown tiers', () => {
    expect(marketTierSchema.safeParse('tertiary').success).toBe(false);
  });
});

describe('priceObservationKindSchema', () => {
  it('accepts canonical kinds', () => {
    expect(priceObservationKindSchema.parse('sold')).toBe('sold');
    expect(priceObservationKindSchema.parse('aggregator_quote')).toBe('aggregator_quote');
  });

  it('rejects unknown kinds', () => {
    expect(priceObservationKindSchema.safeParse('asking').success).toBe(false);
  });
});

describe('marketDto', () => {
  const VALID = {
    code: 'EBAY_US' as const,
    displayName: 'eBay US',
    tier: 'primary' as const,
    defaultCurrency: 'USD',
    region: 'US',
    notes: null,
  };

  it('parses an EBAY_US market row', () => {
    expect(marketDto.parse(VALID).tier).toBe('primary');
  });

  it('rejects a market with an unknown code', () => {
    expect(marketDto.safeParse({ ...VALID, code: 'EBAY_FR' }).success).toBe(false);
  });
});

describe('priceAggregateDto', () => {
  const VALID = {
    printingId: PRINTING_ID,
    gradeTier: 'PSA_10' as const,
    market: 'EBAY_US' as const,
    currency: 'USD',
    periodStart: '2026-05-04',
    periodEnd: '2026-05-04',
    medianPrice: '1240.00',
    meanPrice: '1300.00',
    lowPrice: '1100.00',
    highPrice: '1500.00',
    sampleCount: 12,
    sourceBreakdown: { ebay_browse: 12 },
    observationKindBreakdown: { sold: 8, active_listing: 4 },
    computedAt: NOW,
  };

  it('parses a populated aggregate row', () => {
    expect(priceAggregateDto.parse(VALID).sampleCount).toBe(12);
  });

  it('parses a no-data aggregate (all prices null, sampleCount 0)', () => {
    expect(
      priceAggregateDto.parse({
        ...VALID,
        medianPrice: null,
        meanPrice: null,
        lowPrice: null,
        highPrice: null,
        sampleCount: 0,
        sourceBreakdown: {},
        observationKindBreakdown: {},
      }).sampleCount,
    ).toBe(0);
  });

  it('rejects a sampleCount < 0', () => {
    expect(priceAggregateDto.safeParse({ ...VALID, sampleCount: -1 }).success).toBe(false);
  });

  it('rejects a numeric value with too many decimals', () => {
    expect(priceAggregateDto.safeParse({ ...VALID, medianPrice: '1240.000' }).success).toBe(false);
  });
});

describe('currentPriceDto', () => {
  const VALID = {
    printingId: PRINTING_ID,
    gradeTier: 'PSA_10' as const,
    market: 'EBAY_US' as const,
    currency: 'USD',
    periodStart: '2026-05-04',
    medianPrice: '1240.00',
    meanPrice: '1300.00',
    lowPrice: '1100.00',
    highPrice: '1500.00',
    sampleCount: 12,
    computedAt: NOW,
  };

  it('parses a current-price row', () => {
    expect(currentPriceDto.parse(VALID).gradeTier).toBe('PSA_10');
  });

  it('rejects a row with missing computedAt', () => {
    const { computedAt, ...without } = VALID;
    void computedAt;
    expect(currentPriceDto.safeParse(without).success).toBe(false);
  });
});

describe('fxRateDto', () => {
  const VALID = {
    rateDate: '2026-05-05',
    baseCurrency: 'USD',
    quoteCurrency: 'EUR',
    rate: '0.913456',
    fetchedAt: NOW,
    source: 'frankfurter',
  };

  it('parses a daily fx rate row', () => {
    expect(fxRateDto.parse(VALID).rate).toBe('0.913456');
  });

  it('rejects a rate with too many fractional digits', () => {
    expect(fxRateDto.safeParse({ ...VALID, rate: '0.9134567' }).success).toBe(false);
  });

  it('rejects a non-3-letter currency code', () => {
    expect(fxRateDto.safeParse({ ...VALID, quoteCurrency: 'EURO' }).success).toBe(false);
  });
});

describe('priceHistoryQuery', () => {
  it('parses a minimal query (gradeTier only)', () => {
    expect(priceHistoryQuery.parse({ gradeTier: 'RAW_NM' }).gradeTier).toBe('RAW_NM');
  });

  it('parses a fully-populated query', () => {
    expect(
      priceHistoryQuery.parse({
        gradeTier: 'PSA_10',
        market: 'CARDMARKET_EU',
        period: '90d',
      }).period,
    ).toBe('90d');
  });

  it('rejects an unknown period', () => {
    expect(
      priceHistoryQuery.safeParse({
        gradeTier: 'PSA_10',
        period: '180d',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown extra key (strict)', () => {
    expect(
      priceHistoryQuery.safeParse({
        gradeTier: 'PSA_10',
        unexpected: 'extra',
      }).success,
    ).toBe(false);
  });
});

// ============================================================
// printingCurrentPriceDto (new — `/v1/printings/:id/current-price`)
// ============================================================

describe('printingCurrentPriceFreshnessSchema', () => {
  it('accepts every documented bucket', () => {
    expect(printingCurrentPriceFreshnessSchema.parse('fresh')).toBe('fresh');
    expect(printingCurrentPriceFreshnessSchema.parse('stale')).toBe('stale');
    expect(printingCurrentPriceFreshnessSchema.parse('stale_old')).toBe('stale_old');
  });

  it('rejects an unknown band', () => {
    expect(printingCurrentPriceFreshnessSchema.safeParse('ancient').success).toBe(false);
  });
});

describe('printingCurrentPriceDto', () => {
  const VALID = {
    printingId: PRINTING_ID,
    gradeTier: 'RAW_NM' as const,
    market: 'EBAY_US' as const,
    currency: 'USD',
    periodStart: '2026-05-05',
    medianPrice: '120.00',
    meanPrice: '125.00',
    lowPrice: '90.00',
    highPrice: '160.00',
    sampleCount: 25,
    computedAt: NOW,
    freshness: 'fresh' as const,
  };

  it('parses a populated row', () => {
    expect(printingCurrentPriceDto.parse(VALID).freshness).toBe('fresh');
  });

  it('parses a row with null price fields (no recent observations)', () => {
    expect(
      printingCurrentPriceDto.parse({
        ...VALID,
        medianPrice: null,
        meanPrice: null,
        lowPrice: null,
        highPrice: null,
        sampleCount: 0,
        freshness: 'stale_old',
      }).medianPrice,
    ).toBeNull();
  });

  it('rejects a missing freshness', () => {
    const { freshness: _freshness, ...without } = VALID;
    expect(printingCurrentPriceDto.safeParse(without).success).toBe(false);
  });

  it('rejects an unknown freshness band', () => {
    expect(
      printingCurrentPriceDto.safeParse({ ...VALID, freshness: 'recent' }).success,
    ).toBe(false);
  });

  it('rejects unknown extra keys (strict)', () => {
    expect(
      printingCurrentPriceDto.safeParse({ ...VALID, trend30d: 0.04 }).success,
    ).toBe(false);
  });
});
