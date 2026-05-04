// Integration tests for `EbayBrowseAdapter`.
//
// Exercises the parse → join → emit pipeline end-to-end against a
// `MockEbayBrowseClient` and an in-memory `ParserCatalogReader`. No
// HTTP, no Postgres.

import { describe, expect, it } from 'vitest';

import {
  EbayBrowseAdapter,
  normalizeNumeric,
  PRICING_EBAY_BROWSE_MIN_CONFIDENCE,
} from './adapter.js';
import { PRICING_EBAY_BROWSE_SOURCE } from './client.js';
import { MockEbayBrowseClient, synthesiseResponse } from './mock.js';

import type { EbayItemSummary } from './types.js';
import type {
  ParserCatalogCard,
  ParserCatalogPrinting,
  ParserCatalogReader,
} from '../../parsers/ebay-listing/index.js';

// ============================================================
// Catalog fixture (mirrors `joiner.test.ts`)
// ============================================================

const CARDS: ReadonlyArray<ParserCatalogCard> = [
  {
    id: 'card-swsh9-020-charizard',
    canonicalKey: 'en-swsh9-020',
    setCanonicalKey: 'en-swsh9',
    name: 'Charizard',
  },
  {
    id: 'card-base1-004-charizard',
    canonicalKey: 'en-base1-004',
    setCanonicalKey: 'en-base1',
    name: 'Charizard',
  },
];

const PRINTINGS: ReadonlyArray<ParserCatalogPrinting> = [
  {
    id: 'p-swsh9-020-charizard-vmax-holo',
    variantKey: 'en-swsh9-020-holo',
    cardId: 'card-swsh9-020-charizard',
    variantClass: 'HOLO',
    variantFlags: [],
  },
  {
    id: 'p-base1-004-charizard-holo-fe-sl',
    variantKey: 'en-base1-004-holo-fe-sl',
    cardId: 'card-base1-004-charizard',
    variantClass: 'HOLO',
    variantFlags: ['FIRST_EDITION', 'SHADOWLESS'],
  },
  {
    id: 'p-base1-004-charizard-holo-sl',
    variantKey: 'en-base1-004-holo-sl',
    cardId: 'card-base1-004-charizard',
    variantClass: 'HOLO',
    variantFlags: ['SHADOWLESS'],
  },
];

function makeReader(): ParserCatalogReader {
  return {
    async findCardByCanonicalKey(canonicalKey) {
      return CARDS.find((c) => c.canonicalKey === canonicalKey) ?? null;
    },
    async findCardsByNameAndSetCode({ nameLike, setCanonicalKey, limit = 5 }) {
      const lower = nameLike.toLowerCase();
      const candidates = CARDS.filter((c) => {
        const nameOk = c.name.toLowerCase().includes(lower);
        const setOk = setCanonicalKey == null || c.setCanonicalKey === setCanonicalKey;
        return nameOk && setOk;
      });
      return candidates.slice(0, limit);
    },
    async findPrintingsByCardId(cardId) {
      return PRINTINGS.filter((p) => p.cardId === cardId);
    },
  };
}

// ============================================================
// itemSummary helpers
// ============================================================

function item(id: string, title: string, over: Partial<EbayItemSummary> = {}): EbayItemSummary {
  return {
    itemId: id,
    title,
    price: { value: '99.99', currency: 'USD' },
    shippingOptions: [{ shippingCost: { value: '4.99', currency: 'USD' } }],
    itemLocation: { country: 'US' },
    itemCreationDate: '2026-04-12T18:42:11.000Z',
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    seller: { username: 'demo' },
    condition: 'Used',
    buyingOptions: ['FIXED_PRICE'],
    ...over,
  };
}

// ============================================================
// Tests
// ============================================================

describe('EbayBrowseAdapter — construction', () => {
  it('refuses missing client / catalogReader', () => {
    const reader = makeReader();
    const client = new MockEbayBrowseClient();
    expect(
      () => new EbayBrowseAdapter({ client: undefined as never, catalogReader: reader }),
    ).toThrow();
    expect(() => new EbayBrowseAdapter({ client, catalogReader: undefined as never })).toThrow();
  });

  it('exposes the canonical source tag', () => {
    const adapter = new EbayBrowseAdapter({
      client: new MockEbayBrowseClient(),
      catalogReader: makeReader(),
    });
    expect(adapter.source).toBe(PRICING_EBAY_BROWSE_SOURCE);
  });
});

describe('EbayBrowseAdapter — streamObservationsForQuery', () => {
  const fixedNow = new Date('2026-05-01T12:34:56.000Z');

  function buildAdapter(client: MockEbayBrowseClient) {
    return new EbayBrowseAdapter({
      client,
      catalogReader: makeReader(),
      now: () => fixedNow,
    });
  }

  it('emits a RawEbayBrowsePriceObservation for a high-confidence PSA 10 listing', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard VMAX 020/172' },
      {
        itemSummaries: [item('v1|psa10|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo')],
      },
    );
    const adapter = buildAdapter(client);
    const { observations, stats } = await adapter.streamObservationsForQuery({
      query: 'Charizard VMAX 020/172',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(1);
    const o = observations[0]!;
    expect(o.source).toBe('ebay_browse');
    expect(o.sourceListingId).toBe('v1|psa10|0');
    expect(o.printingId).toBe('p-swsh9-020-charizard-vmax-holo');
    expect(o.observationKind).toBe('active_listing');
    expect(o.market).toBe('EBAY_US');
    expect(o.gradeTier).toBe('PSA_10');
    expect(o.observedPrice).toBe('99.99');
    expect(o.observedCurrency).toBe('USD');
    expect(o.shipping).toBe('4.99');
    expect(o.parseConfidence).toBeGreaterThanOrEqual(PRICING_EBAY_BROWSE_MIN_CONFIDENCE);
    expect(o.observedAt).toEqual(fixedNow);
    expect(o.observedDate).toBe('2026-05-01');
    expect(o.rawMetadata).toMatchObject({
      title: 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo',
      itemWebUrl: 'https://www.ebay.com/itm/v1|psa10|0',
      sellerUsername: 'demo',
      itemCreationDate: '2026-04-12T18:42:11.000Z',
      condition: 'Used',
      country: 'US',
      buyingOptions: ['FIXED_PRICE'],
      marketplace: 'EBAY_US',
    });
    expect(stats.listingsFetched).toBe(1);
    expect(stats.listingsParsed).toBe(1);
    expect(stats.droppedLot).toBe(0);
    expect(stats.droppedLowConfidence).toBe(0);
    expect(stats.droppedUnresolved).toBe(0);
  });

  it('drops lot listings (joiner confidence = 0)', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [
          item('v1|lot|0', 'Lot of 50 Charizard 020/172 Brilliant Stars cards mixed'),
        ],
      },
    );
    const adapter = buildAdapter(client);
    const { observations, stats } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(0);
    expect(stats.droppedLot).toBe(1);
    expect(stats.droppedLowConfidence).toBe(0);
  });

  it('emits RAW_NM for a Near Mint condition listing', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [item('v1|raw|0', 'Charizard VMAX 020/172 Brilliant Stars Holo Near Mint')],
      },
    );
    const adapter = buildAdapter(client);
    const { observations } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.gradeTier).toBe('RAW_NM');
  });

  it('emits RAW_UNKNOWN when neither slab nor parsed condition is present', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [item('v1|unk|0', 'Charizard VMAX 020/172 Brilliant Stars Holo')],
      },
    );
    const adapter = buildAdapter(client);
    const { observations } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.gradeTier).toBe('RAW_UNKNOWN');
  });

  it('drops listings whose printing cannot be resolved', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'gibberish' },
      {
        itemSummaries: [
          // Title doesn't match any card in the catalog fixture.
          item('v1|unresolved|0', 'PSA 10 Mewtwo SVI 056 Scarlet Violet'),
        ],
      },
    );
    const adapter = buildAdapter(client);
    const { observations, stats } = await adapter.streamObservationsForQuery({
      query: 'gibberish',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(0);
    expect(stats.droppedUnresolved).toBe(1);
  });

  it('respects the marketplace mapping (EBAY_GB → EBAY_UK + GBP)', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_GB', query: 'Charizard 020/172' },
      {
        itemSummaries: [
          item('v1|gb|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo', {
            price: { value: '249.00', currency: 'GBP' },
            shippingOptions: [{ shippingCost: { value: '5.00', currency: 'GBP' } }],
            itemLocation: { country: 'GB' },
          }),
        ],
      },
    );
    const adapter = buildAdapter(client);
    const { observations } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_GB',
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.market).toBe('EBAY_UK');
    expect(observations[0]?.observedCurrency).toBe('GBP');
  });

  it('null shipping when shippingOptions is absent', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [
          item('v1|noship|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo', {
            shippingOptions: undefined,
          }),
        ],
      },
    );
    const adapter = buildAdapter(client);
    const { observations } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.shipping).toBeNull();
  });

  it('drops listings with confidence below the threshold', async () => {
    const client = new MockEbayBrowseClient();
    // Construct an adapter with a very high threshold so even good
    // listings drop. This isolates the threshold logic from any
    // upstream parser drift.
    const adapter = new EbayBrowseAdapter({
      client,
      catalogReader: makeReader(),
      minConfidence: 1.5,
      now: () => fixedNow,
    });
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [item('v1|psa10|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo')],
      },
    );
    const { observations, stats } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
    });
    expect(observations).toHaveLength(0);
    expect(stats.droppedLowConfidence).toBe(1);
  });

  it('paginates: stops on a short page', async () => {
    const client = new MockEbayBrowseClient();
    // First page is full (matches pageSize), second page is short → stops.
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [
          item('v1|psa10-1|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo'),
          item('v1|psa10-2|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo'),
        ],
      },
      {
        itemSummaries: [item('v1|psa10-3|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo')],
      },
    );
    const adapter = buildAdapter(client);
    const { observations, stats } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
      pageSize: 2,
    });
    expect(observations).toHaveLength(3);
    expect(stats.pagesFetched).toBe(2);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.offset).toBe(2);
  });

  it('paginates: stops on an empty page', async () => {
    const client = new MockEbayBrowseClient();
    client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
      {
        itemSummaries: [
          item('v1|psa10-1|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo'),
          item('v1|psa10-2|0', 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo'),
        ],
      },
      { itemSummaries: [] },
    );
    const adapter = buildAdapter(client);
    const { observations, stats } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
      pageSize: 2,
    });
    expect(observations).toHaveLength(2);
    expect(stats.pagesFetched).toBe(2);
  });

  it('respects maxPages', async () => {
    const client = new MockEbayBrowseClient({ useSynthetic: false });
    // Always full pages; without maxPages we'd loop forever.
    for (let i = 0; i < 5; i++) {
      client.enqueue(
        { marketplace: 'EBAY_US', query: 'Charizard 020/172' },
        {
          itemSummaries: [
            item(`v1|psa10-${i}-1|0`, 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo'),
            item(`v1|psa10-${i}-2|0`, 'PSA 10 Charizard VMAX 020/172 Brilliant Stars Holo'),
          ],
        },
      );
    }
    const adapter = buildAdapter(client);
    const { stats } = await adapter.streamObservationsForQuery({
      query: 'Charizard 020/172',
      marketplace: 'EBAY_US',
      pageSize: 2,
      maxPages: 2,
    });
    expect(stats.pagesFetched).toBe(2);
  });
});

describe('synthesiseResponse', () => {
  it('returns deterministic listings for the documented shapes', () => {
    const r = synthesiseResponse({ query: 'Charizard SWSH9 020/172', marketplace: 'EBAY_US' });
    expect(r.itemSummaries).toHaveLength(4);
    const titles = r.itemSummaries.map((s) => s.title);
    expect(titles[0]).toMatch(/^PSA 10/u);
    expect(titles[1]).toMatch(/^BGS 9\.5/u);
    expect(titles[2]).toMatch(/Near Mint/u);
    expect(titles[3]).toMatch(/^Lot of 50/u);
  });

  it('uses the marketplace-mapped currency', () => {
    const r = synthesiseResponse({ query: 'Charizard', marketplace: 'EBAY_GB' });
    for (const s of r.itemSummaries) {
      expect(s.price.currency).toBe('GBP');
    }
  });
});

describe('normalizeNumeric', () => {
  it('rounds to two decimals', () => {
    expect(normalizeNumeric('12.345')).toBe('12.35');
    expect(normalizeNumeric('12')).toBe('12.00');
    expect(normalizeNumeric('0')).toBe('0.00');
  });
  it('throws on garbage', () => {
    expect(() => normalizeNumeric('abc')).toThrow();
    expect(() => normalizeNumeric('1,234.56')).toThrow();
  });
});
