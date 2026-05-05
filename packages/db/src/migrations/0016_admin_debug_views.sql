-- T-DL-ADMIN-DEBUG-SURFACES — Admin debug views.
--
-- Five hand-authored read-only views that expose pipeline-internal
-- debug signals to the `service_role` only. Closes Phase 1.
--
-- The views surface signals that exist today across the catalog
-- (`data_conflict`, `printing_image`, `printing`, `fx_rate`) plus the
-- `pg_stat_statements` extension. Without them, every debug session
-- has to re-author the same ad-hoc joins. They pair naturally with
-- the future admin web UI (Phase 4+); for v1 the consumption path
-- is `psql` plus `service_role`-keyed Postgres clients.
--
-- View set:
--
--   1. v_data_conflict_top
--      Top 100 rows from data_conflict, ordered by
--      `dispute_count DESC, last_seen_at DESC`. The headline view
--      for "what conflicts are recurring most often?". Bounded with
--      `LIMIT 100` so a `SELECT *` over the view is never paginated.
--
--   2. v_data_conflict_by_source
--      Per-source-per-field conflict counts. Built with
--      `jsonb_object_keys(sources)` to expand the resolver's
--      `sources` jsonb into rows. Filters out the `reason`
--      metadata key (the only non-source key the resolver writes
--      today; widen the filter if a future resolver adds more
--      metadata keys).
--
--   3. v_image_pipeline_coverage_gaps
--      Renamed from the stub's `v_image_pipeline_failures`: the
--      merged `printing_image` schema persists ONLY successful
--      transcodes (no error column), so the DB-only failure signal
--      is *absence* (no provenance row) or *no canonical chosen*
--      (`printing.image_small_url IS NULL`). This view surfaces
--      both. Failures-with-error-detail are tracked in the seed-run
--      JSON reports under `data-pipeline/scripts/output/` and are
--      out of scope here (would require a `printing_image_failure`
--      table — separate, larger task).
--
--   4. v_fx_rate_freshness
--      Per `(base_currency, quote_currency)` pair: max + min rate
--      date, gap days vs `CURRENT_DATE`, count over the last 30
--      days, and most recent `fetched_at`. The fastest "is FX
--      stale?" surface for the eventual display layer.
--
--   5. v_pg_stat_statements_top_queries
--      Top 50 normalized queries by `total_exec_time DESC`. Reads
--      from the Supabase-installed `extensions.pg_stat_statements`
--      view; the wrapper view in `public` is owned by `postgres`
--      (the migration runner) so service_role only needs SELECT
--      on the wrapper, not on the underlying extension table.
--
-- Access posture: service_role only. Mirrors
-- `data_conflict` (`0015_data_conflict_rls.sql`) and
-- `price_observation` (`0009_pricing_rls.sql` § price_observation).
-- Each view block ships:
--   REVOKE ALL ON public.<view> FROM PUBLIC;
--   GRANT SELECT ON public.<view> TO service_role;
-- Defense in depth: the REVOKE FROM PUBLIC drops Supabase's
-- project-init defaults (`ALTER DEFAULT PRIVILEGES … GRANT ALL`)
-- so the privilege snapshot matches the policy posture, and the
-- explicit GRANT to service_role is what unlocks the read path
-- (PostgREST checks SQL privileges before any policy layer).
--
-- Admin-role posture: local Supabase ships only the canonical four
-- roles (`anon`, `authenticated`, `postgres`, `service_role`); no
-- `admin` role exists. Whether to provision one for narrower
-- read-only debug access by humans is captured as Q-007 in
-- `open-questions.md` — not blocking; service_role is the v1 admin
-- posture.
--
-- pg_stat_statements caveat: the extension is enabled by default in
-- new Supabase projects (verified locally — installed in the
-- `extensions` schema, loaded via `shared_preload_libraries`). The
-- migration's `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA
-- extensions;` makes it a no-op when present and self-installs
-- otherwise. If a future Supabase project disables the extension,
-- the migration fails loudly at the CREATE EXTENSION step — easy to
-- diagnose, easy to recover (re-enable the extension out of band,
-- re-run the migration).
--
-- RLS posture: PostgreSQL does not support RLS on regular views
-- (RLS is "supported for tables" only per the PG 17 docs at
-- https://www.postgresql.org/docs/17/ddl-rowsecurity.html). Same
-- precedent as `mv_current_price` in `0013_mv_current_price.sql`:
-- the access posture is enforced by SQL grants alone. The
-- underlying tables' RLS still gates writes (no view writes here
-- — every view is read-only by construction) and reads of
-- service-role-only tables (`data_conflict`); `service_role`
-- BYPASSRLS, so it sees every underlying row.
--
-- Idempotency: every view is preceded by `DROP VIEW IF EXISTS …
-- CASCADE` so re-running the migration during local dev (after a
-- `supabase db reset`) succeeds. Production never re-runs an
-- applied migration. CASCADE is safe — nothing in the catalog
-- depends on these views; if a future task starts depending on
-- one, reviewers will notice in the PR.

-- =====================================================================
-- 0. Extension prerequisites
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
--> statement-breakpoint

-- =====================================================================
-- 1. v_data_conflict_top
-- =====================================================================
--
-- Top 100 conflict rows ordered by recurrence (`dispute_count`) and
-- recency (`last_seen_at`). The two existing indexes on
-- `data_conflict` (`data_conflict_dispute_count_idx`,
-- `data_conflict_last_seen_at_idx`) cover both keys, so the view's
-- ORDER BY rides existing storage.
--
-- `sources` is left as raw jsonb so an operator can drill into the
-- exact per-source values that disagreed; `kept_value` echoes the
-- resolver's choice. `resolution` carries the audit verb
-- (`kept_<source>` / `unresolved` / `manual_override`).

DROP VIEW IF EXISTS public.v_data_conflict_top CASCADE;
--> statement-breakpoint
CREATE VIEW public.v_data_conflict_top AS
SELECT
  entity_kind,
  entity_canonical_key,
  field_name,
  dispute_count,
  sources,
  kept_value,
  resolution,
  last_seen_at
FROM public.data_conflict
ORDER BY dispute_count DESC, last_seen_at DESC
LIMIT 100;
--> statement-breakpoint
REVOKE ALL ON public.v_data_conflict_top FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.v_data_conflict_top TO service_role;
--> statement-breakpoint

-- =====================================================================
-- 2. v_data_conflict_by_source
-- =====================================================================
--
-- Per-source-per-field rollup of conflicts. `jsonb_object_keys`
-- expands the `sources` jsonb (one row per (conflict, source-key))
-- so the GROUP BY can fan out by source. The `WHERE` filters the
-- resolver's `reason` metadata key — today the only non-source
-- key the resolver writes (per `data-pipeline/src/resolver/`).
-- Widen the filter if a future resolver adds more metadata keys
-- (e.g. `tolerance`, `quorum`, …); the migration header documents
-- the dependency.
--
-- Returns `conflict_count` (number of distinct (entity, field)
-- conflicts the source touched) plus `total_dispute_count` (sum of
-- `dispute_count`s — the aggregate "noise" each source generated).
-- Sorted by `total_dispute_count DESC` so the loudest sources
-- bubble up first.

DROP VIEW IF EXISTS public.v_data_conflict_by_source CASCADE;
--> statement-breakpoint
CREATE VIEW public.v_data_conflict_by_source AS
SELECT
  s.source_key                   AS source,
  c.field_name,
  COUNT(*)::bigint               AS conflict_count,
  SUM(c.dispute_count)::bigint   AS total_dispute_count
FROM   public.data_conflict c
CROSS JOIN LATERAL jsonb_object_keys(c.sources) AS s(source_key)
WHERE  s.source_key NOT IN ('reason')
GROUP  BY s.source_key, c.field_name
ORDER  BY total_dispute_count DESC, conflict_count DESC;
--> statement-breakpoint
REVOKE ALL ON public.v_data_conflict_by_source FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.v_data_conflict_by_source TO service_role;
--> statement-breakpoint

-- =====================================================================
-- 3. v_image_pipeline_coverage_gaps
-- =====================================================================
--
-- Printings whose image pipeline has not produced a usable
-- canonical image. Two failure modes covered:
--
--   (a) `printing.image_small_url IS NULL` — the seed-ingest job
--       never set the canonical R2 URL. Either the image fetch
--       failed (Q-005 cross-host bug, transient HTTP errors), or
--       the adapter did not emit an image URL at all
--       (TCGdex JP coverage gap, etc.).
--
--   (b) Provenance row count is 0 — `printing_image` has no row for
--       this printing across any source. Either no transcode
--       attempt succeeded, or the printing predates the image
--       pipeline.
--
-- The LATERAL aggregate joins once per printing, returning the
-- count + max-transcoded-at for every match in `printing_image`.
-- The `WHERE` keeps any printing that fails either gate.

DROP VIEW IF EXISTS public.v_image_pipeline_coverage_gaps CASCADE;
--> statement-breakpoint
CREATE VIEW public.v_image_pipeline_coverage_gaps AS
SELECT
  p.id                                            AS printing_id,
  p.variant_key,
  p.image_source_url,
  COALESCE(pi.provenance_row_count, 0)::bigint    AS provenance_row_count,
  (p.image_small_url IS NOT NULL)                 AS canonical_url_present,
  pi.last_provenance_at
FROM   public.printing p
LEFT   JOIN LATERAL (
  SELECT COUNT(*)            AS provenance_row_count,
         MAX(transcoded_at)  AS last_provenance_at
  FROM   public.printing_image pi2
  WHERE  pi2.printing_id = p.id
) pi ON TRUE
WHERE  p.image_small_url IS NULL
   OR  pi.provenance_row_count IS NULL
   OR  pi.provenance_row_count = 0;
--> statement-breakpoint
REVOKE ALL ON public.v_image_pipeline_coverage_gaps FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.v_image_pipeline_coverage_gaps TO service_role;
--> statement-breakpoint

-- =====================================================================
-- 4. v_fx_rate_freshness
-- =====================================================================
--
-- Per `(base_currency, quote_currency)` pair, surface the freshness
-- shape the future display layer (T-SP-PRICING-DISPLAY) and any
-- ops monitoring will care about:
--
--   - `rate_date_max` — most recent rate date for the pair.
--   - `rate_date_min` — first rate date for the pair (for
--     historical-coverage debugging).
--   - `gap_days` — `CURRENT_DATE - rate_date_max`. The headline
--     "is this stale?" number. T-DL-FX-RATES is daily, so any
--     `gap_days > 1` is suspect (allow 1 for timezone slop).
--   - `row_count_30d` — rows with `rate_date >= CURRENT_DATE - 30`.
--     Healthy pair has `row_count_30d ≈ 30`.
--   - `last_fetched_at` — when the last write happened (vs
--     `rate_date_max` which is the date the rate is FOR).
--
-- Sorted by `gap_days DESC` so stale pairs bubble up first.

DROP VIEW IF EXISTS public.v_fx_rate_freshness CASCADE;
--> statement-breakpoint
CREATE VIEW public.v_fx_rate_freshness AS
SELECT
  base_currency,
  quote_currency,
  MAX(rate_date)                                                  AS rate_date_max,
  MIN(rate_date)                                                  AS rate_date_min,
  (CURRENT_DATE - MAX(rate_date))::int                            AS gap_days,
  COUNT(*) FILTER (WHERE rate_date >= CURRENT_DATE - 30)::bigint  AS row_count_30d,
  MAX(fetched_at)                                                 AS last_fetched_at
FROM   public.fx_rate
GROUP  BY base_currency, quote_currency
ORDER  BY gap_days DESC, base_currency, quote_currency;
--> statement-breakpoint
REVOKE ALL ON public.v_fx_rate_freshness FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.v_fx_rate_freshness TO service_role;
--> statement-breakpoint

-- =====================================================================
-- 5. v_pg_stat_statements_top_queries
-- =====================================================================
--
-- Top 50 normalized queries by `total_exec_time DESC`. Reads from
-- `extensions.pg_stat_statements` — the Supabase-canonical schema.
-- Fully-qualifying the underlying reference makes the lookup
-- independent of `search_path`.
--
-- The view is owned by the migration runner (`postgres` locally;
-- the migration identity in production). PG 17 views default to
-- `security_invoker = false`, meaning underlying-table reads use
-- the view owner's privileges. service_role gets SELECT on the
-- wrapper view; the wrapper, owned by postgres, then reads
-- `extensions.pg_stat_statements` with postgres's privileges
-- (which include SELECT). No GRANT on the underlying extension
-- table is needed.
--
-- pg_stat_statements normalizes literals out of the `query`
-- column (`SELECT * FROM card WHERE id = $1` rather than the raw
-- value), so this view is safe to expose without leaking row
-- contents.
--
-- pg_stat_statements applies its own runtime privilege check on
-- `current_user`: only superusers and members of `pg_read_all_stats`
-- see the full `query` text for queries executed by *other* roles.
-- Queries executed by the calling role itself are always visible.
-- For service_role, that means: queries run by the data-pipeline /
-- edge functions (which all run as service_role) show full text;
-- queries run by `postgres` / `supabase_admin` / `authenticator`
-- show `<insufficient privilege>` instead. The stats columns
-- (calls / *_exec_time / rows / shared_blks_*) are always visible.
-- Granting `pg_read_all_stats` to service_role would lift the
-- restriction but requires ADMIN OPTION on that predefined role,
-- which Supabase does not delegate by default — surfacing the
-- restriction in this comment rather than working around it.
--
-- Columns picked match the most-useful subset of the
-- pg_stat_statements v1.11 schema; the full upstream view has
-- ~60 columns and most are JIT / WAL telemetry that an operator
-- never needs at first glance. If a future investigation wants
-- the full surface, query `extensions.pg_stat_statements`
-- directly via psql under the `postgres` user.

DROP VIEW IF EXISTS public.v_pg_stat_statements_top_queries CASCADE;
--> statement-breakpoint
CREATE VIEW public.v_pg_stat_statements_top_queries AS
SELECT
  queryid,
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time,
  rows,
  shared_blks_hit,
  shared_blks_read
FROM   extensions.pg_stat_statements
ORDER  BY total_exec_time DESC
LIMIT  50;
--> statement-breakpoint
REVOKE ALL ON public.v_pg_stat_statements_top_queries FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.v_pg_stat_statements_top_queries TO service_role;
