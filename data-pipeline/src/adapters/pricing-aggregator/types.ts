// Public types for the pricing aggregator adapter (T-DL-PRICING-AGGREGATOR).
//
// Two families live here:
//
//   1. `AggregatorQuote` — what the (mock or live)
//      `PricingAggregatorClient` emits per quote it has fetched
//      from the upstream paid vendor. Two kinds:
//
//        * `cardmarket_quote` — pre-attributed by the aggregator to
//          a specific `printingVariantKey`. No listing title to
//          parse; the canonical-id helper synthesises a stable
//          per-day idempotency id.
//        * `ebay_sold_listing` — aggregator passthrough of an eBay
//          sold listing. Carries the original listing title which
//          the runner parses with `parseEbayListing` and joins via
//          `resolveListingToPrinting` to attribute to a
//          `(card_id, printing_id)` tuple.
//
//   2. `RawPriceObservation` — what the runner produces per
//      successfully-resolved quote, immediately before persistence.
//      Structurally identical to `NewPriceObservation` from
//      `@binderly/db` so the production drizzle repo hands it to
//      `db.insert(...).values(...)` without translation. The
//      compile-time alignment check lives in `repo.ts`.
//
// Currency handling: every quote and every observation carries its
// source currency on the `currency`/`observedCurrency` field. We
// never convert at ingest (`rules/01-data-layer.md` "Prices are
// stored in source currency. Conversion happens at display time
// using `fx_rate` for the observation's date").

import { z } from 'zod';

import { GRADE_TIERS, gradeTierSchema, type GradeTier } from '../../parsers/ebay-listing/index.js';

// ============================================================
// Markets
// ============================================================

/**
 * The seven canonical market codes seeded by
 * `0009_pricing_rls.sql` (T-DL-SCHEMA-PRICING). The schema column
 * is free-form `text` referencing `market.code`, but the runner
 * validates against this list before write so an unknown code
 * surfaces as an `unknown_market` error rather than a deferred
 * FK constraint failure.
 */
export const MARKET_CODES = [
  'EBAY_US',
  'EBAY_DE',
  'EBAY_UK',
  'EBAY_JP',
  'CARDMARKET_EU',
  'TCGPLAYER_DERIVED',
  'OTHER',
] as const;
export const marketCodeSchema = z.enum(MARKET_CODES);
export type MarketCode = z.infer<typeof marketCodeSchema>;

// ============================================================
// Observation kinds
// ============================================================

/**
 * Mirrors the `price_observation.observation_kind` CHECK.
 *
 *   * `'sold'`             — actual transaction price (eBay sold
 *                            listing or aggregator-derived sold
 *                            data).
 *   * `'active_listing'`   — asking price (eBay Browse — Layer 2,
 *                            not this adapter).
 *   * `'aggregator_quote'` — aggregator-emitted normalized price
 *                            for a `(printing × grade × market ×
 *                            currency × day)` slice. Cardmarket
 *                            data lands here.
 */
export const OBSERVATION_KINDS = ['sold', 'active_listing', 'aggregator_quote'] as const;
export const observationKindSchema = z.enum(OBSERVATION_KINDS);
export type ObservationKind = z.infer<typeof observationKindSchema>;

// ============================================================
// AggregatorQuote — what the client emits
// ============================================================

const numericString = z
  .string()
  .regex(/^\d+(\.\d+)?$/u, 'expected non-negative numeric string (e.g. "12.34")');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'expected ISO yyyy-mm-dd');

const isoDateTime = z.union([
  z.string().datetime({ offset: true }),
  z.string().datetime(),
  z.date(),
]);

/**
 * Common fields shared by every quote shape.
 */
const aggregatorQuoteBase = {
  /**
   * Vendor tag, lowercased. `'mock'` for fixtures; `'poketrace'` /
   * `'pokemonapi'` (etc.) for the live client. Reflected in
   * `price_observation.source` as `aggregator_<vendor>`.
   */
  vendor: z.string().min(1),
  /**
   * Canonical market code. Validated against `MARKET_CODES`; an
   * unknown code is recorded as a non-fatal `unknown_market`
   * error and the quote is skipped.
   */
  market: marketCodeSchema,
  /** ISO 4217 source currency (USD / EUR / JPY / GBP / …). */
  currency: z.string().regex(/^[A-Z]{3}$/u, 'expected ISO 4217 currency code'),
  /**
   * Canonical grade tier (re-exported from the listing parser's
   * enum so we share one source of truth across pricing
   * adapters).
   */
  gradeTier: gradeTierSchema,
  /** Observed price in source currency, formatted as a numeric string. */
  price: numericString,
  /** Optional shipping cost in source currency. */
  shipping: numericString.nullable().optional(),
  /**
   * Wall-clock timestamp of the underlying transaction / quote
   * publication. Either an ISO-8601 datetime string or a `Date`.
   * The runner normalises to `Date`.
   */
  observedAt: isoDateTime,
  /**
   * Calendar date the observation pertains to. Stored separately
   * from `observedAt` to align with the schema's
   * `observed_date date NOT NULL` column and the FX-rate join's
   * `fx_rate.rate_date = observed_date` equality.
   */
  observedDate: isoDate,
  /**
   * Free-form provenance payload — the aggregator's raw response,
   * any seller / listing URL, etc. Persisted in
   * `price_observation.raw_metadata` for the kill-switch /
   * takedown response posture in `context/legal-and-brand.md`.
   */
  rawPayload: z.record(z.unknown()),
};

/**
 * Cardmarket-style quote. The aggregator has already attributed
 * it to a specific printing via its variant key.
 */
export const cardmarketQuoteSchema = z
  .object({
    kind: z.literal('cardmarket_quote'),
    /**
     * Catalog variant key — `{language}-{set_code}-{number}-{variant_code}`.
     * Resolved via `findPrintingByVariantKey` to the catalog
     * `printing.id`.
     */
    printingVariantKey: z.string().min(1),
    ...aggregatorQuoteBase,
  })
  .strict();
export type CardmarketQuote = z.infer<typeof cardmarketQuoteSchema>;

/**
 * eBay-sold-listing-style quote. The aggregator forwards the
 * original listing title verbatim; the runner parses it.
 */
export const ebaySoldListingQuoteSchema = z
  .object({
    kind: z.literal('ebay_sold_listing'),
    /** Free-text listing title; parsed by `parseEbayListing`. */
    listingTitle: z.string().min(1),
    /** Stable upstream item id when present. */
    listingId: z.string().min(1).nullable().optional(),
    /** Optional URL to the original listing (debug surface). */
    listingUrl: z.string().url().nullable().optional(),
    ...aggregatorQuoteBase,
  })
  .strict();
export type EbaySoldListingQuote = z.infer<typeof ebaySoldListingQuoteSchema>;

export const aggregatorQuoteSchema = z.discriminatedUnion('kind', [
  cardmarketQuoteSchema,
  ebaySoldListingQuoteSchema,
]);
export type AggregatorQuote = z.infer<typeof aggregatorQuoteSchema>;

// ============================================================
// RawPriceObservation — runner output, pre-write
// ============================================================

// The runner's per-quote output (post-resolution, pre-write) is the
// shared `RawPriceObservation` from `data-pipeline/src/types.ts` — the
// single source of truth for BOTH pricing adapters (#FU-2). It maps 1:1
// to `NewPriceObservation` from `@binderly/db`; the production
// `DrizzlePriceObservationRepo` asserts that alignment. Re-exported here
// so existing `./types.js` imports keep resolving.
export { rawPriceObservationSchema } from '../../types.js';
export type { RawPriceObservation } from '../../types.js';

// ============================================================
// Re-exports for the package barrel
// ============================================================

export { GRADE_TIERS, gradeTierSchema };
export type { GradeTier };
