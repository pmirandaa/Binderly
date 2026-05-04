# T-DL-SCHEMA-PRICING — DB schema for prices and snapshots (scaffolded, gated)

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** S
**Status:** pending

## Hard dependencies

- T-DL-SCHEMA-CARDS (provides the `printing` catalog table that every
  pricing row keys to via FK)

## Soft dependencies

- T-DL-SCHEMA-USERS, T-DL-SCHEMA-COLLECTIONS, T-DL-SCHEMA-GRADING
  (parallel-safe; no shared tables, no shared paths)

## Required reading

- `PROJECT.md` § 6 (Data Model) — the two-table-anchored pricing
  surface (raw `price_observation` + rolled-up `price_aggregate`)
  and the `mv_current_price` materialized view that downstream
  consumes.
- `PROJECT.md` § 13 (Pricing & Affiliate Strategy) — the
  market-segmented model (`EBAY_US` primary, `CARDMARKET_EU`
  secondary), grade-tier coverage, native-currency-storage rule
  ("convert at display time using the exchange rate of the
  observation's date"), and the three ingestion layers (aggregator
  Layer 1, eBay Browse Layer 2, Marketplace Insights Layer 3 post-
  launch). This is the normative product spec for the column
  shapes.
- `rules/01-data-layer.md` — RLS posture for catalog tables (public-
  read, service-role-write), idempotent-ingestion mandate, and the
  market-segmentation hard rule ("never average across markets").
- `context/data-model.md` § "Pricing tables" — the
  column-for-column reference for `market`, `price_observation`,
  `fx_rate`, `price_aggregate`, plus the grade-tier and market
  enums. This file is the source of truth for column names, types,
  defaults, and indexes.
- `context/conventions.md` — TS / SQL / migration conventions
  (snake_case tables, `<X>Table` Drizzle binding, `$inferSelect` /
  `$inferInsert` exports, RLS in own migration).
- `context/legal-and-brand.md` — pricing-source ToS notes (no
  TCGplayer scraping, eBay Browse / Cardmarket-via-aggregator
  policy). Schema must accommodate `source` provenance for kill-
  switch / takedown response.
- **Merged code from `T-DL-SCHEMA-CARDS`** —
  `packages/db/src/schema/sets.ts`, `cards.ts`, `printings.ts`;
  `packages/db/src/migrations/0002_catalog_tables.sql`,
  `0003_catalog_rls.sql`. Match the catalog-RLS pattern
  (anon + authenticated SELECT, REVOKE permissive default writes,
  GRANT to service_role) for the consumer-facing pricing tables.
- **Sibling reference (GRADING)** —
  `packages/db/src/schema/grading.ts`;
  `packages/db/src/migrations/0006_grading_tables.sql`,
  `0007_grading_rls.sql`. Match the service-role-only pattern
  (`grading_training_sample`) for `price_observation`, which is
  raw-pipeline-internal data not intended for direct client reads.

## Goal

Define the Drizzle schema for the four base pricing tables that the
rest of the pricing pipeline (aggregator adapter, eBay Browse adapter,
daily rollup, FX-rate cron, current-price view, and the display
package) all key to. Pablo's spec mandates a market-segmented,
native-currency-stored, append-only raw observation log + a daily
rolled-up aggregate keyed by `(printing, grade_tier, market, currency,
day)`. Two tables ship the consumer-facing surface (`market` catalog,
`price_aggregate` daily rollup) and two ship the pipeline-internal
surface (`price_observation` raw signal, `fx_rate` daily exchange
rates). All four fit inside the two owned schema files
(`prices.ts` for the live pricing surface, `price_snapshots.ts` for
the daily-snapshot surface — `price_aggregate` and `fx_rate` are both
day-keyed snapshots that downstream rollup / display jobs consume).
RLS is wired up inline (mirroring CARDS / GRADING precedent — RLS in
its own migration) so the consumer-facing tables (`market`,
`price_aggregate`, `fx_rate`) are public-read / service-role-write
and the pipeline-internal table (`price_observation`) is service-role-
only. The `mv_current_price` materialized view is **deferred** to
T-DL-PRICING-CURRENT-VIEW (per its existing `owns_paths` allocation
of `packages/db/src/views/`); this task ships only the base tables
and indexes that view will rely on.

## Deliverables

- `packages/db/src/schema/prices.ts` — Drizzle schema file exporting
  two tables:
  - `marketTable` (`market`) — small catalog table seeded with the
    canonical market codes (`EBAY_US`, `EBAY_DE`, `EBAY_UK`,
    `EBAY_JP`, `CARDMARKET_EU`, `TCGPLAYER_DERIVED`, `OTHER`).
    Columns per `context/data-model.md` § "market": `code` (text PK),
    `display_name` (text NOT NULL), `tier` (text NOT NULL with check
    `IN ('primary', 'secondary')`), `default_currency` (text NOT NULL),
    `region` (text), `notes` (text). Seed data inserted in the RLS
    migration (idempotent INSERT … ON CONFLICT DO NOTHING).
  - `priceObservationTable` (`price_observation`) — append-only raw
    signal. Columns per `context/data-model.md` §
    "price_observation": `id uuid PK gen_random_uuid()`,
    `printing_id uuid NOT NULL REFERENCES printing(id)` (no cascade —
    catalog rows are effectively immutable post-ingest, but we
    surface dependent observations on the rare day a printing is
    consolidated, matching the `collection_item` → `printing` posture),
    `grade_tier text NOT NULL` (free-form `text` per data-model.md
    convention; the canonical enum is documented in
    `context/data-model.md` § "Grade tiers" and validated at the
    application/aggregator layer rather than as a CHECK constraint —
    the enum is expected to evolve as new graders are added),
    `market text NOT NULL REFERENCES market(code)`,
    `source text NOT NULL` (free-form: `'aggregator_<name>'`,
    `'ebay_browse'`, `'ebay_marketplace_insights'`, etc.),
    `source_listing_id text` (nullable; combined with `source` it
    forms a UNIQUE for idempotent re-ingestion),
    `observation_kind text NOT NULL` with check `IN ('sold',
    'active_listing', 'aggregator_quote')`,
    `observed_price numeric(12,2) NOT NULL`,
    `observed_currency text NOT NULL`,
    `shipping numeric(12,2)`,
    `parse_confidence numeric(3,2)`,
    `observed_at timestamptz NOT NULL`,
    `observed_date date NOT NULL`,
    `ingested_at timestamptz NOT NULL DEFAULT now()`,
    `raw_metadata jsonb`. Indexes: composite
    `(printing_id, grade_tier, market, observed_at desc)` for
    current-price lookup + rollup join, `(observed_date)` for daily
    cron windows + FX-rate joins, and a UNIQUE on
    `(source, source_listing_id)` for idempotent ingestion (default
    NULLS DISTINCT — quotes without a listing id are intentionally
    not deduped at this layer; the aggregator job emits its own
    quote ids when no upstream id exists).
  - Both tables export `$inferSelect` / `$inferInsert` type aliases
    (`Market`, `NewMarket`, `PriceObservation`, `NewPriceObservation`).
- `packages/db/src/schema/price_snapshots.ts` — Drizzle schema file
  exporting two tables. Both are "daily snapshot" surfaces consumed
  by the display layer and downstream cron jobs.
  - `priceAggregateTable` (`price_aggregate`) — daily rolled-up
    summary, keyed by `(printing_id, grade_tier, market, currency,
    period_start)` (composite PK, no surrogate `id`). Columns per
    `context/data-model.md` § "price_aggregate":
    `printing_id uuid NOT NULL REFERENCES printing(id)`,
    `grade_tier text NOT NULL`,
    `market text NOT NULL REFERENCES market(code)`,
    `currency text NOT NULL` (group key; never lost),
    `period_start date NOT NULL` (inclusive),
    `period_end date NOT NULL` (inclusive; equals `period_start` for
    daily rollups but the column is kept distinct so the rollup job
    can collapse to weekly / monthly later without a schema
    migration),
    `median_price numeric(12,2)`, `mean_price numeric(12,2)`,
    `low_price numeric(12,2)`, `high_price numeric(12,2)` (all
    nullable — a row may exist with `sample_count = 0` after
    outlier filtering),
    `sample_count integer NOT NULL`,
    `source_breakdown jsonb NOT NULL` (e.g.
    `{"ebay_browse": 12, "aggregator_x": 1}`),
    `observation_kind_breakdown jsonb NOT NULL` (e.g.
    `{"sold": 8, "active_listing": 4, "aggregator_quote": 1}`),
    `computed_at timestamptz NOT NULL`. The PK doubles as the
    primary lookup index (the leading prefix
    `(printing_id, grade_tier, market)` answers the headline-price
    query in `mv_current_price`). No additional indexes: the
    materialized view (T-DL-PRICING-CURRENT-VIEW) is the fast-path
    for current-price lookups; ad-hoc cross-printing scans are not
    a Phase-1 query pattern.
  - `fxRateTable` (`fx_rate`) — daily FX rates. Composite PK
    `(rate_date, base_currency, quote_currency)`. Columns per
    `context/data-model.md` § "fx_rate":
    `rate_date date NOT NULL`,
    `base_currency text NOT NULL` (always `'USD'` for v1,
    documented for future flexibility),
    `quote_currency text NOT NULL`,
    `rate numeric(14,6) NOT NULL`,
    `fetched_at timestamptz NOT NULL`,
    `source text NOT NULL` (e.g. `'frankfurter'`, `'ecb'`,
    `'openexchangerates'`). Index: `(rate_date desc, quote_currency)`
    for the common forward-lookup pattern (the display package looks
    up "rate of observed_date for currency X").
  - Both tables export `$inferSelect` / `$inferInsert` type aliases
    (`PriceAggregate`, `NewPriceAggregate`, `FxRate`, `NewFxRate`).
- `packages/db/src/schema/index.ts` — uncomment **only** the two
  pre-staged lines in the `T-DL-SCHEMA-PRICING` section
  (`export * from './prices.js';` and
  `export * from './price_snapshots.js';`). Do not edit other
  sections; do not remove the trailing `export {};` placeholder.
- `packages/db/src/migrations/<NNNN>_pricing_tables.sql` — drizzle-
  kit-generated migration for the four tables, their indexes (the
  composite + per-day on `price_observation`, the FX-rate forward
  lookup), the in-public FKs to `printing(id)` and `market(code)`,
  the check constraints, and the unique constraint on
  `price_observation(source, source_listing_id)`. Filename number is
  whatever drizzle-kit picks next (current journal: 0000–0007;
  expected `0008`). Renamed to a clean `_pricing_tables` codename
  via `--name` if drizzle-kit's autoname is silly.
- `packages/db/src/migrations/<NNNN+1>_pricing_rls.sql` — hand-
  authored migration. Three concerns, bundled per the
  `0001_users_rls.sql` / `0007_grading_rls.sql` precedent (no
  separate seed migration to keep the journal compact for a
  scaffolded-and-gated table set):
  1. **Market seed data.** Idempotent
     `INSERT INTO "market" (...) VALUES (...) ON CONFLICT (code) DO
     NOTHING` for the seven canonical market codes. The seed lands
     here rather than in a runtime job because (a) the `market`
     enum is part of the schema contract referenced by every
     `price_observation` / `price_aggregate` insert, and (b)
     `data-model.md` § "market" explicitly says "Seed data inserted
     in the schema migration".
  2. **No cross-schema FK.** Pricing tables have no `user_id`
     column — pricing data is sourced from third-party APIs, not
     user activity — so there is nothing to wire up against
     `auth.users`.
  3. **Row Level Security.** Mirrors `context/data-model.md` § "RLS
     policies" ("Catalog tables (`set`, `card`, `printing`, `price`,
     `price_snapshot`) are public-read, service-role-write") plus
     the `rules/01-data-layer.md` hard rule ("Catalog tables are
     write-protected to clients. Only the service role and the
     data-pipeline can write `set`, `card`, `printing`, `price`,
     `price_snapshot`").
     - `market`, `price_aggregate`, `fx_rate`: ENABLE ROW LEVEL
       SECURITY; CREATE POLICY `<table>_public_read` FOR SELECT TO
       `anon, authenticated` USING (true). REVOKE permissive
       Supabase-default write grants from `anon, authenticated`,
       GRANT SELECT to `anon, authenticated`, GRANT full DML to
       `service_role`. Mirrors the catalog-RLS pattern in
       `0003_catalog_rls.sql`.
     - `price_observation`: ENABLE ROW LEVEL SECURITY with **no
       permissive policies** for `anon` or `authenticated`. REVOKE
       all DML from `anon, authenticated`; GRANT full DML to
       `service_role`. Pipeline-internal data; clients consume
       aggregates / the materialized view, not raw observations.
       Mirrors the `grading_training_sample` posture in
       `0007_grading_rls.sql`.
     - Idempotent: `DROP POLICY IF EXISTS … / CREATE POLICY` and
       `INSERT … ON CONFLICT DO NOTHING` guards as appropriate.
- `packages/db/src/migrations/meta/_journal.json` — append two
  entries (one for the drizzle-generated table migration, one for
  the hand-authored RLS + seed migration). Drizzle's generate step
  writes the table-migration entry automatically; the RLS entry is
  appended by hand using the existing
  `{ idx, version, when, tag, breakpoints }` shape (matches
  GRADING's precedent).

## Acceptance criteria

- [ ] **AC-1.** Drizzle-generated migration applies cleanly to a
      fresh local Supabase Postgres (`pnpm db:reset` →
      `pnpm --filter @binderly/db db:migrate` exits 0; all four
      pricing tables — `market`, `price_observation`,
      `price_aggregate`, `fx_rate` — appear in `\dt public.*`).
      Verified against the local Supabase CLI Postgres on
      `:54322` (DB URL
      `postgresql://postgres:postgres@localhost:54322/postgres`).
- [ ] **AC-2.** Hand-authored RLS migration applies idempotently.
      After the first run RLS is enabled on every pricing table
      (`SELECT relrowsecurity FROM pg_class WHERE relname IN
      ('market','price_observation','price_aggregate','fx_rate')`
      returns `t,t,t,t`); re-running `db:migrate` against the
      already-migrated DB does not duplicate policies
      (`pg_policies` row count for each table is unchanged) and
      does not duplicate seed rows (`SELECT count(*) FROM market`
      remains 7).
- [ ] **AC-3.** `market` is seeded with the seven canonical codes
      (`EBAY_US`, `EBAY_DE`, `EBAY_UK`, `EBAY_JP`, `CARDMARKET_EU`,
      `TCGPLAYER_DERIVED`, `OTHER`) and `tier` CHECK constraint
      rejects values outside `{primary, secondary}`. Verified by
      `SELECT code, tier, default_currency FROM market ORDER BY
      tier DESC, code` and a deliberate INSERT with
      `tier = 'tertiary'` that fails with
      `violates check constraint "market_tier_check"`.
- [ ] **AC-4.** `price_observation` constraints:
      - `printing_id` FK to `public.printing(id)` rejects
        fabricated UUIDs.
      - `market` FK to `market(code)` rejects fabricated codes
        (e.g. `'EBAY_NEVERLAND'`).
      - `observation_kind` CHECK rejects values outside
        `{sold, active_listing, aggregator_quote}`.
      - `(source, source_listing_id)` UNIQUE rejects duplicate
        ingestion of a listing-bearing observation; observations
        with `source_listing_id IS NULL` are not constrained
        (NULLS DISTINCT default).
- [ ] **AC-5.** `price_aggregate` constraints:
      - Composite PK `(printing_id, grade_tier, market, currency,
        period_start)` rejects duplicate inserts under the same
        key.
      - FKs to `printing(id)` and `market(code)` reject fabricated
        references.
- [ ] **AC-6.** `fx_rate` constraints:
      - Composite PK `(rate_date, base_currency, quote_currency)`
        rejects duplicate inserts under the same key.
- [ ] **AC-7.** RLS posture verified live with `SET LOCAL ROLE`:
      - As `anon`: SELECT on `market`, `price_aggregate`,
        `fx_rate` returns rows (public-read). SELECT on
        `price_observation` is denied (no policy + REVOKE).
      - As `authenticated` (with `request.jwt.claims` set): same
        as `anon` for the read tables; same denial for
        `price_observation`.
      - As `anon` / `authenticated`: INSERT / UPDATE / DELETE on
        any pricing table is denied (no policy + REVOKE).
      - As `service_role`: full DML on all four tables (BYPASSRLS).
- [ ] **AC-8.** PROJECT.md § 13 product requirements reflected in
      column choices:
      - Market segmentation: `market` is FK on every observation /
        aggregate row, never collapsed into another column.
      - Native currency storage: `observed_currency` (NOT NULL on
        `price_observation`) and `currency` (NOT NULL on
        `price_aggregate`) are mandatory; no FX conversion column
        on either table.
      - Grade-tier coverage: `grade_tier` is `NOT NULL` on every
        observation / aggregate row.
      - Source provenance: `source` is `NOT NULL`; `raw_metadata`
        carries debug / kill-switch fields (title, seller URL).
      - Observation kind: `observation_kind` enum covers `sold` /
        `active_listing` / `aggregator_quote` (the three layers
        named in PROJECT.md § 13).
      - Idempotent ingestion: `(source, source_listing_id)`
        UNIQUE is the upsert key.
      - Per-day FX lookup: `observed_date` exists on every
        observation row to join `fx_rate.rate_date` at display
        time.
- [ ] **AC-9.** Indexes for the documented query patterns are in
      place (verified via `\d+ <table>`):
      - `price_observation`: composite
        `(printing_id, grade_tier, market, observed_at desc)` and
        `(observed_date)`.
      - `fx_rate`: `(rate_date desc, quote_currency)`.
      - `price_aggregate`: PK `(printing_id, grade_tier, market,
        currency, period_start)` is the only index (covers the
        canonical lookup; T-DL-PRICING-CURRENT-VIEW will add the
        materialized view that powers the headline-price hot path).
- [ ] **AC-10.** No file modified outside `owns_paths` plus the
      pre-staged uncomment lines in
      `packages/db/src/schema/index.ts` (`T-DL-SCHEMA-PRICING`
      section). `git diff --stat` against `main` shows only:
      - `packages/db/src/schema/prices.ts` (new)
      - `packages/db/src/schema/price_snapshots.ts` (new)
      - `packages/db/src/schema/index.ts` (2-line uncomment in the
        designated section)
      - `packages/db/src/migrations/<NNNN>_pricing_tables.sql`
        (new)
      - `packages/db/src/migrations/<NNNN+1>_pricing_rls.sql`
        (new)
      - `packages/db/src/migrations/meta/_journal.json` (entries
        appended; existing entries unchanged)
      - `packages/db/src/migrations/meta/<NNNN>_snapshot.json`
        (new, auto-generated by drizzle-kit)
      - `tasks/01-data-layer/T-DL-SCHEMA-PRICING.md` (the
        elaboration commit; not part of the implementation diff)
- [ ] **AC-11.** `pnpm --filter @binderly/db build typecheck lint
      format:check` exits 0.

## Out of scope

- The `mv_current_price` materialized view and its nightly refresh
  job. Owned by **T-DL-PRICING-CURRENT-VIEW** (which already has
  `packages/db/src/views/` in its `owns_paths`). This task ships
  the four base tables it consumes; the view itself is gated on
  the rollup job (`T-DL-PRICING-ROLLUP`) actually populating
  `price_aggregate`, which is downstream of this task.
- The pricing aggregator adapter (T-DL-PRICING-AGGREGATOR), the
  eBay Browse adapter (T-DL-PRICING-EBAY-BROWSE), the listing
  parser (T-DL-EBAY-LISTING-PARSER), the daily rollup
  (T-DL-PRICING-ROLLUP), and the FX-rate cron (T-DL-FX-RATES) —
  all stage-01 follow-ups; this task only ships their schema
  surface.
- The display package (`packages/pricing-display` /
  T-SP-PRICING-DISPLAY) — it consumes `fx_rate` + `price_aggregate`
  at render time; not in scope here.
- Fixture builders (`packages/db/src/fixtures/pricing.ts`) and
  round-trip tests. Mirrors the CARDS / GRADING / USERS deferral:
  a fixture task lands once **T-DL-DB-TEST-INFRA** introduces a
  vitest config for `@binderly/db`. The `$inferSelect` /
  `$inferInsert` exports are in place so the fixture task has
  typed builders out of the box.
- Partitioning `price_observation` by month. Documented in
  `context/data-model.md` § "price_observation" as a 12-month
  follow-up ("Partition by `observed_at` month after 12 months
  of data; not in MVP"). No-op for this task.
- A grade-tier CHECK constraint on `price_observation.grade_tier`
  / `price_aggregate.grade_tier`. The canonical enum is in
  `context/data-model.md` § "Grade tiers" (≈25 values across
  RAW / PSA / BGS / CGC / OTHER_GRADED). The data-model.md
  pricing-table reference deliberately stores `grade_tier` as
  free-form `text`; mirroring `card.rarity` / `printing.variant_class`
  (both free-form `text` per CARDS' precedent) it is validated at
  the application/aggregator layer, not as a CHECK constraint, so
  the enum can grow as new grading companies / sub-tiers emerge
  without a schema migration.
- Adding pricing-table rows to the remaining-table scope of
  T-DL-RLS-POLICIES. RLS for the pricing surface ships inline here
  (per CARDS / GRADING precedent). T-DL-RLS-POLICIES inherits a
  tighter scope: admin-only surfaces (`data_conflict`),
  `card_report`, audit logs.

## Branch & PR

- Branch: `agent/T-DL-SCHEMA-PRICING`
- PR title: `T-DL-SCHEMA-PRICING: Pricing schemas (scaffolded, gated)`
- Commit format: Conventional Commits.
  - Elaboration: `docs(tasks): elaborate T-DL-SCHEMA-PRICING`
  - Implementation: `feat(db): pricing schemas (T-DL-SCHEMA-PRICING)`

## Escalation triggers

Stop and surface to the orchestrator (append to `open-questions.md`)
if:

- PROJECT.md § 13 turns out to require column shapes that
  `context/data-model.md` § "Pricing tables" doesn't enumerate
  (e.g. per-listing seller-rating field, region-segmented sub-
  market within `EBAY_US`, sale-vs-listing distinction beyond the
  `observation_kind` enum) — needs Pablo to nail down the columns
  before committing them.
- The schema would benefit from `numeric(*)` precision other than
  what `data-model.md` specifies (e.g. integer cents vs
  `numeric(12,2)`). Spec is `numeric(12,2)`; flagging if the
  implementing agent thinks otherwise.
- The schema implies a materialized view (`mv_current_price`)
  that should be in this task's `owns_paths` — propose adding to
  the orchestrator before implementing.
  T-DL-PRICING-CURRENT-VIEW exists for the view; this task should
  not pre-empt it.
- Docker / Supabase Postgres unavailable for live AC verification
  — flag the deferred ACs to the orchestrator (iter-1 pattern:
  orchestrator hands Pablo a smoke test in the PR review).
- The work as scoped requires touching paths outside `owns_paths`
  (other than the pre-staged uncomment in
  `packages/db/src/schema/index.ts` and the migration / journal
  / snapshot files all schema tasks necessarily emit).

## Notes from execution
_(empty until the sub-agent runs)_
