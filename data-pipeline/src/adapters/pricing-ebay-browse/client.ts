// `EbayBrowseClient` — thin wrapper around `RateLimitedClient` for
// `api.ebay.com/buy/browse/v1`.
//
// Only one endpoint matters for Layer-2 ingestion:
//   GET /buy/browse/v1/item_summary/search?q=...&limit=...&offset=...
//
// Headers (set automatically):
//   - `Authorization: Bearer <APPLICATION_TOKEN>` — fetched via
//     `EbayOAuthClient`.
//   - `X-EBAY-C-MARKETPLACE-ID: EBAY_US | EBAY_GB | EBAY_DE | EBAY_JP`
//   - `Accept: application/json`
//
// Error policy:
//   - 404 (uncommon — usually empty results come back as 200 with
//     `total: 0`) bubbles `NotFoundError`. The runner converts to a
//     no-op for that query.
//   - 429 / 5xx / network error → owned by `RateLimitedClient`.
//   - 4xx (other) → `PermanentError`.
//   - Schema-mismatched body → `PermanentError`.
//
// Host pinning: the constructor enforces that the
// `RateLimitedClient` host is `api.ebay.com`, mirroring the
// Frankfurter / TCGdex defensive posture.

import { EBAY_API_HOST, EbayOAuthClient } from './oauth.js';
import {
  EBAY_MARKETPLACE_TO_BINDERLY,
  EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID,
  ebaySearchResponseSchema,
  type EbayMarketplace,
  type EbaySearchResponse,
} from './types.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { PermanentError, type AdapterContext } from '../../interfaces/adapter.js';

export const EBAY_BROWSE_BASE_PATH = '/buy/browse/v1' as const;

/** String tag stored in `price_observation.source` for every row. */
export const PRICING_EBAY_BROWSE_SOURCE = 'ebay_browse' as const;

/** Default per-page limit (max eBay accepts is 200). */
export const EBAY_BROWSE_DEFAULT_PAGE_LIMIT = 50;

/** Conservative request-rate floor; daily quota is the actual bottleneck. */
export const EBAY_BROWSE_DEFAULT_RPS = 1;
export const EBAY_BROWSE_DEFAULT_BURST = 5;

/** Default User-Agent when none is supplied. */
export const EBAY_BROWSE_DEFAULT_USER_AGENT =
  'binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly)';

export interface EbayBrowseClientConfig {
  /** RateLimitedClient pinned to `api.ebay.com`. */
  http: RateLimitedClient;
  /** OAuth client — provides the bearer token. */
  oauth: EbayOAuthClient;
  /** Override base path for tests. Defaults to `/buy/browse/v1`. */
  basePath?: string;
  /** Optional shared adapter context (logger, env). */
  context?: AdapterContext;
}

export interface EbaySearchOptions {
  /** Free-text search query. */
  query: string;
  /**
   * Marketplace to query. Routes the `X-EBAY-C-MARKETPLACE-ID`
   * header. Listings returned reflect the marketplace's locale,
   * currency, and inventory pool.
   */
  marketplace: EbayMarketplace;
  /** Page size; defaults to 50, max 200. */
  limit?: number;
  /** Pagination offset; defaults to 0. */
  offset?: number;
  /**
   * Override the eBay category id. Defaults to
   * `EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID` (`'183454'`). Tests
   * pass `null` to query without a category filter.
   */
  categoryId?: string | null;
  /**
   * Extra `filter=` clauses to append. Each entry is a single
   * `key:value` (or `key:{val1|val2}`) string per eBay's
   * filter-spec syntax. The defaults are intentionally minimal so
   * tests stay tight.
   */
  extraFilters?: ReadonlyArray<string>;
}

/**
 * Lightweight surface the `EbayBrowseAdapter` depends on. Tests
 * inject a `MockEbayBrowseClient`; production wires the live
 * `EbayBrowseClient`. Mirrors the `FxRateRepo` ↔
 * `InMemoryFxRateRepo` boundary.
 */
export interface EbayBrowseClientLike {
  searchItemSummaries(options: EbaySearchOptions): Promise<EbaySearchResponse>;
}

export class EbayBrowseClient implements EbayBrowseClientLike {
  private readonly http: RateLimitedClient;
  private readonly oauth: EbayOAuthClient;
  private readonly basePath: string;
  private readonly logger: AdapterContext['logger'] | undefined;

  constructor(config: EbayBrowseClientConfig) {
    if (!config.http) {
      throw new Error('EbayBrowseClient: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== EBAY_API_HOST) {
      throw new Error(
        `EbayBrowseClient: RateLimitedClient must be pinned to ${EBAY_API_HOST} (got ${config.http.host})`,
      );
    }
    if (!config.oauth) {
      throw new Error('EbayBrowseClient: `oauth` (EbayOAuthClient) is required');
    }
    this.http = config.http;
    this.oauth = config.oauth;
    this.basePath = (config.basePath ?? EBAY_BROWSE_BASE_PATH).replace(/\/$/, '');
    this.logger = config.context?.logger;
  }

  /**
   * `GET /buy/browse/v1/item_summary/search` — single page. Callers
   * (the adapter) page by re-invoking with successive `offset` values.
   */
  async searchItemSummaries(options: EbaySearchOptions): Promise<EbaySearchResponse> {
    const target = this.buildSearchPath(options);
    const token = await this.oauth.getApplicationToken();
    const res = await this.http.request(target, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': options.marketplace,
        Accept: 'application/json',
      },
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch (cause) {
      throw new PermanentError(`EbayBrowseClient: search response is not valid JSON`, {
        source: EBAY_API_HOST,
        target,
        cause,
      });
    }
    const parsed = ebaySearchResponseSchema.safeParse(body);
    if (!parsed.success) {
      this.logger?.error(
        {
          source: PRICING_EBAY_BROWSE_SOURCE,
          target,
          issues: parsed.error.issues.slice(0, 5),
        },
        'ebay-browse.search.invalid_response',
      );
      throw new PermanentError(`EbayBrowseClient: search response did not match schema`, {
        source: EBAY_API_HOST,
        target,
        cause: parsed.error,
      });
    }
    this.logger?.debug?.(
      {
        source: PRICING_EBAY_BROWSE_SOURCE,
        marketplace: options.marketplace,
        query: options.query,
        offset: options.offset ?? 0,
        limit: options.limit ?? EBAY_BROWSE_DEFAULT_PAGE_LIMIT,
        items: parsed.data.itemSummaries.length,
      },
      'ebay-browse.search.ok',
    );
    return parsed.data;
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  private buildSearchPath(options: EbaySearchOptions): string {
    const params = new URLSearchParams();
    params.set('q', options.query);
    const limit = options.limit ?? EBAY_BROWSE_DEFAULT_PAGE_LIMIT;
    if (limit < 1 || limit > 200) {
      throw new Error(`EbayBrowseClient.searchItemSummaries: limit ${limit} outside [1, 200]`);
    }
    params.set('limit', String(limit));
    const offset = options.offset ?? 0;
    if (offset < 0) {
      throw new Error(`EbayBrowseClient.searchItemSummaries: offset ${offset} must be >= 0`);
    }
    if (offset > 0) params.set('offset', String(offset));

    const categoryId =
      options.categoryId === undefined
        ? EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID
        : options.categoryId;
    if (categoryId !== null) params.set('category_ids', categoryId);

    // eBay-style multi-filter: `filter=` may be specified multiple
    // times; URLSearchParams' append duplicates the key, which the
    // upstream accepts.
    const marketplaceMeta = EBAY_MARKETPLACE_TO_BINDERLY[options.marketplace];
    const filters: string[] = [
      `priceCurrency:${marketplaceMeta.currency}`,
      `buyingOptions:{FIXED_PRICE|AUCTION}`,
      ...(options.extraFilters ?? []),
    ];
    for (const filter of filters) params.append('filter', filter);

    return `${this.basePath}/item_summary/search?${params.toString()}`;
  }
}

/**
 * Convenience factory: build an `EbayBrowseClient` against an
 * already-constructed `EbayOAuthClient` (or build both from
 * credentials).
 */
export function createEbayBrowseClient(options: {
  oauth: EbayOAuthClient;
  http?: RateLimitedClient;
  httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
  context?: AdapterContext;
  basePath?: string;
}): EbayBrowseClient {
  const http =
    options.http ??
    new RateLimitedClient({
      host: EBAY_API_HOST,
      requestsPerSecond: EBAY_BROWSE_DEFAULT_RPS,
      burst: EBAY_BROWSE_DEFAULT_BURST,
      userAgent: EBAY_BROWSE_DEFAULT_USER_AGENT,
      ...(options.httpOverrides ?? {}),
    });
  const config: EbayBrowseClientConfig = { http, oauth: options.oauth };
  if (options.context !== undefined) config.context = options.context;
  if (options.basePath !== undefined) config.basePath = options.basePath;
  return new EbayBrowseClient(config);
}
