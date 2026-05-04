// Drizzle schemas for the live pricing surface (PROJECT.md § 13).
//
// Two tables ship in this single file:
//
// 1. `market` — small catalog table identifying the source-market a
//    price came from. Different markets reflect different buyer
//    pools and price levels (eBay US in USD vs Cardmarket EU in
//    EUR vs eBay JP in JPY); they are *not* convertible to each
//    other via FX, so we never average across markets — see
//    `rules/01-data-layer.md` ("Pricing is market-segmented; never
//    average across markets"). Seeded with the seven canonical
//    codes (`EBAY_US`, `EBAY_DE`, `EBAY_UK`, `EBAY_JP`,
//    `CARDMARKET_EU`, `TCGPLAYER_DERIVED`, `OTHER`) by the
//    companion RLS migration. `tier` is `'primary' | 'secondary'`
//    and controls whether the UI surfaces this market by default.
//    Public-read posture (catalog table per
//    `context/data-model.md` § "RLS policies").
//
// 2. `price_observation` — append-only raw signal. Every price
//    quote we ingest from the aggregator (Layer 1 — eBay sold +
//    Cardmarket via paid API), the eBay Browse API (Layer 2 —
//    active listings, free), or eBay Marketplace Insights (Layer 3
//    — post-launch, gated approval) lands here in its source
//    currency, tagged with the market it came from. The display
//    layer never reads this table directly: it reads from
//    `price_aggregate` (daily rollup) or `mv_current_price` (the
//    materialized view from T-DL-PRICING-CURRENT-VIEW). This row
//    is pipeline-internal and carries `raw_metadata` (title,
//    seller, source URL) for debug and the kill-switch /
//    takedown response in `context/legal-and-brand.md`. RLS
//    posture is service-role-only — mirrors the
//    `grading_training_sample` precedent in `0007_grading_rls.sql`.
//
// Currency model (PROJECT.md § 13 "Currency model: store native,
// convert at display time"): `observed_currency` is mandatory and
// is the source currency of `observed_price`. We never convert at
// ingest. The display layer (`packages/pricing-display`) joins
// against `fx_rate` for the observation's `observed_date` to
// render the user's display currency.
//
// Idempotent ingestion: `(source, source_listing_id)` is UNIQUE
// (default NULLS DISTINCT), so adapters upsert on it. Aggregator
// quotes that lack an upstream listing id leave `source_listing_id`
// NULL and are intentionally not deduped at the SQL layer (the
// adapter emits its own quote ids per
// `context/data-model.md` § "price_observation").
//
// `printing_id` is an in-schema FK to `printing.id` — pricing data
// always keys to a specific printing (catalog + variant). We
// deliberately do not cascade deletes from `printing`: the catalog
// is effectively append-only post-ingest, and on the rare day we
// need to consolidate a printing row we want the migration to
// surface dependent observation rows so a human can decide.
// Drizzle's default action ("no action") matches the
// `collection_item` → `printing` posture from
// `T-DL-SCHEMA-COLLECTIONS`.

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { printingTable } from './printings.js';

export const marketTable = pgTable(
  'market',
  {
    code: text('code').primaryKey(),
    displayName: text('display_name').notNull(),
    // `'primary'` markets surface as the default headline price;
    // `'secondary'` markets only appear when the user opts into the
    // "all markets" view on a card (PROJECT.md § 13). Pinned via the
    // CHECK constraint below so a typo in a future seed update
    // surfaces immediately at write time.
    tier: text('tier').notNull(),
    // Each market has a dominant currency that we record here for
    // the rare cross-currency observation (e.g. a Cardmarket EU
    // listing priced in GBP). `price_observation.observed_currency`
    // is the actual stored currency; this column is the *expected*
    // currency for sanity checks and the UI's "convert from this"
    // hint when no observation has loaded yet.
    defaultCurrency: text('default_currency').notNull(),
    region: text('region'),
    notes: text('notes'),
  },
  (table) => [check('market_tier_check', sql`${table.tier} IN ('primary', 'secondary')`)],
);

export type Market = typeof marketTable.$inferSelect;
export type NewMarket = typeof marketTable.$inferInsert;

export const priceObservationTable = pgTable(
  'price_observation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    printingId: uuid('printing_id')
      .notNull()
      .references(() => printingTable.id),
    // Free-form `text` rather than a CHECK enum: the canonical
    // grade-tier vocabulary lives in `context/data-model.md` §
    // "Grade tiers" (≈25 values across RAW / PSA / BGS / CGC /
    // OTHER_GRADED) and is expected to grow as new graders /
    // sub-tiers emerge. Validation happens at the adapter /
    // application layer, mirroring `card.rarity` and
    // `printing.variant_class` from `T-DL-SCHEMA-CARDS`.
    gradeTier: text('grade_tier').notNull(),
    market: text('market')
      .notNull()
      .references(() => marketTable.code),
    // Free-form provenance string — `'aggregator_<name>'`,
    // `'ebay_browse'`, `'ebay_marketplace_insights'`, etc. Not an
    // enum because we expect to onboard more sources over time
    // (Layer 3 Marketplace Insights post-launch, additional
    // aggregators if we change vendor).
    source: text('source').notNull(),
    // The upstream listing / quote id used to dedup repeated
    // ingestion. Nullable: aggregator quotes without a stable
    // upstream id leave this NULL (the adapter is expected to
    // synthesize a stable id of its own where it can). The UNIQUE
    // constraint below uses Postgres's default NULLS DISTINCT,
    // so NULL entries don't conflict with each other — adapters
    // that want stricter idempotency must populate the field.
    sourceListingId: text('source_listing_id'),
    // The three layers named in PROJECT.md § 13: `'sold'` (Layer 3
    // Marketplace Insights / aggregator-derived sold data),
    // `'active_listing'` (Layer 2 eBay Browse — asking prices, not
    // sales), `'aggregator_quote'` (Layer 1 aggregator-emitted
    // normalized prices). Pinned via CHECK so a future adapter
    // typo surfaces at write time.
    observationKind: text('observation_kind').notNull(),
    observedPrice: numeric('observed_price', { precision: 12, scale: 2 }).notNull(),
    // Source currency. Never null. Display-time conversion happens
    // via `fx_rate` lookup keyed on `observed_date`.
    observedCurrency: text('observed_currency').notNull(),
    shipping: numeric('shipping', { precision: 12, scale: 2 }),
    // 0..1 parser confidence. The rollup job filters to ≥ 0.7 by
    // default (`context/data-model.md` § "price_aggregate":
    // "exclude `parse_confidence < 0.7`"). Nullable because some
    // sources (e.g. an aggregator's already-curated quote) are
    // confidence-free by definition.
    parseConfidence: numeric('parse_confidence', { precision: 3, scale: 2 }),
    // The instant the upstream quote / sale was real. Used by the
    // composite hot-path index for "current price" lookups.
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    // The calendar date of `observed_at`. Stored separately so the
    // rollup job can window cleanly without timezone math, and so
    // the FX-rate join (`fx_rate.rate_date = observed_date`) is a
    // direct equality. Adapters set this from the source's local
    // listing / sale date when available; otherwise from
    // `(observed_at AT TIME ZONE 'UTC')::date`.
    observedDate: date('observed_date').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // Parser breadcrumbs — listing title, seller URL, raw JSON
    // payload from the upstream API. Debug-only; never surfaced to
    // clients (the table is service-role-only). Required by
    // `context/legal-and-brand.md` for kill-switch / takedown
    // response.
    rawMetadata: jsonb('raw_metadata'),
  },
  (table) => [
    check(
      'price_observation_observation_kind_check',
      sql`${table.observationKind} IN ('sold', 'active_listing', 'aggregator_quote')`,
    ),
    // Idempotent ingestion: same `(source, source_listing_id)`
    // upserts. Default NULLS DISTINCT — adapters that lack an
    // upstream id are responsible for synthesizing one if they
    // want dedup at the SQL layer.
    unique('price_observation_source_source_listing_id_unique').on(
      table.source,
      table.sourceListingId,
    ),
    // Hot path: "give me the latest observations for this
    // (printing, grade_tier, market)" — used by the rollup job
    // and by ad-hoc current-price lookups before the materialized
    // view is built. The DESC on `observed_at` matches the typical
    // ORDER BY observed_at DESC LIMIT N pattern.
    index('price_observation_printing_grade_market_observed_idx').on(
      table.printingId,
      table.gradeTier,
      table.market,
      table.observedAt.desc(),
    ),
    // Daily cron windows + FX-rate joins: the rollup job scans
    // `WHERE observed_date = $1` to compute that day's aggregate;
    // the display layer joins on `observed_date = fx_rate.rate_date`.
    index('price_observation_observed_date_idx').on(table.observedDate),
  ],
);

export type PriceObservation = typeof priceObservationTable.$inferSelect;
export type NewPriceObservation = typeof priceObservationTable.$inferInsert;
