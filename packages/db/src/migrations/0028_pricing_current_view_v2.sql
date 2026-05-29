-- T-DL-PRICING-CURRENT-VIEW-V2 (closes #FU-5) — enrich the
-- `mv_current_price` materialized view with the richer trend +
-- freshness shape promised by `context/data-model.md` §
-- `mv_current_price` (Q-006).
--
-- Background. The v1 view (migration `0013_mv_current_price.sql`)
-- caches the LATEST `price_aggregate` row per
-- `(printing_id, grade_tier, market, currency)` — the headline
-- median / mean / low / high / sample_count plus the `period_start`
-- and `computed_at` freshness breadcrumbs. The richer columns the
-- data-model doc names (`current_price` as a 30-day median, the
-- 30/90/all-time trend percentages, `sample_count_30d`, and a
-- last-observed timestamp) were deferred to "a follow-up that pairs
-- with T-SP-PRICING-DISPLAY once the display layer's read patterns
-- are pinned" — that follow-up is this migration.
--
-- Backward compatibility. PostgreSQL has no
-- `ALTER MATERIALIZED VIEW … ADD COLUMN`, so a column-shape change
-- requires DROP + CREATE. The recreation is strictly **additive**:
-- every v1 column is preserved in its original position and the new
-- enrichment columns are appended after them, so existing consumers
-- (the `GET /v1/printings/:id/current-price` Edge handler, the
-- `currentPriceDto` / `printingCurrentPriceDto` contracts, the
-- `@binderly/pricing-display` row helpers) keep reading the exact
-- same fields. No reader selects `*`; PostgREST projects by name, so
-- column order is cosmetic — kept additive for clarity all the same.
--
-- Hand-authored (Drizzle-kit does not model materialized views),
-- following the SQL-only convention of every other view / RLS
-- migration in this repo (`0013` / `0016` / `0018` / `0020`).
-- Migration index `0028` follows the existing 0000–0027 sequence on
-- `main` (verified via `_journal.json` at authoring time).
--
-- Refresh path is unchanged. `mv_current_price` is still refreshed by
-- `data-pipeline/src/jobs/pricing-current-view.ts` via
-- `REFRESH MATERIALIZED VIEW [CONCURRENTLY]`; that job only issues the
-- REFRESH verb and does not care about the column list, so no
-- pipeline change rides with this migration. The view is recreated
-- `WITH NO DATA`, so the next scheduled refresh repopulates it (the
-- first post-migration refresh uses the non-CONCURRENTLY form because
-- the freshly-created view is unpopulated — the runner already
-- detects this via `pg_class.relpages`).
--
-- ---------------------------------------------------------------------
-- 1. Drop the v1 view (and its dependent indexes) so it can be
--    recreated with the enriched column set.
-- ---------------------------------------------------------------------
--
-- `IF EXISTS` keeps the statement a no-op on a database that never had
-- the v1 view. No `CASCADE`: nothing in the schema depends on
-- `mv_current_price` (it is a leaf read surface — only application
-- code SELECTs from it, and the refresh job only REFRESHes it). The
-- DROP removes the v1 unique + lookup indexes and the v1 grants along
-- with the object; all three are recreated below.

DROP MATERIALIZED VIEW IF EXISTS "mv_current_price";
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 2. Recreate the view with the enriched column set.
-- ---------------------------------------------------------------------
--
-- The view is assembled from three CTEs over `price_aggregate`
-- (+ `price_observation` for the last-observed timestamp), all keyed
-- on the same `(printing_id, grade_tier, market, currency)` group key
-- as the v1 DISTINCT ON:
--
--   `latest`  — the v1 behaviour verbatim: the most recent aggregate
--               row per group key (`DISTINCT ON … ORDER BY
--               period_start DESC`). Supplies every preserved v1
--               column.
--
--   `trends`  — window stats computed by joining every aggregate row
--               for the group back to its `latest` row:
--                 * `current_price`      — the median of the last 30
--                   days of daily medians (data-model `current_price`;
--                   `percentile_cont(0.5)` over `median_price`, cast
--                   back to a 2dp numeric for wire parity since
--                   `percentile_cont` returns double precision).
--                 * `sample_count_30d`   — total samples observed in
--                   the trailing-30-day window.
--                 * `ref_30d` / `ref_90d`— the most recent daily median
--                   at or before the 30- / 90-day look-back cutoff,
--                   picked via `(array_agg(... ORDER BY period_start
--                   DESC) FILTER (...))[1]`. Used as the trend
--                   denominators.
--                 * `ref_all`            — the earliest daily median on
--                   record (all-time trend denominator).
--               All windows are anchored on the group's own
--               `latest.period_start`, not `now()`, so the view is
--               deterministic between refreshes and a stale slice does
--               not silently widen its own window.
--
--   `last_obs`— `MAX(observed_at)` per group from the raw
--               `price_observation` log (joined on
--               `observed_currency` = the aggregate `currency`). This
--               is the truest "last seen in the wild" timestamp; only
--               the aggregated MAX is materialised, never raw
--               observation rows, so the service-role-only posture of
--               `price_observation` is preserved (the view is computed
--               by the migration / refresh owner, and readers only see
--               the rolled-up MV rows). LEFT JOIN: a group with
--               aggregates but no surviving observation rows keeps a
--               NULL `last_observation_at` rather than dropping out.
--
-- Trend percentages are `ROUND((latest − ref) / ref * 100, 2)`,
-- guarded so a NULL or zero denominator yields NULL (no data / a
-- free card divide-by-zero) rather than erroring. `trend_direction`
-- buckets the 30-day trend into `up` / `down` / `flat` with a ±1%
-- dead-band (and `unknown` when the 30-day reference is absent), a
-- convenience for the UI's headline arrow that does not require the
-- client to re-implement the threshold.
--
-- `WITH NO DATA` keeps the migration fast; the refresh job
-- repopulates the view on its next run.

CREATE MATERIALIZED VIEW "mv_current_price" AS
WITH "latest" AS (
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
),
"trends" AS (
  SELECT
    "l"."printing_id",
    "l"."grade_tier",
    "l"."market",
    "l"."currency",
    ROUND(
      (
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "pa"."median_price")
          FILTER (
            WHERE "pa"."median_price" IS NOT NULL
              AND "pa"."period_start" > "l"."period_start" - 30
          )
      )::numeric,
      2
    ) AS "current_price",
    COALESCE(
      SUM("pa"."sample_count")
        FILTER (WHERE "pa"."period_start" > "l"."period_start" - 30),
      0
    )::integer AS "sample_count_30d",
    (
      ARRAY_AGG("pa"."median_price" ORDER BY "pa"."period_start" DESC)
        FILTER (
          WHERE "pa"."median_price" IS NOT NULL
            AND "pa"."period_start" <= "l"."period_start" - 30
        )
    )[1] AS "ref_30d",
    (
      ARRAY_AGG("pa"."median_price" ORDER BY "pa"."period_start" DESC)
        FILTER (
          WHERE "pa"."median_price" IS NOT NULL
            AND "pa"."period_start" <= "l"."period_start" - 90
        )
    )[1] AS "ref_90d",
    (
      ARRAY_AGG("pa"."median_price" ORDER BY "pa"."period_start" ASC)
        FILTER (WHERE "pa"."median_price" IS NOT NULL)
    )[1] AS "ref_all"
  FROM "latest" "l"
  JOIN "price_aggregate" "pa"
    ON "pa"."printing_id" = "l"."printing_id"
   AND "pa"."grade_tier" = "l"."grade_tier"
   AND "pa"."market" = "l"."market"
   AND "pa"."currency" = "l"."currency"
  GROUP BY "l"."printing_id", "l"."grade_tier", "l"."market", "l"."currency"
),
"last_obs" AS (
  SELECT
    "printing_id",
    "grade_tier",
    "market",
    "observed_currency" AS "currency",
    MAX("observed_at") AS "last_observation_at"
  FROM "price_observation"
  GROUP BY "printing_id", "grade_tier", "market", "observed_currency"
)
SELECT
  "l"."printing_id",
  "l"."grade_tier",
  "l"."market",
  "l"."currency",
  "l"."period_start",
  "l"."median_price",
  "l"."mean_price",
  "l"."low_price",
  "l"."high_price",
  "l"."sample_count",
  "l"."computed_at",
  -- additive enrichment columns (Q-006 / #FU-5):
  "t"."current_price",
  CASE
    WHEN "l"."median_price" IS NOT NULL AND "t"."ref_30d" IS NOT NULL AND "t"."ref_30d" <> 0
      THEN ROUND(("l"."median_price" - "t"."ref_30d") / "t"."ref_30d" * 100, 2)
  END AS "trend_30d_pct",
  CASE
    WHEN "l"."median_price" IS NOT NULL AND "t"."ref_90d" IS NOT NULL AND "t"."ref_90d" <> 0
      THEN ROUND(("l"."median_price" - "t"."ref_90d") / "t"."ref_90d" * 100, 2)
  END AS "trend_90d_pct",
  CASE
    WHEN "l"."median_price" IS NOT NULL AND "t"."ref_all" IS NOT NULL AND "t"."ref_all" <> 0
      THEN ROUND(("l"."median_price" - "t"."ref_all") / "t"."ref_all" * 100, 2)
  END AS "trend_all_time_pct",
  CASE
    WHEN "l"."median_price" IS NULL OR "t"."ref_30d" IS NULL OR "t"."ref_30d" = 0 THEN 'unknown'
    WHEN ("l"."median_price" - "t"."ref_30d") / "t"."ref_30d" * 100 >= 1 THEN 'up'
    WHEN ("l"."median_price" - "t"."ref_30d") / "t"."ref_30d" * 100 <= -1 THEN 'down'
    ELSE 'flat'
  END AS "trend_direction",
  "t"."sample_count_30d",
  "lo"."last_observation_at"
FROM "latest" "l"
JOIN "trends" "t"
  ON "t"."printing_id" = "l"."printing_id"
 AND "t"."grade_tier" = "l"."grade_tier"
 AND "t"."market" = "l"."market"
 AND "t"."currency" = "l"."currency"
LEFT JOIN "last_obs" "lo"
  ON "lo"."printing_id" = "l"."printing_id"
 AND "lo"."grade_tier" = "l"."grade_tier"
 AND "lo"."market" = "l"."market"
 AND "lo"."currency" = "l"."currency"
WITH NO DATA;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 3. Indices (recreated — same shape as v1).
-- ---------------------------------------------------------------------
--
-- The UNIQUE index is REQUIRED for `REFRESH MATERIALIZED VIEW
-- CONCURRENTLY`. The four-column group key matches the `latest`
-- DISTINCT ON / `trends` GROUP BY / `last_obs` GROUP BY keys, so
-- exactly one row exists per `(printing_id, grade_tier, market,
-- currency)` and the unique constraint holds by construction. The
-- lookup index on `(printing_id)` accelerates the card-detail
-- "every grade tier + market for this card" read path.

CREATE UNIQUE INDEX IF NOT EXISTS "mv_current_price_pk_idx"
  ON "mv_current_price" ("printing_id", "grade_tier", "market", "currency");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mv_current_price_printing_idx"
  ON "mv_current_price" ("printing_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- 4. Access posture (REVOKE / GRANT — no RLS).
-- ---------------------------------------------------------------------
--
-- PostgreSQL 17 does not support RLS on materialized views, so the
-- public-read posture is enforced by SQL grants alone (same shape
-- verify-rls asserts for the admin debug views). The view caches
-- public-read aggregate data (the underlying `price_aggregate` is
-- itself public-read per `0009_pricing_rls.sql`) plus a single
-- rolled-up `MAX(observed_at)` derived from the service-role-only
-- `price_observation` — the aggregate exposes no row-level observation
-- data, only the recency timestamp, so the public-read grant does not
-- widen the observation log's posture.
--
-- We REVOKE from the explicit roles (not just `PUBLIC`) before
-- granting SELECT. This is the lesson of #FU-28 / migration
-- `0020_revoke_admin_debug_view_grants.sql`: Supabase's project-init
-- runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
-- TO anon, authenticated, service_role` BEFORE any migration applies,
-- and PG's default-privileges machinery fires on `CREATE MATERIALIZED
-- VIEW`, so the freshly-created view ships with ALL per-role grants
-- baked in. A bare `REVOKE ALL ... FROM PUBLIC` strips only the PUBLIC
-- pseudo-role (NOT the union of all roles), leaving the explicit
-- `anon` / `authenticated` ALL grants intact — exactly the latent
-- posture the v1 `0013_mv_current_price.sql` carried despite its
-- "SELECT only" comment (verified: its `relacl` shows
-- `anon=arwdDxtm`). Because this is a read-only materialized view that
-- can't be written through PostgREST and is refreshed only by its
-- owner, the surplus grants were inert — but recreating the object is
-- the natural moment to make the posture match the documented intent.
-- The explicit per-role REVOKE + targeted SELECT GRANT below leaves
-- `anon` / `authenticated` / `service_role` with SELECT and nothing
-- else; `postgres` (the owner) retains full control for REFRESH.
-- SELECT is preserved for every reader, so this is backward-compatible
-- for existing consumers.

REVOKE ALL ON "mv_current_price" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT SELECT
  ON "mv_current_price" TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT
  ON "mv_current_price" TO service_role;
