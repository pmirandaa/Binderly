-- T-DL-PRICING-CURRENT-VIEW — `mv_current_price` materialized view.
--
-- Caches the LATEST `price_aggregate` row per
-- `(printing_id, grade_tier, market, currency)` so the future
-- card-detail UI (T-SP-PRICING-DISPLAY) reads a single bounded row
-- per card / grade / market combo instead of a `DISTINCT ON` over
-- the growing `price_aggregate` table on every page render.
--
-- Hand-authored because Drizzle-kit does not model materialized
-- views; the file follows the same SQL-only convention as every
-- existing RLS migration in this repo (`0001` / `0003` / `0005` /
-- `0007` / `0009` / `0011` / `0012`).
--
-- Migration index `0013` follows the existing 0000–0012 sequence on
-- `main` (verified via `_journal.json` at task elaboration time).
--
-- ---------------------------------------------------------------------
-- 1. View definition
-- ---------------------------------------------------------------------
--
-- `DISTINCT ON (printing_id, grade_tier, market, currency)
--    ... ORDER BY ... period_start DESC` is the canonical Postgres
-- idiom for "keep the latest row per group key". The four-column
-- group key matches the prefix of `price_aggregate`'s composite PK
-- (`printing_id, grade_tier, market, currency, period_start`) so the
-- planner can use the PK index for the underlying scan.
--
-- Currency is part of the group key so the rare cross-currency
-- listing scenario the schema docstring calls out (e.g. a
-- CARDMARKET_EU listing priced in GBP rather than EUR) keeps both
-- rows distinct in the materialized view — same posture as
-- `price_aggregate` itself.
--
-- `WITH NO DATA` keeps the migration fast even when `price_aggregate`
-- already has rows. The runner from
-- `data-pipeline/src/jobs/pricing-current-view.ts` populates the
-- view via `REFRESH MATERIALIZED VIEW` (first run) or
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` (subsequent runs;
-- requires the unique index below). Documented in
-- `data-pipeline/README.md` § "Pricing current view".
--
-- v1 column set per the orchestrator's iter-9 dispatch — the latest
-- aggregate's `mean_price` / `median_price` / `low_price` /
-- `high_price` / `sample_count` plus `period_start` and
-- `computed_at` for freshness inspection. The richer
-- trends + freshness columns named in
-- `context/data-model.md` § `mv_current_price` (`current_price` as
-- 30-day median, `trend_30d_pct`, `trend_90d_pct`,
-- `trend_all_time_pct`, `sample_count_30d`, `last_observation_at`,
-- `freshness`) are deferred to a follow-up that pairs with
-- `T-SP-PRICING-DISPLAY` once the display layer's read patterns are
-- pinned. Surfaced as Q-006 in the elaborated task .md.

CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_current_price" AS
SELECT DISTINCT ON ("printing_id", "grade_tier", "market", "currency")
  "printing_id",
  "grade_tier",
  "market",
  "currency",
  "period_start",
  "median_price",
  "mean_price",
  "low_price",
  "high_price",
  "sample_count",
  "computed_at"
FROM "price_aggregate"
ORDER BY "printing_id", "grade_tier", "market", "currency", "period_start" DESC
WITH NO DATA;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 2. Indices
-- ---------------------------------------------------------------------
--
-- The UNIQUE index is REQUIRED for `REFRESH MATERIALIZED VIEW
-- CONCURRENTLY` per the PostgreSQL docs: "Concurrent refresh is
-- only supported on materialized views that have at least one
-- UNIQUE index that uses no WHERE clause and includes only column
-- names." The four-column group key matches the view's
-- DISTINCT ON / ORDER BY prefix, so the unique constraint is
-- guaranteed to hold by construction (one row per group).
--
-- The lookup index on `(printing_id)` accelerates the future
-- "give me every grade tier and market for this card" read path
-- the card-detail UI will use.

CREATE UNIQUE INDEX IF NOT EXISTS "mv_current_price_pk_idx"
  ON "mv_current_price" ("printing_id", "grade_tier", "market", "currency");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mv_current_price_printing_idx"
  ON "mv_current_price" ("printing_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 3. Access posture (REVOKE / GRANT — no RLS)
-- ---------------------------------------------------------------------
--
-- PostgreSQL 17 does NOT support `ALTER MATERIALIZED VIEW … ENABLE
-- ROW LEVEL SECURITY`. Verified against
-- https://www.postgresql.org/docs/17/sql-altermaterializedview.html
-- (no RLS in the action list) and
-- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
-- (RLS "supported for tables" only). Local Supabase ships PG 17 per
-- Q-003 in `open-questions.md`.
--
-- The defense-in-depth posture instead follows the pattern from
-- `0009_pricing_rls.sql` § "price_aggregate": revoke everything
-- from PUBLIC, then grant SELECT to the consumer roles
-- explicitly. PostgREST checks SQL privileges before any policy
-- layer, so the explicit GRANT is what actually unlocks the read
-- path; service_role's BYPASSRLS attribute does not bypass these
-- table-level grants either, hence the explicit grant for it too.
--
-- The underlying `price_aggregate` table is itself public-read
-- (see `0009_pricing_rls.sql` § "price_aggregate policies"), so
-- the materialized view caches public-read data with public-read
-- access — no row-level access disparity.
--
-- No INSERT / UPDATE / DELETE grants for any role: the view is
-- refreshable only by the migration owner (locally `postgres`
-- superuser; in hosted Supabase the migration runner identity).
-- Application code never writes to a materialized view; it only
-- reads.

REVOKE ALL ON "mv_current_price" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT
  ON "mv_current_price" TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "mv_current_price" TO service_role;
