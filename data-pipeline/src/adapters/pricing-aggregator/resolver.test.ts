import { describe, expect, it } from 'vitest';

import { resolveQuote, type PricingAggregatorCatalogReader } from './resolver.js';

import type { AggregatorQuote } from './types.js';
import type { ParserCatalogCard, ParserCatalogPrinting } from '../../parsers/ebay-listing/index.js';

interface Fixture {
  readonly cards: ReadonlyArray<ParserCatalogCard>;
  readonly printings: ReadonlyArray<ParserCatalogPrinting>;
}

function makeReader(fixture: Fixture): PricingAggregatorCatalogReader {
  return {
    async findCardByCanonicalKey(canonicalKey) {
      return fixture.cards.find((c) => c.canonicalKey === canonicalKey) ?? null;
    },
    async findCardsByNameAndSetCode({ nameLike, setCanonicalKey, limit = 5 }) {
      const lower = nameLike.toLowerCase();
      const matches = fixture.cards.filter((c) => {
        const nameOk = c.name.toLowerCase().includes(lower);
        const setOk = setCanonicalKey == null || c.setCanonicalKey === setCanonicalKey;
        return nameOk && setOk;
      });
      return matches.slice(0, limit);
    },
    async findPrintingsByCardId(cardId) {
      return fixture.printings.filter((p) => p.cardId === cardId);
    },
    async findPrintingByVariantKey(variantKey) {
      const p = fixture.printings.find((x) => x.variantKey === variantKey);
      if (!p) return null;
      return { id: p.id, cardId: p.cardId, variantKey: p.variantKey };
    },
  };
}

const FIXTURE: Fixture = {
  cards: [
    {
      id: 'card-base1-charizard',
      canonicalKey: 'en-base1-004',
      setCanonicalKey: 'en-base1',
      name: 'Charizard',
    },
    {
      id: 'card-base1-pikachu',
      canonicalKey: 'en-base1-058',
      setCanonicalKey: 'en-base1',
      name: 'Pikachu',
    },
  ],
  printings: [
    {
      id: 'p-base1-charizard-holo-sl',
      variantKey: 'en-base1-004-holo-sl',
      cardId: 'card-base1-charizard',
      variantClass: 'HOLO',
      variantFlags: ['SHADOWLESS'],
    },
    {
      id: 'p-base1-charizard-holo',
      variantKey: 'en-base1-004-holo',
      cardId: 'card-base1-charizard',
      variantClass: 'HOLO',
      variantFlags: [],
    },
    {
      id: 'p-base1-pikachu-rh',
      variantKey: 'en-base1-058-rh',
      cardId: 'card-base1-pikachu',
      variantClass: 'REVERSE_HOLO',
      variantFlags: [],
    },
    {
      id: 'p-base1-pikachu-nonholo',
      variantKey: 'en-base1-058-nonholo',
      cardId: 'card-base1-pikachu',
      variantClass: 'NON_HOLO',
      variantFlags: [],
    },
  ],
};

describe('resolveQuote — Cardmarket pre-attributed quotes', () => {
  const reader = makeReader(FIXTURE);

  it('resolves to the printing.id via variantKey', async () => {
    const quote: AggregatorQuote = {
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
    const out = await resolveQuote(quote, reader);
    expect(out).toEqual({
      status: 'resolved',
      printingId: 'p-base1-charizard-holo',
      parseConfidence: null,
    });
  });

  it('records missing_printing when the variantKey has no row', async () => {
    const quote: AggregatorQuote = {
      kind: 'cardmarket_quote',
      vendor: 'mock',
      printingVariantKey: 'en-no-such-set-001-holo',
      market: 'CARDMARKET_EU',
      currency: 'EUR',
      gradeTier: 'RAW_NM',
      price: '1.00',
      observedAt: '2026-04-30T06:00:00Z',
      observedDate: '2026-04-30',
      rawPayload: {},
    };
    const out = await resolveQuote(quote, reader);
    expect(out).toEqual({
      status: 'missing_printing',
      variantKey: 'en-no-such-set-001-holo',
    });
  });
});

describe('resolveQuote — eBay sold listing quotes', () => {
  const reader = makeReader(FIXTURE);

  it('parses + joins a slabbed Charizard listing to the shadowless printing', async () => {
    const quote: AggregatorQuote = {
      kind: 'ebay_sold_listing',
      vendor: 'mock',
      listingId: '1',
      listingTitle: 'PSA 10 Charizard 4/102 Base Set Shadowless Holo',
      market: 'EBAY_US',
      currency: 'USD',
      gradeTier: 'PSA_10',
      price: '14250.00',
      observedAt: '2026-04-30T19:32:11Z',
      observedDate: '2026-04-30',
      rawPayload: {},
    };
    const out = await resolveQuote(quote, reader);
    expect(out.status).toBe('resolved');
    if (out.status === 'resolved') {
      expect(out.printingId).toBe('p-base1-charizard-holo-sl');
      expect(out.parseConfidence).toBeGreaterThan(0);
      expect(out.parsed).toBeDefined();
    }
  });

  it('drops listings parsed as lots', async () => {
    const quote: AggregatorQuote = {
      kind: 'ebay_sold_listing',
      vendor: 'mock',
      listingId: '2',
      listingTitle: 'Pokemon Lot of 50 Cards Bulk',
      market: 'EBAY_US',
      currency: 'USD',
      gradeTier: 'RAW_UNKNOWN',
      price: '320.00',
      observedAt: '2026-04-30T17:45:09Z',
      observedDate: '2026-04-30',
      rawPayload: {},
    };
    const out = await resolveQuote(quote, reader);
    expect(out.status).toBe('lot_dropped');
  });

  it('records unresolved_listing when the title cannot be attributed', async () => {
    const quote: AggregatorQuote = {
      kind: 'ebay_sold_listing',
      vendor: 'mock',
      listingId: '3',
      listingTitle: 'Eldritch Horror 999/999 Unknown Set Holo',
      market: 'EBAY_US',
      currency: 'USD',
      gradeTier: 'RAW_UNKNOWN',
      price: '10.00',
      observedAt: '2026-04-30T22:00:00Z',
      observedDate: '2026-04-30',
      rawPayload: {},
    };
    const out = await resolveQuote(quote, reader);
    expect(out.status).toBe('unresolved_listing');
  });

  it('routes Pikachu Reverse Holo to the RH printing', async () => {
    const quote: AggregatorQuote = {
      kind: 'ebay_sold_listing',
      vendor: 'mock',
      listingId: '4',
      listingTitle: 'Pikachu Reverse Holo 58/102 Base Set NM',
      market: 'EBAY_US',
      currency: 'USD',
      gradeTier: 'RAW_NM',
      price: '11.50',
      observedAt: '2026-04-30T11:22:44Z',
      observedDate: '2026-04-30',
      rawPayload: {},
    };
    const out = await resolveQuote(quote, reader);
    expect(out.status).toBe('resolved');
    if (out.status === 'resolved') {
      expect(out.printingId).toBe('p-base1-pikachu-rh');
    }
  });
});
