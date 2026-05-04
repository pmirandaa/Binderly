// Drizzle schemas for the daily-snapshot pricing surface
// (PROJECT.md § 13).
//
// Two tables ship in this single file. Both are "daily snapshot"
// surfaces in the sense that each row is keyed on a calendar date
// and is consumed by the display layer or the rollup / view jobs:
//
// 1. `price_aggregate` — daily rolled-up summary, keyed by
//    `(printing_id, grade_tier, market, currency, period_start)`.
//    Computed nightly by `T-DL-PRICING-ROLLUP` from
//    `price_observation` rows for the day, applying outlier
//    filtering (`context/data-model.md` § "price_aggregate":
//    "drop top/bottom 5% if sample_count ≥ 20; exclude
//    parse_confidence < 0.7"). The composite PK doubles as the
//    primary lookup index — the leading prefix
//    `(printing_id, grade_tier, market)` answers the headline-
//    price query that `mv_current_price` (T-DL-PRICING-CURRENT-VIEW)
//    will materialize. Currency is part of the key, so no
//    information is lost even when a single (market, day) carries
//    observations in multiple currencies (rare; in practice each
//    market collapses cleanly to a dominant currency). Public-
//    read posture (consumer-facing graphs and the "all markets"
//    toggle read directly from this table per PROJECT.md § 13).
//
// 2. `fx_rate` — daily exchange rates. Composite PK
//    `(rate_date, base_currency, quote_currency)`. Populated by
//    `T-DL-FX-RATES` from a free source (Frankfurter / ECB) and
//    backfilled for historical dates. The display layer
//    (`packages/pricing-display`) is the only place currency
//    conversion happens (`rules/01-data-layer.md`: "Conversion
//    happens at display time using `fx_rate` for the
//    observation's date"). For dates with no rate, the display
//    layer falls back to the most recent prior date and flags
//    the result as "approx." Public-read posture (consumer-
//    facing display utility).
//
// Both tables ship with the consumer-facing RLS posture
// (anon + authenticated SELECT, REVOKE permissive default writes,
// service_role full DML) in the companion
// `<NNNN+1>_pricing_rls.sql` migration. Mirrors the catalog-RLS
// pattern from `0003_catalog_rls.sql`.
//
// `printing_id` and `market` FKs follow the same posture as
// `price_observation` (default "no action" delete behavior; the
// catalog is effectively immutable post-ingest).

import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { marketTable } from './prices.js';
import { printingTable } from './printings.js';

export const priceAggregateTable = pgTable(
  'price_aggregate',
  {
    printingId: uuid('printing_id')
      .notNull()
      .references(() => printingTable.id),
    // Same free-form `text` posture as `price_observation.grade_tier`
    // — the canonical enum lives in `context/data-model.md` §
    // "Grade tiers" and is validated at the rollup-job layer.
    gradeTier: text('grade_tier').notNull(),
    market: text('market')
      .notNull()
      .references(() => marketTable.code),
    // Group key: aggregates are stored *per currency of the
    // underlying observations* so no information is lost. In
    // practice each (market, currency) combo collapses cleanly
    // because each market has a dominant currency (eBay US → USD,
    // Cardmarket → EUR), but the dimension exists for the rare
    // cross-currency listing.
    currency: text('currency').notNull(),
    // Inclusive start of the period this row aggregates over.
    // Daily rollups use `period_start = period_end = the day`;
    // the column pair is kept distinct so the rollup job can
    // collapse to weekly / monthly later without a schema
    // migration.
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    // All four central-tendency columns are nullable. After
    // outlier filtering (drop top/bottom 5% if sample_count ≥ 20),
    // a row may exist with `sample_count = 0` — the rollup job
    // still emits the row so consumers can distinguish "no data
    // today" from "we never aggregated this slice". `numeric(12,2)`
    // matches `price_observation.observed_price` precision.
    medianPrice: numeric('median_price', { precision: 12, scale: 2 }),
    meanPrice: numeric('mean_price', { precision: 12, scale: 2 }),
    lowPrice: numeric('low_price', { precision: 12, scale: 2 }),
    highPrice: numeric('high_price', { precision: 12, scale: 2 }),
    sampleCount: integer('sample_count').notNull(),
    // `{ "ebay_browse": 12, "aggregator_x": 1 }` — debug surface
    // for "where did this price come from?" diagnostics on the
    // card detail page.
    sourceBreakdown: jsonb('source_breakdown').notNull(),
    // `{ "sold": 8, "active_listing": 4, "aggregator_quote": 1 }`
    // — same shape, broken down by the kinds enum from
    // `price_observation.observation_kind`.
    observationKindBreakdown: jsonb('observation_kind_breakdown').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Composite PK doubles as the primary lookup index — the
    // leading prefix `(printing_id, grade_tier, market)` answers
    // the headline-price query that `mv_current_price` (T-DL-
    // PRICING-CURRENT-VIEW) will materialize. No additional
    // indexes ship in this task: `mv_current_price` is the fast
    // path for current-price lookups and ad-hoc cross-printing
    // scans aren't a Phase-1 query pattern.
    primaryKey({
      name: 'price_aggregate_pkey',
      columns: [table.printingId, table.gradeTier, table.market, table.currency, table.periodStart],
    }),
  ],
);

export type PriceAggregate = typeof priceAggregateTable.$inferSelect;
export type NewPriceAggregate = typeof priceAggregateTable.$inferInsert;

export const fxRateTable = pgTable(
  'fx_rate',
  {
    rateDate: date('rate_date').notNull(),
    // Always `'USD'` for v1 — documented for future flexibility
    // (we may add a second base for resilience or to match a
    // source's native base). The display layer derives any
    // cross-currency rate transitively through the base.
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    // 1 base_currency = N quote_currency. `numeric(14,6)` gives
    // six decimal places, enough for JPY (~150) and CLP (~900)
    // without overflow and enough precision for thinly-traded
    // pairs. Matches `context/data-model.md` § "fx_rate".
    rate: numeric('rate', { precision: 14, scale: 6 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    // Provenance: `'frankfurter'`, `'ecb'`,
    // `'openexchangerates'`, etc. T-DL-FX-RATES picks one and
    // populates this column for every row it writes.
    source: text('source').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'fx_rate_pkey',
      columns: [table.rateDate, table.baseCurrency, table.quoteCurrency],
    }),
    // The display layer's common forward-lookup pattern is "give
    // me the rate for (rate_date, quote_currency = USER_CURRENCY,
    // base_currency = 'USD')". The PK starts with `rate_date`
    // ascending which is the wrong direction for "most recent
    // first" fallbacks, so we add an explicit `(rate_date desc,
    // quote_currency)` index per `context/data-model.md` §
    // "fx_rate".
    index('fx_rate_rate_date_quote_currency_idx').on(table.rateDate.desc(), table.quoteCurrency),
  ],
);

export type FxRate = typeof fxRateTable.$inferSelect;
export type NewFxRate = typeof fxRateTable.$inferInsert;
