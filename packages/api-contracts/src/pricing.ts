// Pricing DTOs — READ shapes for the live pricing surface
// (PROJECT.md § 13). The contracts package describes the wire
// format; the actual ingestion + rollup lives in `data-pipeline/`
// and the display formatter lives in T-SP-PRICING-DISPLAY.
//
// Mirrors the Drizzle pricing tables in:
//
//   - `packages/db/src/schema/prices.ts` (`market`,
//     `price_observation`)
//   - `packages/db/src/schema/price_snapshots.ts`
//     (`price_aggregate`, `fx_rate`)
//   - the `mv_current_price` materialized view from
//     T-DL-PRICING-CURRENT-VIEW (no Drizzle binding; the DTO is
//     hand-modeled per the migration's column list).
//
// Currency posture (PROJECT.md § 13: "store native, convert at
// display time"): every price DTO carries its `currency`
// alongside the value. Display-time conversion is the consumer's
// job using `fxRateDto` keyed on the observation's date.
//
// `price_observation` itself is service-role-only per
// `rules/02-backend.md` and the schema file's comment ("RLS
// posture is service-role-only — mirrors the
// `grading_training_sample` precedent"); we therefore do NOT
// expose a `priceObservationDto` from the contracts package. If
// an admin-debug surface eventually ships, it gets its own
// dedicated DTO module gated behind `service_role`.

import { z } from 'zod';

import {
  currencyCodeSchema,
  gradeTierSchema,
  isoDateSchema,
  isoDateTimeSchema,
  marketCodeSchema,
  numericString2dpSchema,
  numericString6dpSchema,
  uuidSchema,
} from './common.js';

// ============================================================
// market — catalog table, public-read
// ============================================================

/**
 * Market tier — `'primary'` markets surface as the default
 * headline price; `'secondary'` markets only appear when the
 * user opts into "all markets" (PROJECT.md § 13).
 */
export const MARKET_TIERS = ['primary', 'secondary'] as const;
export const marketTierSchema = z.enum(MARKET_TIERS);
export type MarketTier = z.infer<typeof marketTierSchema>;

/**
 * Read-side wire shape for a `market` row. Catalog table —
 * public-read; surfaced to clients so the UI can build the
 * "all markets" toggle without a hard-coded list.
 */
export const marketDto = z
  .object({
    code: marketCodeSchema,
    displayName: z.string().min(1),
    tier: marketTierSchema,
    defaultCurrency: currencyCodeSchema,
    region: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .strict();
export type MarketDto = z.infer<typeof marketDto>;

// ============================================================
// price_aggregate — daily rolled-up summary
// ============================================================

/**
 * `observation_kind` enum from `price_observation`. Re-exposed
 * here because `price_aggregate.observation_kind_breakdown`
 * keys by it.
 */
export const PRICE_OBSERVATION_KINDS = ['sold', 'active_listing', 'aggregator_quote'] as const;
export const priceObservationKindSchema = z.enum(PRICE_OBSERVATION_KINDS);
export type PriceObservationKind = z.infer<typeof priceObservationKindSchema>;

/**
 * Read-side wire shape for a `price_aggregate` row. Used by the
 * "30 / 90 / all-time" graph queries on card-detail and by the
 * "all markets" toggle.
 *
 * - `medianPrice` / `meanPrice` / `lowPrice` / `highPrice` are
 *   `numeric(12,2)` columns and may be null after outlier
 *   filtering (the rollup job emits a row with `sample_count =
 *   0` so consumers can distinguish "no data this day" from
 *   "we never aggregated this slice"). Strings on the wire to
 *   match the Drizzle posture.
 * - `sourceBreakdown` and `observationKindBreakdown` are
 *   `jsonb` debug surfaces; the typed shape is `Record<string,
 *   number>` (counts per source / kind).
 */
export const priceAggregateDto = z
  .object({
    printingId: uuidSchema,
    gradeTier: gradeTierSchema,
    market: marketCodeSchema,
    currency: currencyCodeSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    medianPrice: numericString2dpSchema.nullable(),
    meanPrice: numericString2dpSchema.nullable(),
    lowPrice: numericString2dpSchema.nullable(),
    highPrice: numericString2dpSchema.nullable(),
    sampleCount: z.number().int().nonnegative(),
    sourceBreakdown: z.record(z.number().int().nonnegative()),
    observationKindBreakdown: z.record(priceObservationKindSchema, z.number().int().nonnegative()),
    computedAt: isoDateTimeSchema,
  })
  .strict();
export type PriceAggregateDto = z.infer<typeof priceAggregateDto>;

// ============================================================
// mv_current_price — materialized headline price
// ============================================================

/**
 * Read-side wire shape for an `mv_current_price` row, the
 * pre-computed headline price per (printing, grade_tier,
 * market, currency). v1 column set per
 * T-DL-PRICING-CURRENT-VIEW (Q-006 in `open-questions.md`):
 * the latest aggregate stats; the richer trends + freshness
 * columns from `context/data-model.md` § mv_current_price are
 * deferred to a follow-up task.
 *
 * The card-detail UI's headline price reads directly from
 * this DTO; the "all grade tiers" expanded view reads from
 * `priceAggregateDto`. T-SP-PRICING-DISPLAY owns the
 * format-and-FX-convert step.
 */
export const currentPriceDto = z
  .object({
    printingId: uuidSchema,
    gradeTier: gradeTierSchema,
    market: marketCodeSchema,
    currency: currencyCodeSchema,
    periodStart: isoDateSchema,
    medianPrice: numericString2dpSchema.nullable(),
    meanPrice: numericString2dpSchema.nullable(),
    lowPrice: numericString2dpSchema.nullable(),
    highPrice: numericString2dpSchema.nullable(),
    sampleCount: z.number().int().nonnegative(),
    computedAt: isoDateTimeSchema,
  })
  .strict();
export type CurrentPriceDto = z.infer<typeof currentPriceDto>;

/**
 * Freshness band emitted by `GET /v1/printings/:id/current-price`.
 * The endpoint derives this from `computedAt`:
 *
 * - `'fresh'`  — `computedAt` ≤ 7 days ago.
 * - `'stale'`  — `computedAt` 7 – 30 days ago.
 * - `'stale_old'` — `computedAt` > 30 days ago.
 *
 * Pre-derived server-side so SSR + client + OG image agree on
 * the rounded buckets without round-trip drift.
 */
export const PRINTING_CURRENT_PRICE_FRESHNESS = ['fresh', 'stale', 'stale_old'] as const;
export const printingCurrentPriceFreshnessSchema = z.enum(PRINTING_CURRENT_PRICE_FRESHNESS);
export type PrintingCurrentPriceFreshness = z.infer<typeof printingCurrentPriceFreshnessSchema>;

/**
 * Read-side wire shape for `GET /v1/printings/:id/current-price`.
 *
 * Strict subset of `currentPriceDto` (the existing all-grades /
 * all-markets DTO) plus a derived `freshness` band — pre-bucketed
 * by the server so the card-detail page renders the same
 * "fresh / stale" badge SSR-side, client-side, and in the OG
 * image without rounding drift. Carries only the columns
 * `mv_current_price` actually has today; the richer trend
 * columns from `context/data-model.md` § `mv_current_price`
 * (`trend_7d`, `trend_30d`, `sample_count_30d`, …) are deferred
 * — see Q-013 in `open-questions.md`.
 */
export const printingCurrentPriceDto = z
  .object({
    printingId: uuidSchema,
    gradeTier: gradeTierSchema,
    market: marketCodeSchema,
    currency: currencyCodeSchema,
    periodStart: isoDateSchema,
    medianPrice: numericString2dpSchema.nullable(),
    meanPrice: numericString2dpSchema.nullable(),
    lowPrice: numericString2dpSchema.nullable(),
    highPrice: numericString2dpSchema.nullable(),
    sampleCount: z.number().int().nonnegative(),
    computedAt: isoDateTimeSchema,
    freshness: printingCurrentPriceFreshnessSchema,
  })
  .strict();
export type PrintingCurrentPriceDto = z.infer<typeof printingCurrentPriceDto>;

// ============================================================
// fx_rate — daily exchange rate
// ============================================================

/**
 * Read-side wire shape for an `fx_rate` row. T-SP-PRICING-
 * DISPLAY converts every monetary value to the user's
 * `profile.preferences.display_currency` using the rate of the
 * observation's day (PROJECT.md § 13: "Conversion happens at
 * display time using the exchange rate of the observation's
 * date"). For a 90-day graph, each daily aggregate is
 * converted using *its own day's rate*; missing rates fall
 * back to the most recent prior date.
 *
 * `rate` is `numeric(14,6)` — six decimal places, encoded as
 * a string per `numericString6dpSchema`.
 */
export const fxRateDto = z
  .object({
    rateDate: isoDateSchema,
    baseCurrency: currencyCodeSchema,
    quoteCurrency: currencyCodeSchema,
    rate: numericString6dpSchema,
    fetchedAt: isoDateTimeSchema,
    source: z.string().min(1),
  })
  .strict();
export type FxRateDto = z.infer<typeof fxRateDto>;

// ============================================================
// Query shapes (price-history endpoint)
// ============================================================

/**
 * Query parameters for the price-history endpoint
 * (`GET /v1/printings/{id}/prices?...`). Validated against the
 * decoded query string; the endpoint route lives in
 * T-BE-EDGE-FUNCTIONS.
 *
 * - `gradeTier` is required — the UI always asks for a
 *   specific tier (the headline view picks one based on the
 *   user's `default_grade_tier_view` preference).
 * - `market` defaults server-side to the user's
 *   `default_market` preference, then to `EBAY_US`.
 * - `period` is one of three canonical windows (matches
 *   PROJECT.md § 13 "30/90/all-time price graphs").
 */
export const PRICE_HISTORY_PERIODS = ['30d', '90d', 'all'] as const;
export const priceHistoryPeriodSchema = z.enum(PRICE_HISTORY_PERIODS);
export type PriceHistoryPeriod = z.infer<typeof priceHistoryPeriodSchema>;

export const priceHistoryQuery = z
  .object({
    gradeTier: gradeTierSchema,
    market: marketCodeSchema.optional(),
    period: priceHistoryPeriodSchema.optional(),
  })
  .strict();
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuery>;
