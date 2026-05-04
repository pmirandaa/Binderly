import { describe, expect, it } from 'vitest';

import { priceToPennies, synthesizeSourceListingId } from './canonical-id.js';

import type { AggregatorQuote } from './types.js';

const CARDMARKET: AggregatorQuote = {
  kind: 'cardmarket_quote',
  vendor: 'mock',
  printingVariantKey: 'en-base1-004-holo',
  market: 'CARDMARKET_EU',
  currency: 'EUR',
  gradeTier: 'RAW_NM',
  price: '180.00',
  observedAt: '2026-04-30T06:00:00Z',
  observedDate: '2026-04-30',
  rawPayload: {},
};

const EBAY_WITH_ID: AggregatorQuote = {
  kind: 'ebay_sold_listing',
  vendor: 'mock',
  listingId: '154321987001',
  listingTitle: 'PSA 10 Charizard 4/102 Base Set Shadowless Holo',
  market: 'EBAY_US',
  currency: 'USD',
  gradeTier: 'PSA_10',
  price: '14250.00',
  observedAt: '2026-04-30T19:32:11Z',
  observedDate: '2026-04-30',
  rawPayload: {},
};

const EBAY_WITHOUT_ID: AggregatorQuote = {
  kind: 'ebay_sold_listing',
  vendor: 'mock',
  listingTitle: 'Pikachu 58/102 Base Set NM',
  market: 'EBAY_US',
  currency: 'USD',
  gradeTier: 'RAW_NM',
  price: '11.50',
  observedAt: '2026-04-30T11:22:44Z',
  observedDate: '2026-04-30',
  rawPayload: {},
};

describe('synthesizeSourceListingId — cardmarket quotes', () => {
  it('uses the documented `:cm:` form', () => {
    const id = synthesizeSourceListingId(CARDMARKET, { printingId: 'p-1' });
    expect(id).toBe('mock:cm:p-1:RAW_NM:CARDMARKET_EU:EUR:2026-04-30');
  });

  it('lower-cases the vendor tag', () => {
    const id = synthesizeSourceListingId(
      { ...CARDMARKET, vendor: 'PokeTrace' },
      { printingId: 'p-2' },
    );
    expect(id).toBe('poketrace:cm:p-2:RAW_NM:CARDMARKET_EU:EUR:2026-04-30');
  });

  it('produces a stable id for the same inputs (idempotency)', () => {
    const a = synthesizeSourceListingId(CARDMARKET, { printingId: 'p-3' });
    const b = synthesizeSourceListingId(CARDMARKET, { printingId: 'p-3' });
    expect(a).toBe(b);
  });

  it('discriminates by grade tier within the same printing', () => {
    const raw = synthesizeSourceListingId(CARDMARKET, { printingId: 'p-4' });
    const psa10 = synthesizeSourceListingId(
      { ...CARDMARKET, gradeTier: 'PSA_10' },
      { printingId: 'p-4' },
    );
    expect(raw).not.toBe(psa10);
  });

  it('discriminates by date so daily re-runs land separate rows', () => {
    const today = synthesizeSourceListingId(CARDMARKET, { printingId: 'p-5' });
    const tomorrow = synthesizeSourceListingId(
      { ...CARDMARKET, observedDate: '2026-05-01' },
      { printingId: 'p-5' },
    );
    expect(today).not.toBe(tomorrow);
  });

  it('discriminates by currency (rare cross-currency case)', () => {
    const eur = synthesizeSourceListingId(CARDMARKET, { printingId: 'p-6' });
    const gbp = synthesizeSourceListingId(
      { ...CARDMARKET, currency: 'GBP' },
      { printingId: 'p-6' },
    );
    expect(eur).not.toBe(gbp);
  });
});

describe('synthesizeSourceListingId — eBay sold listings with vendor id', () => {
  it('uses `:ebay:<listingId>` directly', () => {
    const id = synthesizeSourceListingId(EBAY_WITH_ID, { printingId: 'p-1' });
    expect(id).toBe('mock:ebay:154321987001');
  });

  it('does not factor printingId into the id (the listing id is the natural key)', () => {
    const a = synthesizeSourceListingId(EBAY_WITH_ID, { printingId: 'p-1' });
    const b = synthesizeSourceListingId(EBAY_WITH_ID, { printingId: 'p-2' });
    expect(a).toBe(b);
  });
});

describe('synthesizeSourceListingId — eBay sold listings without vendor id', () => {
  it('uses the `:ebay-syn:` form with price-pennies suffix', () => {
    const id = synthesizeSourceListingId(EBAY_WITHOUT_ID, { printingId: 'p-9' });
    expect(id).toBe('mock:ebay-syn:p-9:RAW_NM:2026-04-30:1150');
  });

  it('discriminates by price (separate sales same day at different prices stay separate)', () => {
    const a = synthesizeSourceListingId(EBAY_WITHOUT_ID, { printingId: 'p-9' });
    const b = synthesizeSourceListingId(
      { ...EBAY_WITHOUT_ID, price: '12.00' },
      { printingId: 'p-9' },
    );
    expect(a).not.toBe(b);
  });

  it('treats `listingId: null` as missing', () => {
    const id = synthesizeSourceListingId(
      { ...EBAY_WITHOUT_ID, listingId: null },
      { printingId: 'p-9' },
    );
    expect(id.startsWith('mock:ebay-syn:')).toBe(true);
  });

  it('treats whitespace-only listingId as missing', () => {
    const id = synthesizeSourceListingId(
      { ...EBAY_WITHOUT_ID, listingId: '   ' },
      { printingId: 'p-9' },
    );
    expect(id.startsWith('mock:ebay-syn:')).toBe(true);
  });
});

describe('synthesizeSourceListingId — guards', () => {
  it('rejects an empty vendor', () => {
    expect(() =>
      synthesizeSourceListingId({ ...CARDMARKET, vendor: '   ' }, { printingId: 'p-1' }),
    ).toThrow(/vendor/);
  });

  it('rejects an empty printingId', () => {
    expect(() => synthesizeSourceListingId(CARDMARKET, { printingId: '' })).toThrow(/printingId/);
  });
});

describe('priceToPennies', () => {
  it('round-trips integer dollars', () => {
    expect(priceToPennies('180.00')).toBe(18_000);
    expect(priceToPennies('180')).toBe(18_000);
  });

  it('rounds to two decimal places without float drift', () => {
    expect(priceToPennies('11.50')).toBe(1_150);
    expect(priceToPennies('11.5')).toBe(1_150);
    expect(priceToPennies('0.85')).toBe(85);
    expect(priceToPennies('0.05')).toBe(5);
  });

  it('truncates beyond two decimals (numeric(12,2) contract)', () => {
    expect(priceToPennies('11.567')).toBe(1_156);
  });

  it('rejects non-numeric strings', () => {
    expect(() => priceToPennies('11,50')).toThrow();
    expect(() => priceToPennies('abc')).toThrow();
    expect(() => priceToPennies('')).toThrow();
  });
});
