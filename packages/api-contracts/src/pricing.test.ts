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
  priceTrendDirectionSchema,
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

  it('parses a current-price row with the v2 trend enrichment', () => {
    const parsed = currentPriceDto.parse({
      ...VALID,
      currentPrice: '1235.00',
      trend30dPct: '-4.20',
      trend90dPct: '12.50',
      trendAllTimePct: '120.00',
      trendDirection: 'down',
      sampleCount30d: 88,
      lastObservationAt: NOW,
    });
    expect(parsed.trendDirection).toBe('down');
    expect(parsed.trend30dPct).toBe('-4.20');
    expect(parsed.sampleCount30d).toBe(88);
  });

  it('parses a v1 row without the v2 trend fields (backward compatible)', () => {
    const parsed = currentPriceDto.parse(VALID);
    expect(parsed.currentPrice).toBeUndefined();
    expect(parsed.trendDirection).toBeUndefined();
  });

  it('accepts null trend fields (too little history to compute)', () => {
    const parsed = currentPriceDto.parse({
      ...VALID,
      currentPrice: null,
      trend30dPct: null,
      lastObservationAt: null,
    });
    expect(parsed.currentPrice).toBeNull();
    expect(parsed.trend30dPct).toBeNull();
  });

  it('rejects an unknown trend direction', () => {
    expect(currentPriceDto.safeParse({ ...VALID, trendDirection: 'sideways' }).success).toBe(false);
  });

  it('rejects a row with missing computedAt', () => {
    const { computedAt, ...without } = VALID;
    void computedAt;
    expect(currentPriceDto.safeParse(without).success).toBe(false);
  });
});

describe('priceTrendDirectionSchema', () => {
  it('accepts every documented direction', () => {
    expect(priceTrendDirectionSchema.parse('up')).toBe('up');
    expect(priceTrendDirectionSchema.parse('down')).toBe('down');
    expect(priceTrendDirectionSchema.parse('flat')).toBe('flat');
    expect(priceTrendDirectionSchema.parse('unknown')).toBe('unknown');
  });

  it('rejects an unknown direction', () => {
    expect(priceTrendDirectionSchema.safeParse('sideways').success).toBe(false);
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

  it('parses a row carrying the v2 trend enrichment', () => {
    const parsed = printingCurrentPriceDto.parse({
      ...VALID,
      currentPrice: '118.00',
      trend30dPct: '8.40',
      trend90dPct: '-2.00',
      trendAllTimePct: '60.00',
      trendDirection: 'up',
      sampleCount30d: 30,
      lastObservationAt: NOW,
    });
    expect(parsed.trendDirection).toBe('up');
    expect(parsed.lastObservationAt).toBe(NOW);
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
      printingCurrentPriceDto.safeParse({ ...VALID, definitelyNotAField: 0.04 }).success,
    ).toBe(false);
  });
});
