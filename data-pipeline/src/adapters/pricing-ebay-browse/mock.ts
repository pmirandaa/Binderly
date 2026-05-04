// `MockEbayBrowseClient` — programmable in-memory swap-in for
// `EbayBrowseClient`.
//
// Used by:
//   1. unit tests in `*.test.ts` — explicit `enqueue()` call sites.
//   2. `MOCK_PRICING_EBAY_BROWSE=1` runtime mode — the CLI / job
//      auto-builds a mock with synthetic fixtures so a sandbox
//      operator can exercise the end-to-end shape without
//      credentials or live network.
//
// The mock matches `EbayBrowseClientLike`. Tests typically
// pre-program a queue of responses keyed on `(marketplace, query)`;
// pulls drain the queue FIFO. A `defaultResponse` / `synthetic
// fixtures` fallback covers calls that don't have a programmed
// match.

import { EBAY_MARKETPLACE_TO_BINDERLY } from './types.js';

import type { EbayBrowseClientLike, EbaySearchOptions } from './client.js';
import type { EbayItemSummary, EbayMarketplace, EbaySearchResponse } from './types.js';

/**
 * One queued response. Pulls drain FIFO until the queue is empty,
 * after which the mock falls back to `defaultResponse` (if set) or
 * `syntheticFor(query)` (if `useSynthetic` is true).
 */
export interface MockEbayBrowseResponse {
  itemSummaries: ReadonlyArray<EbayItemSummary>;
  total?: number;
}

export interface MockEbayBrowseClientOptions {
  /** When true, missing keys synthesise a deterministic response. */
  readonly useSynthetic?: boolean;
  /**
   * Optional single response served whenever the per-key queue is
   * empty AND `useSynthetic` is false. Tests use this for "every
   * query returns the same data" cases.
   */
  readonly defaultResponse?: MockEbayBrowseResponse;
}

interface RecordedCall {
  readonly marketplace: EbayMarketplace;
  readonly query: string;
  readonly offset: number;
  readonly limit: number;
}

export class MockEbayBrowseClient implements EbayBrowseClientLike {
  readonly calls: RecordedCall[] = [];
  private readonly queues = new Map<string, MockEbayBrowseResponse[]>();
  private readonly options: MockEbayBrowseClientOptions;

  constructor(options: MockEbayBrowseClientOptions = {}) {
    this.options = options;
  }

  /**
   * Queue one or more responses against `(marketplace, query)`.
   * Successive calls drain FIFO. Consumers usually queue exactly
   * one page; if the test needs pagination it queues N pages.
   */
  enqueue(
    key: { marketplace: EbayMarketplace; query: string },
    ...responses: ReadonlyArray<MockEbayBrowseResponse>
  ): this {
    const k = `${key.marketplace}|${key.query}`;
    const list = this.queues.get(k) ?? [];
    list.push(...responses);
    this.queues.set(k, list);
    return this;
  }

  async searchItemSummaries(options: EbaySearchOptions): Promise<EbaySearchResponse> {
    this.calls.push({
      marketplace: options.marketplace,
      query: options.query,
      offset: options.offset ?? 0,
      limit: options.limit ?? 50,
    });
    const k = `${options.marketplace}|${options.query}`;
    const queue = this.queues.get(k);
    let next: MockEbayBrowseResponse | undefined;
    if (queue && queue.length > 0) next = queue.shift();
    if (!next && this.options.defaultResponse) next = this.options.defaultResponse;
    if (!next && this.options.useSynthetic) {
      next = synthesiseResponse({
        query: options.query,
        marketplace: options.marketplace,
      });
    }
    if (!next) {
      // Empty page is a perfectly valid response; the mock returns
      // an empty result rather than throwing so the runner sees the
      // same shape it would in production for "no results".
      next = { itemSummaries: [], total: 0 };
    }
    return {
      total: next.total ?? next.itemSummaries.length,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      itemSummaries: [...next.itemSummaries],
    };
  }
}

/**
 * Build a deterministic synthetic response for a query. Used by the
 * `MOCK_PRICING_EBAY_BROWSE=1` runtime mode so the sandbox can
 * exercise the job end-to-end without credentials or network.
 *
 * The synthetic listings cover the key shapes: a slabbed PSA 10, a
 * BGS slab, a raw NM listing, and one lot listing (which the
 * adapter must drop). Numbers are stable so tests can assert
 * against them.
 */
export function synthesiseResponse(input: {
  query: string;
  marketplace: EbayMarketplace;
}): MockEbayBrowseResponse {
  const meta = EBAY_MARKETPLACE_TO_BINDERLY[input.marketplace];
  const country = countryFor(input.marketplace);
  const baseTitle = (input.query || 'Charizard SWSH9 020/172').trim();
  const itemSummaries: EbayItemSummary[] = [
    {
      itemId: `mock-${slug(baseTitle)}-psa10`,
      title: `PSA 10 ${baseTitle} Brilliant Stars Holo`,
      price: { value: '299.99', currency: meta.currency },
      shippingOptions: [{ shippingCost: { value: '4.99', currency: meta.currency } }],
      itemLocation: { country },
      itemCreationDate: '2026-04-12T18:42:11.000Z',
      itemWebUrl: `https://www.ebay.com/itm/mock-${slug(baseTitle)}-psa10`,
      seller: { username: 'mock_seller' },
      condition: 'Used',
      buyingOptions: ['FIXED_PRICE'],
    },
    {
      itemId: `mock-${slug(baseTitle)}-bgs95`,
      title: `BGS 9.5 ${baseTitle} Reverse Holo`,
      price: { value: '189.50', currency: meta.currency },
      shippingOptions: [{ shippingCost: { value: '6.00', currency: meta.currency } }],
      itemLocation: { country },
      itemCreationDate: '2026-04-13T09:15:00.000Z',
      itemWebUrl: `https://www.ebay.com/itm/mock-${slug(baseTitle)}-bgs95`,
      seller: { username: 'mock_seller_2' },
      condition: 'Used',
      buyingOptions: ['FIXED_PRICE'],
    },
    {
      itemId: `mock-${slug(baseTitle)}-raw-nm`,
      title: `${baseTitle} Near Mint Pokemon TCG`,
      price: { value: '24.99', currency: meta.currency },
      itemLocation: { country },
      itemCreationDate: '2026-04-14T12:00:00.000Z',
      itemWebUrl: `https://www.ebay.com/itm/mock-${slug(baseTitle)}-raw-nm`,
      seller: { username: 'mock_seller_3' },
      condition: 'Near Mint',
      buyingOptions: ['FIXED_PRICE'],
    },
    {
      itemId: `mock-${slug(baseTitle)}-lot`,
      title: `Lot of 50 ${baseTitle} cards mixed`,
      price: { value: '119.00', currency: meta.currency },
      itemLocation: { country },
      itemCreationDate: '2026-04-15T08:00:00.000Z',
      itemWebUrl: `https://www.ebay.com/itm/mock-${slug(baseTitle)}-lot`,
      seller: { username: 'mock_seller_4' },
      condition: 'Used',
      buyingOptions: ['FIXED_PRICE'],
    },
  ];
  return { itemSummaries, total: itemSummaries.length };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 60);
}

function countryFor(marketplace: EbayMarketplace): string {
  switch (marketplace) {
    case 'EBAY_US':
      return 'US';
    case 'EBAY_GB':
      return 'GB';
    case 'EBAY_DE':
      return 'DE';
    case 'EBAY_JP':
      return 'JP';
  }
}
