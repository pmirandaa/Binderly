// FetchShim tests for `EbayBrowseClient`.
//
// Coverage:
//   - happy path: GET /buy/browse/v1/item_summary/search hits with
//     the right query/limit/offset/category/filters
//   - User-Agent + Authorization + marketplace headers are set
//   - 404 bubbles NotFoundError
//   - 429 retry path through the RateLimitedClient
//   - schema-mismatch / malformed JSON bubble PermanentError
//   - limit/offset validation throws BEFORE the HTTP call

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EBAY_BROWSE_BASE_PATH, EbayBrowseClient, PRICING_EBAY_BROWSE_SOURCE } from './client.js';
import { EBAY_API_HOST, EbayOAuthClient } from './oauth.js';
import { EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID } from './types.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { NotFoundError, PermanentError, RateLimitError } from '../../interfaces/adapter.js';

const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface ProgrammableResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

class FetchShim {
  readonly requests: RecordedRequest[] = [];
  private readonly queues = new Map<string, ProgrammableResponse[]>();

  enqueue(pathname: string, ...responses: ProgrammableResponse[]): this {
    const list = this.queues.get(pathname) ?? [];
    list.push(...responses);
    this.queues.set(pathname, list);
    return this;
  }

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.requests.push({ url, method: init?.method ?? 'GET', headers });
    const pathname = new URL(url).pathname;
    const queue = this.queues.get(pathname);
    let next: ProgrammableResponse | undefined;
    if (queue && queue.length > 0) next = queue.shift();
    if (!next) throw new Error(`FetchShim: no programmed response for ${pathname}`);
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  };
}

const SEARCH_PATH = `${EBAY_BROWSE_BASE_PATH}/item_summary/search`;
const TOKEN_PATH = '/identity/v1/oauth2/token';

const TOKEN_BODY = JSON.stringify({
  access_token: 'test-bearer',
  expires_in: 7200,
  token_type: 'Application Access Token',
});

const SEARCH_BODY_OK = JSON.stringify({
  total: 1,
  limit: 50,
  offset: 0,
  itemSummaries: [
    {
      itemId: 'v1|123|0',
      title: 'PSA 10 Charizard SWSH9 020/172',
      price: { value: '299.99', currency: 'USD' },
      shippingOptions: [{ shippingCost: { value: '4.99', currency: 'USD' } }],
      itemLocation: { country: 'US' },
      itemWebUrl: 'https://www.ebay.com/itm/v1-123-0',
      seller: { username: 'demo' },
      condition: 'Used',
      buyingOptions: ['FIXED_PRICE'],
    },
  ],
});

let shim: FetchShim;

beforeEach(() => {
  shim = new FetchShim();
});

afterEach(() => {
  delete process.env['BINDERLY_DATA_PIPELINE_UA'];
});

function newClient(over: Partial<ConstructorParameters<typeof RateLimitedClient>[0]> = {}) {
  const http = new RateLimitedClient({
    host: EBAY_API_HOST,
    requestsPerSecond: 100,
    burst: 10,
    userAgent: UA,
    retries: { max: 2, baseDelayMs: 1, factor: 2 },
    timeout: 1_000,
    fetchImpl: shim.fetch,
    sleep: () => Promise.resolve(),
    ...over,
  });
  const oauth = new EbayOAuthClient({
    http,
    clientId: 'TEST_ID',
    clientSecret: 'TEST_SECRET',
    now: () => 1_700_000_000_000,
  });
  return { http, oauth, client: new EbayBrowseClient({ http, oauth }) };
}

describe('EbayBrowseClient — construction', () => {
  it('refuses a RateLimitedClient pinned to a different host', () => {
    const wrongHost = new RateLimitedClient({
      host: 'api.tcgdex.net',
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    const goodHost = new RateLimitedClient({
      host: EBAY_API_HOST,
      requestsPerSecond: 1,
      burst: 1,
      userAgent: UA,
      fetchImpl: shim.fetch,
    });
    const oauth = new EbayOAuthClient({
      http: goodHost,
      clientId: 'a',
      clientSecret: 'b',
    });
    expect(() => new EbayBrowseClient({ http: wrongHost, oauth })).toThrow(
      /pinned to api\.ebay\.com/u,
    );
  });

  it('exposes the canonical source tag', () => {
    expect(PRICING_EBAY_BROWSE_SOURCE).toBe('ebay_browse');
  });
});

describe('EbayBrowseClient — searchItemSummaries', () => {
  it('happy path: hits the search endpoint with q + limit + category + filters', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 200, body: SEARCH_BODY_OK });

    const res = await client.searchItemSummaries({
      query: 'Charizard SWSH9',
      marketplace: 'EBAY_US',
      limit: 50,
    });
    expect(res.itemSummaries).toHaveLength(1);
    expect(res.itemSummaries[0]?.itemId).toBe('v1|123|0');

    // 1st request was OAuth, 2nd was search.
    expect(shim.requests).toHaveLength(2);
    const sent = new URL(shim.requests[1]!.url);
    expect(sent.pathname).toBe(SEARCH_PATH);
    expect(sent.searchParams.get('q')).toBe('Charizard SWSH9');
    expect(sent.searchParams.get('limit')).toBe('50');
    expect(sent.searchParams.get('category_ids')).toBe(EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID);
    const filters = sent.searchParams.getAll('filter');
    expect(filters).toContain('priceCurrency:USD');
    expect(filters).toContain('buyingOptions:{FIXED_PRICE|AUCTION}');
  });

  it('sets Authorization, X-EBAY-C-MARKETPLACE-ID, Accept, and User-Agent headers', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 200, body: SEARCH_BODY_OK });
    await client.searchItemSummaries({
      query: 'q',
      marketplace: 'EBAY_GB',
      limit: 10,
    });
    const search = shim.requests[1]!;
    expect(search.headers['authorization']).toBe('Bearer test-bearer');
    expect(search.headers['x-ebay-c-marketplace-id']).toBe('EBAY_GB');
    expect(search.headers['accept']).toBe('application/json');
    expect(search.headers['user-agent']).toBe(UA);
  });

  it('honors offset (omitted when 0, set otherwise)', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 200, body: SEARCH_BODY_OK });
    shim.enqueue(SEARCH_PATH, { status: 200, body: SEARCH_BODY_OK });

    await client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 10 });
    const first = new URL(shim.requests[1]!.url);
    expect(first.searchParams.has('offset')).toBe(false);

    await client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 10, offset: 50 });
    const second = new URL(shim.requests[2]!.url);
    expect(second.searchParams.get('offset')).toBe('50');
  });

  it('appends extraFilters in addition to the defaults', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 200, body: SEARCH_BODY_OK });
    await client.searchItemSummaries({
      query: 'q',
      marketplace: 'EBAY_US',
      limit: 5,
      extraFilters: ['itemLocationCountry:US'],
    });
    const sent = new URL(shim.requests[1]!.url);
    const filters = sent.searchParams.getAll('filter');
    expect(filters).toContain('itemLocationCountry:US');
  });

  it('drops the category filter when categoryId is null', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 200, body: SEARCH_BODY_OK });
    await client.searchItemSummaries({
      query: 'q',
      marketplace: 'EBAY_US',
      limit: 5,
      categoryId: null,
    });
    const sent = new URL(shim.requests[1]!.url);
    expect(sent.searchParams.has('category_ids')).toBe(false);
  });

  it('throws on out-of-range limit/offset BEFORE the HTTP call', async () => {
    const { client } = newClient();
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 0 }),
    ).rejects.toThrow(/limit/u);
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 201 }),
    ).rejects.toThrow(/limit/u);
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 50, offset: -1 }),
    ).rejects.toThrow(/offset/u);
    expect(shim.requests).toHaveLength(0);
  });

  it('coerces a missing itemSummaries field into []', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, {
      status: 200,
      body: JSON.stringify({ total: 0, limit: 50, offset: 0 }),
    });
    const res = await client.searchItemSummaries({
      query: 'no-results',
      marketplace: 'EBAY_US',
      limit: 50,
    });
    expect(res.itemSummaries).toEqual([]);
  });

  it('404 bubbles NotFoundError', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 404, body: '{"errors":[]}' });
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 50 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('429 with Retry-After is retried by the RateLimitedClient', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(
      SEARCH_PATH,
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: SEARCH_BODY_OK },
    );
    const res = await client.searchItemSummaries({
      query: 'q',
      marketplace: 'EBAY_US',
      limit: 50,
    });
    expect(res.itemSummaries).toHaveLength(1);
    // 1 token + 1 retry + 1 success = 3 requests
    expect(shim.requests).toHaveLength(3);
  });

  it('429 retries exhausted bubble RateLimitError', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(
      SEARCH_PATH,
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    );
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 50 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('schema-mismatch body throws PermanentError', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, {
      status: 200,
      body: JSON.stringify({ itemSummaries: [{ itemId: 1 /* wrong type */ }] }),
    });
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 50 }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('malformed JSON body throws PermanentError', async () => {
    const { client } = newClient();
    shim.enqueue(TOKEN_PATH, { status: 200, body: TOKEN_BODY });
    shim.enqueue(SEARCH_PATH, { status: 200, body: 'not json {{{' });
    await expect(
      client.searchItemSummaries({ query: 'q', marketplace: 'EBAY_US', limit: 50 }),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});
