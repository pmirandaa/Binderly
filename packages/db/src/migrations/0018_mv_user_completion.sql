-- T-BE-Q013-CLEANUP / Surface 1 (`T-DL-MV-COMPLETION`, #FU-26).
--
-- Land the two completion materialized views promised in
-- `PROJECT.md` § 8 and previously deferred by T-BE-EDGE-FUNCTIONS-V2
-- (`open-questions.md` § Q-013). The completion Edge handler swaps
-- from the on-the-fly canonical-table fan-out (one SELECT per
-- `collection_item` / `card` / `printing` / `set`) to two SELECTs
-- against the wrapper views this migration ships:
--
--   `v_my_set_completion`     — per-set, owner-scoped by `auth.uid()`
--   `v_my_global_completion`  — global, owner-scoped by `auth.uid()`
--
-- Hand-authored because Drizzle-kit does not model materialized
-- views; the file follows the same SQL-only convention as
-- `0013_mv_current_price.sql` (the one prior MV migration) and
-- `0017_profile_provisioning_trigger.sql` (the one prior
-- SECURITY DEFINER migration).
--
-- Migration index `0018` follows the existing 0000–0017 sequence on
-- `main` (verified via `_journal.json` at task elaboration time).
--
-- =====================================================================
-- Why two MVs, not one
-- =====================================================================
--
-- `mv_user_set_completion` keys on `(user_id, set_id)` for the home
-- screen's per-set list. `mv_user_global_completion` keys on
-- `(user_id)` for the home screen's headline "All Pokémon" + "Master"
-- aggregates. Both could be derived from the per-set view at query
-- time (a SUM(owned_unique)/SUM(total_unique) rollup), but
-- materialising both saves the home-screen render from a
-- catalog-scale aggregate on every page hit. Each user has at most
-- one global row (vs ~100 per-set rows), so the storage cost is
-- negligible.
--
-- =====================================================================
-- Why wrapper views, not pg_policy RLS
-- =====================================================================
--
-- Postgres 17 does NOT support `ALTER MATERIALIZED VIEW … ENABLE ROW
-- LEVEL SECURITY` (documented in `0013_mv_current_price.sql`'s
-- header). The brief's "Hand-authored RLS so authed users read only
-- their own rows" bullet therefore needs a different mechanism than
-- pg_policy rows. The chosen posture:
--
--   - REVOKE everything on the MVs from PUBLIC; GRANT SELECT only
--     to `service_role` (which has BYPASSRLS anyway). Authenticated
--     end users cannot read the MVs directly.
--   - Expose user-scoped data via a regular VIEW that filters by
--     `auth.uid()`. The view runs with its owner's (postgres /
--     migration runner) privileges by default, so it can read the
--     MV even though the calling role cannot. GRANT SELECT on the
--     view to `authenticated`.
--   - `security_barrier = true` on the view prevents leakage via
--     qual-reordering tricks where a malicious predicate would
--     run BEFORE the `user_id = auth.uid()` filter and observe
--     other-user rows.
--   - The wrapper view's qualifying clause uses
--     `(SELECT auth.uid())` rather than `auth.uid()` directly so
--     the planner evaluates it once per query and uses it as a
--     stable scalar — that's what makes the `(user_id, set_id)`
--     unique index seek-able for the filter.
--
-- The guarantee delivered is byte-for-byte equivalent to RLS: an
-- `authenticated` caller can only ever read rows where
-- `user_id = auth.uid()`. The mechanism is different (view qual
-- instead of pg_policy entry), so `verify-rls` does not need a new
-- assertion for the MVs — the structural posture is asserted by
-- the REVOKE / GRANT trio on the MVs + the view, same shape as
-- `mv_current_price` from 0013.
--
-- =====================================================================
-- Refresh strategy — synchronous CONCURRENTLY from the Edge handler
-- =====================================================================
--
-- The collection-mutation Edge handlers (`POST /v1/me/collection`,
-- `PATCH /v1/me/collection/:id`, `DELETE /v1/me/collection/:id`,
-- `POST /v1/me/collection/bulk`) call
-- `supabase.rpc('refresh_user_completion')` after each mutation. The
-- RPC body is two `REFRESH MATERIALIZED VIEW CONCURRENTLY` statements,
-- one per MV. CONCURRENTLY requires a UNIQUE index that uses no
-- WHERE clause and includes only column names (per the PG docs);
-- the two indexes defined below satisfy that.
--
-- Tradeoffs:
--
--   - Refresh is whole-MV, not per-user. PG 17 has no per-row
--     refresh mode. At v1 scale (~10k MV rows total across both
--     views) the refresh stays under a second.
--   - Refresh is synchronous from the handler's POV but
--     best-effort: a refresh failure is logged via the request
--     id and does NOT change the mutation's HTTP response. The
--     next read sees the change on the next refresh.
--   - If the catalog grows and refresh times become problematic,
--     the next move is `pg_cron` every 30s + a handler-side no-op
--     for the refresh call. The refresh function stays in place;
--     only its caller changes.

-- =====================================================================
-- 1. mv_user_set_completion
-- =====================================================================
--
-- One row per (user, set) pair where the user has at least one
-- `collection_item` in that set. The catalog union (sets the user has
-- ZERO progress in) is handled at the Edge handler layer to keep the
-- MV's row count bounded by the number of distinct (user, set) pairs
-- touched by users, not the cross-product of (users × sets).
--
-- Columns mirror `PROJECT.md` § 8:
--   - owned_unique / total_unique = distinct cards owned vs total
--     cards in the set (the "Set %" numerator/denominator).
--   - owned_master / total_master = printings owned in the master-set
--     vs total master-set printings (the "Master %" numerator/
--     denominator). Distinct on printing.id so multiple collection_item
--     rows for the same printing (different conditions/grades) count
--     once.
--   - set_pct / master_pct = the pre-computed percentages, capped at
--     [0, 100] by the math (CASE WHEN total = 0 THEN 0 ELSE ...). The
--     handler returns these directly without a second compute pass.

CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_user_set_completion" AS
SELECT
  "ci"."user_id"                                    AS "user_id",
  "s"."id"                                          AS "set_id",
  "s"."code"                                        AS "set_code",
  "s"."name"                                        AS "set_name",
  COUNT(DISTINCT "c"."id")::int                     AS "owned_unique",
  COALESCE("t"."total_unique", 0)::int              AS "total_unique",
  COUNT(DISTINCT "p"."id") FILTER (
    WHERE "p"."include_in_master_set"
  )::int                                            AS "owned_master",
  COALESCE("t"."total_master", 0)::int              AS "total_master",
  CASE
    WHEN COALESCE("t"."total_unique", 0) = 0 THEN 0::numeric
    ELSE (COUNT(DISTINCT "c"."id")::numeric * 100) / "t"."total_unique"
  END                                               AS "set_pct",
  CASE
    WHEN COALESCE("t"."total_master", 0) = 0 THEN 0::numeric
    ELSE (
      COUNT(DISTINCT "p"."id") FILTER (
        WHERE "p"."include_in_master_set"
      )::numeric * 100
    ) / "t"."total_master"
  END                                               AS "master_pct"
FROM "collection_item" AS "ci"
JOIN "printing" AS "p" ON "p"."id" = "ci"."printing_id"
JOIN "card" AS "c" ON "c"."id" = "p"."card_id"
JOIN "set" AS "s" ON "s"."id" = "c"."set_id"
JOIN LATERAL (
  SELECT
    COUNT(DISTINCT "c2"."id")::int                  AS "total_unique",
    COUNT(DISTINCT "p2"."id") FILTER (
      WHERE "p2"."include_in_master_set"
    )::int                                          AS "total_master"
  FROM "card" AS "c2"
  LEFT JOIN "printing" AS "p2" ON "p2"."card_id" = "c2"."id"
  WHERE "c2"."set_id" = "s"."id"
) AS "t" ON true
GROUP BY
  "ci"."user_id",
  "s"."id",
  "s"."code",
  "s"."name",
  "t"."total_unique",
  "t"."total_master"
WITH NO DATA;
--> statement-breakpoint

-- =====================================================================
-- 2. mv_user_global_completion
-- =====================================================================
--
-- One row per user with at least one `collection_item`. Columns:
--   - unique_cards_owned / total_cards = distinct cards owned across
--     all sets vs the total catalog card count (the "All Pokémon %"
--     numerator/denominator).
--   - master_owned / master_total = master-set printings owned vs
--     master-set printings total (the global "Master %" numerator/
--     denominator).
--   - all_pokemon_pct / master_pct = the pre-computed percentages,
--     same math as the per-set view.
--
-- The `catalog_totals` CTE is a one-row scan over the catalog — the
-- aggregate is cross-joined onto each user row so every per-user row
-- carries the same global denominators. Refresh recomputes the
-- catalog totals fresh.

CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_user_global_completion" AS
WITH "catalog_totals" AS (
  SELECT
    COUNT(DISTINCT "c"."id")::int                   AS "total_cards",
    COUNT(DISTINCT "p"."id") FILTER (
      WHERE "p"."include_in_master_set"
    )::int                                          AS "master_total"
  FROM "card" AS "c"
  LEFT JOIN "printing" AS "p" ON "p"."card_id" = "c"."id"
)
SELECT
  "ci"."user_id"                                    AS "user_id",
  COUNT(DISTINCT "c"."id")::int                     AS "unique_cards_owned",
  "t"."total_cards",
  COUNT(DISTINCT "p"."id") FILTER (
    WHERE "p"."include_in_master_set"
  )::int                                            AS "master_owned",
  "t"."master_total",
  CASE
    WHEN COALESCE("t"."total_cards", 0) = 0 THEN 0::numeric
    ELSE (COUNT(DISTINCT "c"."id")::numeric * 100) / "t"."total_cards"
  END                                               AS "all_pokemon_pct",
  CASE
    WHEN COALESCE("t"."master_total", 0) = 0 THEN 0::numeric
    ELSE (
      COUNT(DISTINCT "p"."id") FILTER (
        WHERE "p"."include_in_master_set"
      )::numeric * 100
    ) / "t"."master_total"
  END                                               AS "master_pct"
FROM "collection_item" AS "ci"
JOIN "printing" AS "p" ON "p"."id" = "ci"."printing_id"
JOIN "card" AS "c" ON "c"."id" = "p"."card_id"
CROSS JOIN "catalog_totals" AS "t"
GROUP BY "ci"."user_id", "t"."total_cards", "t"."master_total"
WITH NO DATA;
--> statement-breakpoint

-- =====================================================================
-- 3. Indices
-- =====================================================================
--
-- UNIQUE indexes are REQUIRED for `REFRESH MATERIALIZED VIEW
-- CONCURRENTLY` per the PostgreSQL docs: "Concurrent refresh is only
-- supported on materialized views that have at least one UNIQUE
-- index that uses no WHERE clause and includes only column names."
-- The group keys (`(user_id, set_id)` and `(user_id)`) match the
-- GROUP BY clauses by construction, so the UNIQUE constraint is
-- guaranteed to hold.
--
-- The per-set view gets an additional sort-direction index for the
-- "most-complete-first" home-screen view that's likely to appear
-- as a future affordance — Postgres can use it to seek the first
-- N rows ordered by `set_pct DESC` without sorting the entire MV.

CREATE UNIQUE INDEX IF NOT EXISTS "mv_user_set_completion_user_id_set_id_idx"
  ON "mv_user_set_completion" ("user_id", "set_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mv_user_set_completion_user_id_set_pct_idx"
  ON "mv_user_set_completion" ("user_id", "set_pct" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mv_user_global_completion_user_id_idx"
  ON "mv_user_global_completion" ("user_id");
--> statement-breakpoint

-- =====================================================================
-- 4. Wrapper views — user-scoped read surface
-- =====================================================================
--
-- See the header section "Why wrapper views, not pg_policy RLS" for
-- the rationale. These views are the only thing `authenticated`
-- callers SELECT from; the underlying MVs are service_role-only.
--
-- `security_barrier = true` forces Postgres to evaluate the view's
-- own qual (`user_id = auth.uid()`) before any caller-supplied
-- predicate, which closes the qual-reordering side-channel where a
-- malicious predicate would run first and observe other-user rows
-- before the gate eliminates them.
--
-- The qualifying clause uses `(SELECT auth.uid())` to give the
-- planner a stable scalar (one evaluation per query) rather than a
-- function call per row, which is what unlocks the `(user_id, ...)`
-- index for the filter.

CREATE OR REPLACE VIEW "v_my_set_completion"
  WITH (security_barrier = true) AS
SELECT
  "user_id",
  "set_id",
  "set_code",
  "set_name",
  "owned_unique",
  "total_unique",
  "owned_master",
  "total_master",
  "set_pct",
  "master_pct"
FROM "mv_user_set_completion"
WHERE "user_id" = (SELECT auth.uid());
--> statement-breakpoint

CREATE OR REPLACE VIEW "v_my_global_completion"
  WITH (security_barrier = true) AS
SELECT
  "user_id",
  "unique_cards_owned",
  "total_cards",
  "master_owned",
  "master_total",
  "all_pokemon_pct",
  "master_pct"
FROM "mv_user_global_completion"
WHERE "user_id" = (SELECT auth.uid());
--> statement-breakpoint

-- =====================================================================
-- 5. Access posture (REVOKE / GRANT)
-- =====================================================================
--
-- Same defense-in-depth pattern as `0013_mv_current_price.sql`:
-- revoke from PUBLIC, then grant SELECT to the consumer roles
-- explicitly. Two differences:
--
--   1. The underlying MVs grant SELECT ONLY to service_role
--      (authenticated cannot read them directly).
--   2. The wrapper views grant SELECT to authenticated. anon does
--      not get the view because `auth.uid()` is NULL for anon and
--      the view would return an empty set anyway — granting to
--      anon would be a no-op with a misleading "discoverable but
--      empty" signal.
--
-- No INSERT/UPDATE/DELETE on any of the four objects — MVs are
-- refreshed only by the SECURITY DEFINER function below.

REVOKE ALL ON "mv_user_set_completion" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "mv_user_global_completion" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "mv_user_set_completion" TO service_role;
--> statement-breakpoint
GRANT SELECT ON "mv_user_global_completion" TO service_role;
--> statement-breakpoint

REVOKE ALL ON "v_my_set_completion" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "v_my_global_completion" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "v_my_set_completion" TO authenticated, service_role;
--> statement-breakpoint
GRANT SELECT ON "v_my_global_completion" TO authenticated, service_role;
--> statement-breakpoint

-- =====================================================================
-- 6. Initial populate
-- =====================================================================
--
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` is only valid on a
-- previously-populated MV (per the PG 17 docs). The MVs above were
-- created `WITH NO DATA`, so the first refresh has to be the
-- non-concurrent form. We run it here in the migration on the empty
-- MV so the refresh function's CONCURRENTLY call works the first time
-- it's invoked from an Edge handler. On a freshly-migrated DB the
-- collection_item table is empty (or has only seed rows), so the
-- populate is effectively instant.

REFRESH MATERIALIZED VIEW "mv_user_set_completion";
--> statement-breakpoint
REFRESH MATERIALIZED VIEW "mv_user_global_completion";
--> statement-breakpoint

-- =====================================================================
-- 7. Refresh function
-- =====================================================================
--
-- Called by the collection-mutation Edge handlers via
-- `supabase.rpc('refresh_user_completion')` after each mutation. The
-- function is SECURITY DEFINER so any authenticated caller can refresh
-- (the function body is fixed; user input never reaches it). The
-- defense surface is mitigated by:
--
--   - `SET search_path = ''` (defends against malicious schemas
--     masquerading as `public.*`).
--   - Fully-qualified table refs so the empty search_path doesn't
--     break name resolution.
--   - No dynamic SQL — every statement is a static REFRESH.
--   - No user-controlled input (the function takes no arguments).
--
-- The REVOKE + GRANT lock down EXECUTE to authenticated end users +
-- service_role. anon callers cannot trigger work for someone else's
-- benefit (anon doesn't have a collection anyway, but the
-- belt-and-braces REVOKE matters for hosted Supabase where anon is
-- a real role with PostgREST exposure).

CREATE OR REPLACE FUNCTION public.refresh_user_completion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_user_set_completion;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_user_global_completion;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.refresh_user_completion() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refresh_user_completion()
  TO authenticated, service_role;
