// Unit tests for `runPricingAggregatorIngest`.
//
// We exercise the runner end-to-end with the
// `MockPricingAggregatorClient` (against synthetic seed quotes
// for control) + `InMemoryPriceObservationRepo` + an in-memory
// `PricingAggregatorCatalogReader`. No HTTP, no Postgres.

import { describe, expect, it } from 'vitest';

import {
  createLivePricingAggregatorClient,
  isMockAggregatorEnabled,
  LiveClientNotConfiguredError,
} from './client.js';
import { formatConfidence, runPricingAggregatorIngest } from './job.js';
import { MockPricingAggregatorClient } from './mock.js';
import { InMemoryPriceObservationRepo } from './repo.js';

import type { PricingAggregatorCatalogReader, PricingCatalogPrinting } from './resolver.js';
import type { AggregatorQuote } from './types.js';
import type { ParserCatalogCard, ParserCatalogPrinting } from '../../parsers/ebay-listing/index.js';

interface Fixture {
  readonly cards: ReadonlyArray<ParserCatalogCard>;
  readonly printings: ReadonlyArray<ParserCatalogPrinting & PricingCatalogPrinting>;
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
      return p ? { id: p.id, cardId: p.cardId, variantKey: p.variantKey } : null;
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
    {
      id: 'card-swsh7-sylveon',
      canonicalKey: 'en-swsh7-091',
      setCanonicalKey: 'en-swsh7',
      name: 'Sylveon V',
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
    {
      id: 'p-swsh7-sylveon-altart',
      variantKey: 'en-swsh7-091-altart',
      cardId: 'card-swsh7-sylveon',
      variantClass: 'ALT_ART',
      variantFlags: [],
    },
    {
      id: 'p-swsh7-sylveon-holo',
      variantKey: 'en-swsh7-091-holo',
      cardId: 'card-swsh7-sylveon',
      variantClass: 'HOLO',
      variantFlags: [],
    },
  ],
};

// ============================================================
// End-to-end runner — happy path against shipped fixtures
// ============================================================

describe('runPricingAggregatorIngest — shipped mock fixtures', () => {
  it('resolves Cardmarket + eBay-sold quotes; records the documented errors', async () => {
    const client = new MockPricingAggregatorClient();
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({ client, catalog, repo });

    // The fixtures: 6 cardmarket + 8 ebay = 14 quotes. Of the 8
    // ebay quotes, fixture 5 is a lot, fixture 6 is unresolved.
    // All 6 cardmarket quotes resolve (variantKeys all present).
    expect(report.quotesFetched).toBe(14);
    expect(report.observationsResolved).toBe(12);
    expect(report.observationsWritten).toBe(12);

    const errorKinds = report.errors.map((e) => e.kind).sort();
    expect(errorKinds).toEqual(['lot_dropped', 'unresolved_listing']);

    // Source threading
    expect(report.source).toBe('aggregator_mock');

    // Spot-check one Cardmarket row
    const cmRow = repo
      .list()
      .find(
        (r) =>
          r.market === 'CARDMARKET_EU' &&
          r.gradeTier === 'PSA_10' &&
          r.observedDate === '2026-04-30',
      );
    expect(cmRow).toBeDefined();
    expect(cmRow?.observationKind).toBe('aggregator_quote');
    expect(cmRow?.observedCurrency).toBe('EUR');
    expect(cmRow?.parseConfidence).toBeNull();
    expect(cmRow?.sourceListingId.startsWith('mock:cm:')).toBe(true);

    // Spot-check one eBay-sold row (should land with parser confidence set)
    const ebayRow = repo.list().find((r) => r.sourceListingId === 'mock:ebay:154321987001');
    expect(ebayRow).toBeDefined();
    expect(ebayRow?.observationKind).toBe('sold');
    expect(ebayRow?.market).toBe('EBAY_US');
    expect(ebayRow?.observedCurrency).toBe('USD');
    expect(ebayRow?.gradeTier).toBe('PSA_10');
    expect(ebayRow?.shipping).toBe('25.00');
    if (ebayRow?.parseConfidence !== null) {
      expect(Number(ebayRow?.parseConfidence)).toBeGreaterThan(0);
    }
  });

  it('is idempotent on re-run (in-memory repo deduplicates by source+sourceListingId)', async () => {
    const client = new MockPricingAggregatorClient();
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    await runPricingAggregatorIngest({ client, catalog, repo });
    const sizeAfterFirst = repo.size();
    const second = await runPricingAggregatorIngest({ client, catalog, repo });
    expect(repo.size()).toBe(sizeAfterFirst);
    expect(second.observationsWritten).toBe(sizeAfterFirst);
  });
});

// ============================================================
// Filters
// ============================================================

describe('runPricingAggregatorIngest — filters', () => {
  it('honors the `since` filter (forwards to the client)', async () => {
    const client = new MockPricingAggregatorClient();
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({
      client,
      catalog,
      repo,
      since: '2026-04-30',
    });
    expect(report.rangeRequested.since).toBe('2026-04-30');
    // Only the 2026-04-30 fixtures should land.
    expect(repo.list().every((r) => r.observedDate === '2026-04-30')).toBe(true);
  });

  it('honors the `printings` allow-list (cardmarket narrows; ebay passes through)', async () => {
    const client = new MockPricingAggregatorClient();
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({
      client,
      catalog,
      repo,
      printings: ['en-base1-058-rh'],
    });
    expect(report.rangeRequested.printings).toBe(1);
    // The only cardmarket fixtures matching are pikachu RH (2 of them
    // across two days). All 8 ebay fixtures still pass through to the
    // resolver: 6 resolve, 1 lot dropped, 1 unresolved.
    const cm = repo.list().filter((r) => r.observationKind === 'aggregator_quote');
    expect(cm).toHaveLength(2);
    expect(cm.every((r) => r.market === 'CARDMARKET_EU')).toBe(true);
  });
});

// ============================================================
// Error reporting
// ============================================================

describe('runPricingAggregatorIngest — error reporting', () => {
  it('records missing_printing for an unknown variantKey', async () => {
    const seed: AggregatorQuote[] = [
      {
        kind: 'cardmarket_quote',
        vendor: 'mock',
        printingVariantKey: 'en-no-such-001-holo',
        market: 'CARDMARKET_EU',
        currency: 'EUR',
        gradeTier: 'RAW_NM',
        price: '1.00',
        observedAt: '2026-04-30T06:00:00Z',
        observedDate: '2026-04-30',
        rawPayload: {},
      },
    ];
    const client = new MockPricingAggregatorClient({ quotes: seed });
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({ client, catalog, repo });
    expect(report.observationsWritten).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.kind).toBe('missing_printing');
    expect(report.errors[0]?.variantKey).toBe('en-no-such-001-holo');
  });

  it('records unresolved_listing when the listing title fails to attribute', async () => {
    const seed: AggregatorQuote[] = [
      {
        kind: 'ebay_sold_listing',
        vendor: 'mock',
        listingId: 'x1',
        listingTitle: 'Eldritch Horror 999/999 Unknown Set Holo',
        market: 'EBAY_US',
        currency: 'USD',
        gradeTier: 'RAW_UNKNOWN',
        price: '10.00',
        observedAt: '2026-04-30T06:00:00Z',
        observedDate: '2026-04-30',
        rawPayload: {},
      },
    ];
    const client = new MockPricingAggregatorClient({ quotes: seed });
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({ client, catalog, repo });
    expect(report.observationsWritten).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.kind).toBe('unresolved_listing');
  });

  it('records lot_dropped for lot-style listings', async () => {
    const seed: AggregatorQuote[] = [
      {
        kind: 'ebay_sold_listing',
        vendor: 'mock',
        listingId: 'x2',
        listingTitle: 'Pokemon Lot of 50 Cards Bulk Vintage Holo Rares',
        market: 'EBAY_US',
        currency: 'USD',
        gradeTier: 'RAW_UNKNOWN',
        price: '320.00',
        observedAt: '2026-04-30T06:00:00Z',
        observedDate: '2026-04-30',
        rawPayload: {},
      },
    ];
    const client = new MockPricingAggregatorClient({ quotes: seed });
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({ client, catalog, repo });
    expect(report.observationsWritten).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.kind).toBe('lot_dropped');
  });
});

// ============================================================
// Vendor + source threading
// ============================================================

describe('runPricingAggregatorIngest — source threading', () => {
  it('threads the vendor tag into report.source and every row', async () => {
    const seed: AggregatorQuote[] = [
      {
        kind: 'cardmarket_quote',
        vendor: 'poketrace',
        printingVariantKey: 'en-base1-004-holo',
        market: 'CARDMARKET_EU',
        currency: 'EUR',
        gradeTier: 'RAW_NM',
        price: '180.00',
        observedAt: '2026-04-30T06:00:00Z',
        observedDate: '2026-04-30',
        rawPayload: {},
      },
    ];
    const client = new MockPricingAggregatorClient({ quotes: seed, vendor: 'poketrace' });
    const repo = new InMemoryPriceObservationRepo();
    const catalog = makeReader(FIXTURE);
    const report = await runPricingAggregatorIngest({ client, catalog, repo });
    expect(report.source).toBe('aggregator_poketrace');
    expect(repo.list()[0]?.source).toBe('aggregator_poketrace');
    expect(repo.list()[0]?.sourceListingId.startsWith('poketrace:cm:')).toBe(true);
  });
});

// ============================================================
// Live-client stub + env helper
// ============================================================

describe('createLivePricingAggregatorClient', () => {
  it('throws LiveClientNotConfiguredError on fetchQuotes', async () => {
    const live = createLivePricingAggregatorClient({ vendor: 'poketrace' });
    expect(live.vendor).toBe('poketrace');
    await expect(live.fetchQuotes()).rejects.toBeInstanceOf(LiveClientNotConfiguredError);
  });

  it('rejects an empty vendor at construction time', () => {
    expect(() => createLivePricingAggregatorClient({ vendor: '' })).toThrow();
  });
});

describe('isMockAggregatorEnabled', () => {
  it('defaults to true when the env var is unset', () => {
    expect(isMockAggregatorEnabled({})).toBe(true);
  });

  it('treats truthy values as ON', () => {
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: '1' })).toBe(true);
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: 'true' })).toBe(true);
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: 'TRUE' })).toBe(true);
  });

  it('treats explicit off values as OFF', () => {
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: '0' })).toBe(false);
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: 'false' })).toBe(false);
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: 'off' })).toBe(false);
    expect(isMockAggregatorEnabled({ MOCK_PRICING_AGGREGATOR: 'no' })).toBe(false);
  });
});

// ============================================================
// formatConfidence helper
// ============================================================

describe('formatConfidence', () => {
  it('formats to two decimal places', () => {
    expect(formatConfidence(0.86)).toBe('0.86');
    expect(formatConfidence(0)).toBe('0.00');
    expect(formatConfidence(1)).toBe('1.00');
  });

  it('clamps to [0, 1]', () => {
    expect(formatConfidence(-0.1)).toBe('0.00');
    expect(formatConfidence(2)).toBe('1.00');
  });

  it('treats non-finite values as 0', () => {
    expect(formatConfidence(Number.NaN)).toBe('0.00');
    expect(formatConfidence(Number.POSITIVE_INFINITY)).toBe('0.00');
  });
});
