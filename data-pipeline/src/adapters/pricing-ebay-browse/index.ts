// Public barrel for the eBay Browse pricing adapter (Layer 2 —
// active listings, free, no approval).
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules — chiefly `data-pipeline/src/jobs/pricing-ebay-browse.ts` —
// pull directly from this file.

export {
  EBAY_API_HOST,
  EBAY_OAUTH_DEFAULT_SCOPE,
  EBAY_OAUTH_TOKEN_PATH,
  EBAY_OAUTH_TOKEN_REFRESH_SKEW_MS,
  EbayOAuthClient,
  createEbayOAuthClient,
} from './oauth.js';
export type { EbayOAuthClientConfig } from './oauth.js';

export {
  EBAY_BROWSE_BASE_PATH,
  EBAY_BROWSE_DEFAULT_BURST,
  EBAY_BROWSE_DEFAULT_PAGE_LIMIT,
  EBAY_BROWSE_DEFAULT_RPS,
  EBAY_BROWSE_DEFAULT_USER_AGENT,
  EbayBrowseClient,
  PRICING_EBAY_BROWSE_SOURCE,
  createEbayBrowseClient,
} from './client.js';
export type { EbayBrowseClientConfig, EbayBrowseClientLike, EbaySearchOptions } from './client.js';

export {
  EBAY_MARKETPLACES,
  EBAY_MARKETPLACE_TO_BINDERLY,
  EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID,
  ebayItemSummarySchema,
  ebayMarketplaceSchema,
  ebayMoneySchema,
  ebayOAuthTokenResponseSchema,
  ebaySearchResponseSchema,
} from './types.js';
export type {
  EbayItemLocation,
  EbayItemSummary,
  EbayMarketplace,
  EbayMoney,
  EbayOAuthTokenResponse,
  EbaySearchResponse,
  EbaySeller,
  EbayShippingOption,
} from './types.js';

export {
  EbayBrowseAdapter,
  PRICING_EBAY_BROWSE_DEFAULT_MAX_PAGES,
  PRICING_EBAY_BROWSE_DEFAULT_PAGE_SIZE,
  PRICING_EBAY_BROWSE_MIN_CONFIDENCE,
  normalizeNumeric,
} from './adapter.js';
export type {
  EbayBrowseAdapterConfig,
  StreamObservationsOptions,
  StreamObservationsResult,
  StreamObservationsStats,
} from './adapter.js';

export { MockEbayBrowseClient, synthesiseResponse } from './mock.js';
export type { MockEbayBrowseClientOptions, MockEbayBrowseResponse } from './mock.js';
