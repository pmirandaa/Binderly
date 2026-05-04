// Zod schemas for the eBay Browse API surface we consume + the
// supporting marketplace + currency tables.
//
// We model only the fields the Layer-2 pricing adapter actually
// reads. eBay's Browse API returns dozens more (item specifics,
// shipping options, return policy, …) — we deliberately ignore
// everything we don't need so a future eBay schema change to a
// non-load-bearing field can't break us.
//
// References:
//   - eBay Browse API: https://developer.ebay.com/api-docs/buy/browse/overview.html
//   - eBay OAuth client-credentials grant:
//     https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html
//   - PROJECT.md § 13 (Layer 2 — eBay Browse API)
//   - context/data-model.md § Markets

import { z } from 'zod';

// ============================================================
// OAuth — client-credentials Application Token
// ============================================================

/**
 * Successful response from
 * `POST /identity/v1/oauth2/token` with
 * `grant_type=client_credentials`. eBay returns an
 * `Application Access Token` (note the `token_type` value).
 */
export const ebayOAuthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.string().min(1),
  })
  .strip();
export type EbayOAuthTokenResponse = z.infer<typeof ebayOAuthTokenResponseSchema>;

// ============================================================
// Browse search — `GET /buy/browse/v1/item_summary/search`
// ============================================================

/**
 * Money — the shape eBay uses for `price`, `shippingCost`, etc. The
 * `value` is a stringified decimal (e.g. `'12.34'`).
 */
export const ebayMoneySchema = z
  .object({
    value: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strip();
export type EbayMoney = z.infer<typeof ebayMoneySchema>;

export const ebayShippingOptionSchema = z
  .object({
    shippingCost: ebayMoneySchema.optional(),
  })
  .strip();
export type EbayShippingOption = z.infer<typeof ebayShippingOptionSchema>;

export const ebayItemLocationSchema = z
  .object({
    country: z.string().length(2).optional(),
  })
  .strip();
export type EbayItemLocation = z.infer<typeof ebayItemLocationSchema>;

export const ebaySellerSchema = z
  .object({
    username: z.string().optional(),
  })
  .strip();
export type EbaySeller = z.infer<typeof ebaySellerSchema>;

export const ebayImageSchema = z
  .object({
    imageUrl: z.string().url().optional(),
  })
  .strip();
export type EbayImage = z.infer<typeof ebayImageSchema>;

/**
 * One row of `itemSummaries[]`. Many fields are optional because
 * eBay omits them silently for some listings (sellers don't always
 * fill out the location, the image is missing on freshly created
 * listings, …). Only `itemId`, `title`, and `price` are required —
 * a listing missing any of those is a contract bug we want to
 * surface as `PermanentError`.
 */
export const ebayItemSummarySchema = z
  .object({
    itemId: z.string().min(1),
    title: z.string().min(1),
    price: ebayMoneySchema,
    shippingOptions: z.array(ebayShippingOptionSchema).optional(),
    itemLocation: ebayItemLocationSchema.optional(),
    itemCreationDate: z.string().optional(),
    itemWebUrl: z.string().url().optional(),
    seller: ebaySellerSchema.optional(),
    condition: z.string().optional(),
    image: ebayImageSchema.optional(),
    buyingOptions: z.array(z.string()).optional(),
  })
  .strip();
export type EbayItemSummary = z.infer<typeof ebayItemSummarySchema>;

/**
 * Search response. `total` is the upstream estimate of total
 * results (capped at 10_000 by eBay regardless of the actual
 * count); `itemSummaries` is the page itself.
 *
 * eBay sometimes omits `itemSummaries` entirely on a zero-result
 * page (rather than returning `[]`). We coerce missing → `[]` via
 * `default([])` so the runner doesn't have to special-case it.
 */
export const ebaySearchResponseSchema = z
  .object({
    total: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    itemSummaries: z.array(ebayItemSummarySchema).optional().default([]),
    next: z.string().url().optional(),
  })
  .strip();
export type EbaySearchResponse = z.infer<typeof ebaySearchResponseSchema>;

// ============================================================
// Marketplaces (the `X-EBAY-C-MARKETPLACE-ID` header values we
// support) and the corresponding Binderly `market.code` mapping.
// ============================================================

/**
 * `X-EBAY-C-MARKETPLACE-ID` values eBay accepts. We support the
 * four headline ones; UK uses `EBAY_GB` upstream but maps to
 * `EBAY_UK` in our `market` table per `context/data-model.md`.
 */
export const EBAY_MARKETPLACES = ['EBAY_US', 'EBAY_GB', 'EBAY_DE', 'EBAY_JP'] as const;
export const ebayMarketplaceSchema = z.enum(EBAY_MARKETPLACES);
export type EbayMarketplace = z.infer<typeof ebayMarketplaceSchema>;

/**
 * Map an eBay marketplace id to the `(market.code, defaultCurrency)`
 * pair we record on the observation. Source of truth for the
 * mapping; one-line additions when we expand to non-US markets.
 */
export const EBAY_MARKETPLACE_TO_BINDERLY: Readonly<
  Record<EbayMarketplace, { market: string; currency: string }>
> = Object.freeze({
  EBAY_US: { market: 'EBAY_US', currency: 'USD' },
  EBAY_GB: { market: 'EBAY_UK', currency: 'GBP' },
  EBAY_DE: { market: 'EBAY_DE', currency: 'EUR' },
  EBAY_JP: { market: 'EBAY_JP', currency: 'JPY' },
});

/**
 * Pokémon Individual Cards — eBay's category id. The Browse API
 * `?category_ids=` filter constrains results to this category so
 * generic toys / sealed product / accessories don't pollute the
 * stream.
 */
export const EBAY_POKEMON_INDIVIDUAL_CARDS_CATEGORY_ID = '183454' as const;
