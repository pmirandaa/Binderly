// Unit tests for `runPricingEbayBrowseIngest`.
//
// Strategy mirrors `fx-rates.test.ts`:
//   * Drive the runner end-to-end against `MockEbayBrowseClient` +
//     `InMemoryPriceObservationRepo`. No HTTP, no Postgres.
//   * Assert per-stage outcomes via the `PricingEbayBrowseReport`.
//   * Re-run a second time with the same listings to assert the
//     idempotency contract (same `(source, source_listing_id)` key
//     count after re-run).

import { beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryPriceObservationRepo,
  InMemoryPricingSetReader,
  runPricingEbayBrowseIngest,
} from './pricing-ebay-browse.js';
import {
  EbayBrowseAdapter,
  MockEbayBrowseClient,
  type EbayItemSummary,
} from '../adapters/pricing-ebay-browse/index.js';
import { NotFoundError } from '../interfaces/adapter.js';

import type {
  ParserCatalogCard,
  ParserCatalogPrinting,
  ParserCatalogReader,
} from '../parsers/ebay-listing/index.js';

// ============================================================
// Test fixtures
// ============================================================

const CARDS: ReadonlyArray<ParserCatalogCard> = [
  {
    id: 'card-swsh9-020',
    canonicalKey: 'en-swsh9-020',
    setCanonicalKey: 'en-swsh9',
    name: 'Charizard',
  },
  {
    id: 'card-swsh9-021',
    canonicalKey: 'en-swsh9-021',
    setCanonicalKey: 'en-swsh9',
    name: 'Pikachu',
  },
];

const PRINTINGS: ReadonlyArray<ParserCatalogPrinting> = [
  {
    id: 'p-swsh9-020',
    variantKey: 'en-swsh9-020-holo',
    cardId: 'card-swsh9-020',
    variantClass: 'HOLO',
    variantFlags: [],
  },
  {
    id: 'p-swsh9-021',
    variantKey: 'en-swsh9-021-holo',
    cardId: 'card-swsh9-021',
    variantClass: 'HOLO',
    variantFlags: [],
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
// Harness
// ============================================================

interface Harness {
  readonly client: MockEbayBrowseClient;
  readonly adapter: EbayBrowseAdapter;
  readonly repo: InMemoryPriceObservationRepo;
}

function buildHarness(over: { client?: MockEbayBrowseClient } = {}): Harness {
  const client = over.client ?? new MockEbayBrowseClient();
  const adapter = new EbayBrowseAdapter({
    client,
    catalogReader: makeReader(),
    now: () => new Date('2026-05-01T12:00:00.000Z'),
  });
  const repo = new InMemoryPriceObservationRepo();
  return { client, adapter, repo };
}

// ============================================================
// Tests
// ============================================================

describe('runPricingEbayBrowseIngest — argument validation', () => {
  it('refuses missing adapter', async () => {
    const repo = new InMemoryPriceObservationRepo();
    await expect(
      runPricingEbayBrowseIngest({ adapter: undefined as never, repo, queries: ['q'] }),
    ).rejects.toThrow(/adapter/u);
  });

  it('refuses missing repo', async () => {
    const { adapter } = buildHarness();
    await expect(
      runPricingEbayBrowseIngest({ adapter, repo: undefined as never, queries: ['q'] }),
    ).rejects.toThrow(/repo/u);
  });

  it('refuses missing query plan', async () => {
    const { adapter, repo } = buildHarness();
    await expect(runPricingEbayBrowseIngest({ adapter, repo })).rejects.toThrow(/queries.*setKey/u);
  });

  it('refuses both queries and setKey', async () => {
    const { adapter, repo } = buildHarness();
    await expect(
      runPricingEbayBrowseIngest({
        adapter,
        repo,
        queries: ['q'],
        setKey: 'en-swsh9',
        setReader: new InMemoryPricingSetReader([]),
      }),
    ).rejects.toThrow(/mutually exclusive/u);
  });

  it('refuses setKey without setReader', async () => {
    const { adapter, repo } = buildHarness();
    await expect(runPricingEbayBrowseIngest({ adapter, repo, setKey: 'en-swsh9' })).rejects.toThrow(
      /setReader/u,
    );
  });
});

describe('runPricingEbayBrowseIngest — explicit queries', () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it('writes one observation per resolved listing across queries', async () => {
    h.client
      .enqueue(
        { marketplace: 'EBAY_US', query: 'Charizard 020' },
        {
          itemSummaries: [item('v1|psa10-zard|0', 'PSA 10 Charizard 020/172 Brilliant Stars Holo')],
        },
      )
      .enqueue(
        { marketplace: 'EBAY_US', query: 'Pikachu 021' },
        {
          itemSummaries: [item('v1|psa10-pika|0', 'PSA 10 Pikachu 021/172 Brilliant Stars Holo')],
        },
      );

    const report = await runPricingEbayBrowseIngest({
      adapter: h.adapter,
      repo: h.repo,
      queries: ['Charizard 020', 'Pikachu 021'],
    });

    expect(report.queriesRequested).toBe(2);
    expect(report.queriesSucceeded).toBe(2);
    expect(report.listingsFetched).toBe(2);
    expect(report.observationsUpserted).toBe(2);
    expect(report.errors).toHaveLength(0);
    expect(h.repo.size()).toBe(2);
    const ids = h.repo
      .list()
      .map((r) => r.sourceListingId)
      .sort();
    expect(ids).toEqual(['v1|psa10-pika|0', 'v1|psa10-zard|0']);
  });

  it('idempotent re-run: row count steady after second pass', async () => {
    const program = (): void => {
      h.client.enqueue(
        { marketplace: 'EBAY_US', query: 'Charizard 020' },
        {
          itemSummaries: [item('v1|psa10-zard|0', 'PSA 10 Charizard 020/172 Brilliant Stars Holo')],
        },
      );
    };
    program();
    await runPricingEbayBrowseIngest({
      adapter: h.adapter,
      repo: h.repo,
      queries: ['Charizard 020'],
    });
    expect(h.repo.size()).toBe(1);

    program();
    await runPricingEbayBrowseIngest({
      adapter: h.adapter,
      repo: h.repo,
      queries: ['Charizard 020'],
    });
    expect(h.repo.size()).toBe(1);
  });

  it('counts dropped lot listings + low-confidence drops', async () => {
    h.client.enqueue(
      { marketplace: 'EBAY_US', query: 'Charizard 020' },
      {
        itemSummaries: [
          item('v1|psa10|0', 'PSA 10 Charizard 020/172 Brilliant Stars Holo'),
          item('v1|lot|0', 'Lot of 50 Charizard 020/172 mixed'),
          item('v1|gibberish|0', 'PSA 10 Mewtwo SVI 056 Scarlet Violet'),
        ],
      },
    );
    const report = await runPricingEbayBrowseIngest({
      adapter: h.adapter,
      repo: h.repo,
      queries: ['Charizard 020'],
    });
    expect(report.listingsFetched).toBe(3);
    expect(report.droppedLot).toBe(1);
    expect(report.droppedUnresolved).toBe(1);
    expect(report.observationsUpserted).toBe(1);
  });

  it('records 404 in errors[] and continues other queries', async () => {
    // Inject a throwing client that 404s for one query and succeeds
    // for the other.
    const throwingClient = {
      async searchItemSummaries(opts: {
        query: string;
        marketplace: 'EBAY_US' | 'EBAY_GB' | 'EBAY_DE' | 'EBAY_JP';
      }) {
        if (opts.query === 'missing') {
          throw new NotFoundError('synthetic 404', { source: 'api.ebay.com' });
        }
        return {
          total: 1,
          limit: 50,
          offset: 0,
          itemSummaries: [item('v1|psa10|0', 'PSA 10 Charizard 020/172 Brilliant Stars Holo')],
        };
      },
    };
    const adapter = new EbayBrowseAdapter({
      client: throwingClient,
      catalogReader: makeReader(),
      now: () => new Date('2026-05-01T12:00:00.000Z'),
    });
    const repo = new InMemoryPriceObservationRepo();
    const report = await runPricingEbayBrowseIngest({
      adapter,
      repo,
      queries: ['missing', 'Charizard 020'],
    });
    expect(report.queriesRequested).toBe(2);
    expect(report.queriesSucceeded).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.query).toBe('missing');
    expect(report.observationsUpserted).toBe(1);
  });

  it('respects maxQueries cap', async () => {
    h.client
      .enqueue({ marketplace: 'EBAY_US', query: 'a' }, { itemSummaries: [] })
      .enqueue({ marketplace: 'EBAY_US', query: 'b' }, { itemSummaries: [] });
    const report = await runPricingEbayBrowseIngest({
      adapter: h.adapter,
      repo: h.repo,
      queries: ['a', 'b', 'c'],
      maxQueries: 2,
    });
    expect(report.queriesRequested).toBe(2);
    expect(h.client.calls.map((c) => c.query)).toEqual(['a', 'b']);
  });
});

describe('runPricingEbayBrowseIngest — set-key plan', () => {
  it('enumerates cards in the set into one query each', async () => {
    const setReader = new InMemoryPricingSetReader([
      {
        canonicalKey: 'en-swsh9-020',
        name: 'Charizard',
        number: '020/172',
        setCanonicalKey: 'en-swsh9',
        setName: 'Brilliant Stars',
      },
      {
        canonicalKey: 'en-swsh9-021',
        name: 'Pikachu',
        number: '021/172',
        setCanonicalKey: 'en-swsh9',
        setName: 'Brilliant Stars',
      },
    ]);
    const h = buildHarness();
    h.client
      .enqueue(
        { marketplace: 'EBAY_US', query: 'Charizard Brilliant Stars 020/172' },
        {
          itemSummaries: [item('v1|psa10-zard|0', 'PSA 10 Charizard 020/172 Brilliant Stars Holo')],
        },
      )
      .enqueue(
        { marketplace: 'EBAY_US', query: 'Pikachu Brilliant Stars 021/172' },
        {
          itemSummaries: [item('v1|psa10-pika|0', 'PSA 10 Pikachu 021/172 Brilliant Stars Holo')],
        },
      );
    const report = await runPricingEbayBrowseIngest({
      adapter: h.adapter,
      repo: h.repo,
      setKey: 'en-swsh9',
      setReader,
    });
    expect(report.queriesRequested).toBe(2);
    expect(report.observationsUpserted).toBe(2);
  });
});
