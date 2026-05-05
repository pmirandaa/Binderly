# T-DL-ADMIN-DEBUG-SURFACES — Admin debug views (data_conflict + image / FX / pg_stat_statements catalog audit)

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** S
**Status:** review

---

## Hard dependencies

- **T-DL-RLS-POLICIES** — merged. Establishes the canonical
  `REVOKE ALL FROM PUBLIC` + per-role `GRANT` posture this task mirrors
  for the new debug views.

Transitive dependencies on already-merged catalog work this task
projects over (no FK relationships, just SELECT joins):

- **T-DL-DATA-CONFLICT-TABLE** (merged at `3fb5227` on `main`) — the
  `data_conflict` table backs `v_data_conflict_top` and
  `v_data_conflict_by_source`. Listed here so the elaboration is
  self-contained even though `dependencies.yaml` lists it as
  `parallel_safe_with` (no path collision).
- **T-DL-IMAGE-PIPELINE** — `printing_image` provenance sidecar; backs
  `v_image_pipeline_coverage_gaps`.
- **T-DL-SCHEMA-PRICING** — `fx_rate` table; backs
  `v_fx_rate_freshness`.

## Soft dependencies

- **T-SP-PRICING-DISPLAY** (Phase 3, not yet started) — will read
  `fx_rate` for display-time conversion. The freshness view here
  surfaces a stale-input signal that the display layer can also
  consume later (e.g. to flag "approx." renders). No coupling required
  for v1.
- **Future admin web UI** — not yet a task. The views are designed to
  be queryable directly via `psql` today; an admin dashboard can later
  read them through a service-role-keyed Postgres client.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources) — observability +
  audit posture.
- `rules/01-data-layer.md` — specifically
  *"Conflicts are surfaced, not silenced"* (the rule that motivates
  `v_data_conflict_top` / `v_data_conflict_by_source`).
- `packages/db/src/schema/data_conflict.ts` +
  `packages/db/src/migrations/0014_data_conflict.sql` — column shapes
  for the conflict views.
- `packages/db/src/migrations/0015_data_conflict_rls.sql` — canonical
  service-role-only `REVOKE` + `GRANT` block.
- `packages/db/src/schema/printing_image.ts` +
  `packages/db/src/migrations/0010_image_provenance.sql` — sidecar
  provenance shape (note: the merged schema has **no** error column;
  see Approach > `v_image_pipeline_coverage_gaps`).
- `packages/db/src/schema/printings.ts` — for the
  `image_small_url` / `image_source_url` columns the coverage view
  joins.
- `packages/db/src/schema/price_snapshots.ts` (specifically `fx_rate`)
  — column shapes for the freshness view.
- `packages/db/src/migrations/0009_pricing_rls.sql`,
  `0011_image_provenance_rls.sql`, `0013_mv_current_price.sql` —
  precedent REVOKE/GRANT patterns; `0013_mv_current_price.sql` is the
  closest precedent (a non-table relation with public-read posture
  and no RLS).
- `packages/db/scripts/verify-rls.ts` +
  `packages/db/scripts/verify-rls/{inventory,assertions}.ts` — the
  RLS verification harness; this task extends behavioral coverage to
  assert the per-view GRANT posture.

## Goal

Ship a small, hand-authored set of read-only Postgres `v_*` views that
expose pipeline-internal debug signals (resolver disagreements, image
pipeline coverage gaps, FX-rate freshness, top SQL queries) to the
`service_role` only. The data exists today across `data_conflict`,
`printing_image`, `printing`, `fx_rate`, and the
`pg_stat_statements` extension; without these views an operator has to
re-author the same ad-hoc joins on every debugging session. Each view
is gated to `service_role` per the catalog posture for
service-role-only tables, and the `verify-rls` harness is extended so
the gate is asserted on every CI run.

This is the last Phase 1 task — closes Phase 1 once merged.

## Scope — in

Hand-authored migration `packages/db/src/migrations/0016_admin_debug_views.sql`
that ships **five** views, in this order:

1. **`v_data_conflict_top`** — top 100 rows from `data_conflict`,
   ordered by `dispute_count DESC, last_seen_at DESC`. Columns:
   `entity_kind`, `entity_canonical_key`, `field_name`,
   `dispute_count`, `sources` (jsonb echo of which sources disagreed),
   `kept_value`, `last_seen_at`, `resolution`. Explicitly bounded with
   `LIMIT 100` so a `SELECT *` over the view never paginates.
2. **`v_data_conflict_by_source`** — per-source-per-field conflict
   counts. Built with `jsonb_object_keys(sources)` to expand the
   `sources` jsonb keys into rows, group by `(source_key, field_name)`,
   summing `dispute_count`. Columns: `source`, `field_name`,
   `conflict_count` (number of distinct conflicts), `total_dispute_count`
   (sum of `dispute_count`). Sorted by
   `total_dispute_count DESC, conflict_count DESC`.
3. **`v_image_pipeline_coverage_gaps`** — printings whose image
   pipeline has not produced a usable canonical image. The merged
   `printing_image` schema **does not carry an error column** — it
   only persists successful transcodes (the only DB-visible failure
   signal is "no row was written"). Re-shape the view from the stub's
   suggested `v_image_pipeline_failures` to surface the *coverage gap*
   instead: printings whose `image_small_url` IS NULL (no canonical
   chosen) **or** that have no matching `printing_image` row at all
   (no transcode succeeded for any source). Columns: `printing_id`,
   `variant_key`, `image_source_url` (the upstream URL the pipeline
   tried), `provenance_row_count` (count of `printing_image` rows
   across all sources for this printing), `canonical_url_present`
   (boolean — does `printing.image_small_url` IS NOT NULL?),
   `last_provenance_at` (max `transcoded_at` from `printing_image` for
   this printing, or NULL).
4. **`v_fx_rate_freshness`** — per `(base_currency, quote_currency)`
   pair: `rate_date_max`, `rate_date_min`, `gap_days` (`current_date -
   rate_date_max::date`), `row_count_30d` (rows with
   `rate_date >= current_date - 30`), and the most recent
   `fetched_at`. Surfaces stale FX inputs without requiring the
   display layer to be live.
5. **`v_pg_stat_statements_top_queries`** — top 50 normalized queries
   ordered by `total_exec_time DESC`. Reads from the
   Supabase-installed `extensions.pg_stat_statements` view. Columns:
   `query` (parameterized; pg_stat_statements normalizes literals out),
   `calls`, `total_exec_time`, `mean_exec_time`, `max_exec_time`,
   `rows`, `shared_blks_hit`, `shared_blks_read`, `queryid`.
   `pg_stat_statements` is a CONTRIB extension; the migration does
   `CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA
   extensions;` at the top so the migration is self-contained when the
   extension is missing in production.

For each view the migration ships the canonical posture:

```sql
DROP VIEW IF EXISTS public.<name> CASCADE;
CREATE VIEW public.<name> AS <body>;
REVOKE ALL ON public.<name> FROM PUBLIC;
GRANT SELECT ON public.<name> TO service_role;
```

`DROP VIEW IF EXISTS … CASCADE` keeps the migration idempotent during
local dev (re-running after edits) — production never re-runs an
applied migration. `CASCADE` is safe because nothing in the catalog
depends on these views; if a future task starts depending on one,
reviewers will notice in the PR.

Companion edits:

- `packages/db/src/migrations/meta/_journal.json` — append idx 16
  entry, tag `0016_admin_debug_views`, version `7`, breakpoints
  `true`, `when` field set to a millisecond timestamp greater than
  the existing 0015 entry (`1777920000005`).
- `packages/db/scripts/verify-rls/inventory.ts` — add an
  `EXPECTED_DEBUG_VIEWS` constant listing the five view names; add
  the structural assertion that they exist in `pg_catalog.pg_views`.
- `packages/db/scripts/verify-rls/assertions.ts` — extend
  `assertBehavior` so anon/authenticated assertions cover each view
  (every view should fail with permission denied) and the service_role
  pass asserts SELECT succeeds. Reuses the existing
  `assertSelectDenied` / `assertSelectAllowed` helpers; no new helpers
  required.
- `packages/db/scripts/verify-rls/index.ts` — add a structural
  asserter call for the new view inventory (parallel to
  `assertTablesExist`).
- `packages/db/README.md` — append a `## Admin debug views` section
  documenting each view's body + gate posture, plus the paste-able
  smoke commands.

## Scope — out

- **Drizzle `pgView` definitions / `packages/db/src/views/` directory.**
  The `dependencies.yaml` entry's `owns_paths` listed
  `packages/db/src/views/` as a possible home; we override that.
  Drizzle's `pgView` support is light, materialized views and
  `DISTINCT ON` views are not first-class, and the consuming surface
  (psql today, an admin web UI later) does not need TS types. Keeping
  the views as hand-authored SQL in the migration matches the
  `mv_current_price` precedent from
  `0013_mv_current_price.sql` and avoids a TS layer that would have
  to be hand-maintained anyway. No `packages/db/src/views/` directory
  is created.
- **An admin Postgres role** (`admin` etc.). Local Supabase does not
  ship one; the `psql … "SELECT rolname FROM pg_roles"` check at
  elaboration time returned only `anon`, `authenticated`, `postgres`,
  `service_role`. Defaulting to `service_role` only matches the
  `data_conflict`, `price_observation`, `grading_training_sample`
  precedent. Provisioning an `admin` role for human-driven debug
  access is surfaced as **Q-007** in `open-questions.md`; **not**
  blocking — service_role is the v1 admin posture.
- **Persisting image-pipeline failures to the DB.** The
  `printing_image` schema today only persists successful transcodes;
  failures live in run-report JSON in
  `data-pipeline/scripts/output/<run>.json` and the
  `data-pipeline` logger output. Surfacing those into a
  `printing_image_failure` table is a separate, larger piece of work
  (schema + migration + RLS + resolver write path); out of scope here.
  `v_image_pipeline_coverage_gaps` is the best DB-visible signal we
  can ship today.
- **`mv_*` materialized views.** All five views in this task are
  *regular* views (re-evaluated on every SELECT). Materialization
  would only matter if the queries become hot-path; they are admin
  debug surfaces — by definition queried rarely.
- **A CLI / cron job.** No new TypeScript ships in this task. The
  views are queried directly via `psql` today; the future admin web
  UI will read them through a service-role-keyed client.
- **Indexes for the views.** Views inherit the underlying tables'
  indexes. `data_conflict` already ships
  `data_conflict_dispute_count_idx` and
  `data_conflict_last_seen_at_idx`; `printing_image` ships
  `printing_image_printing_id_idx`; `fx_rate` ships
  `fx_rate_rate_date_quote_currency_idx`;
  `pg_stat_statements` ships its own internal indexing. No new
  indexes are needed.
- **A pricing aggregate / completion debug view.** Not asked for;
  the eventual `T-SP-PRICING-DISPLAY` consumer reads
  `mv_current_price`, not a new debug view.

## Approach

### View definitions (hand-authored DDL)

Wrapped in a single migration that is read top-to-bottom; each block
is preceded by an explanatory SQL comment.

```sql
-- 0. Make pg_stat_statements available in the migration's session.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- 1. v_data_conflict_top
DROP VIEW IF EXISTS public.v_data_conflict_top CASCADE;
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

-- 2. v_data_conflict_by_source
DROP VIEW IF EXISTS public.v_data_conflict_by_source CASCADE;
CREATE VIEW public.v_data_conflict_by_source AS
SELECT
  s.source_key                       AS source,
  c.field_name,
  COUNT(*)::bigint                   AS conflict_count,
  SUM(c.dispute_count)::bigint       AS total_dispute_count
FROM   public.data_conflict c
CROSS JOIN LATERAL jsonb_object_keys(c.sources) AS s(source_key)
WHERE  s.source_key NOT IN ('reason')   -- drop resolver-only metadata keys
GROUP  BY s.source_key, c.field_name
ORDER  BY total_dispute_count DESC, conflict_count DESC;

-- 3. v_image_pipeline_coverage_gaps
DROP VIEW IF EXISTS public.v_image_pipeline_coverage_gaps CASCADE;
CREATE VIEW public.v_image_pipeline_coverage_gaps AS
SELECT
  p.id                              AS printing_id,
  p.variant_key,
  p.image_source_url,
  COALESCE(pi.provenance_row_count, 0)::bigint AS provenance_row_count,
  (p.image_small_url IS NOT NULL)              AS canonical_url_present,
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

-- 4. v_fx_rate_freshness
DROP VIEW IF EXISTS public.v_fx_rate_freshness CASCADE;
CREATE VIEW public.v_fx_rate_freshness AS
SELECT
  base_currency,
  quote_currency,
  MAX(rate_date)                                   AS rate_date_max,
  MIN(rate_date)                                   AS rate_date_min,
  (CURRENT_DATE - MAX(rate_date))::int             AS gap_days,
  COUNT(*) FILTER (WHERE rate_date >= CURRENT_DATE - 30)::bigint AS row_count_30d,
  MAX(fetched_at)                                  AS last_fetched_at
FROM   public.fx_rate
GROUP  BY base_currency, quote_currency
ORDER  BY gap_days DESC, base_currency, quote_currency;

-- 5. v_pg_stat_statements_top_queries
DROP VIEW IF EXISTS public.v_pg_stat_statements_top_queries CASCADE;
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
```

The exact migration ships with the canonical REVOKE/GRANT block per
view, plus a comment header pinning the rationale and the per-view
column list.

### Why these five (and not the stub's five exactly)

The stub suggested `v_image_pipeline_failures` as a join over
`printing_image` rows with a "non-null error column". The merged
`printing_image` schema has no such column — it is a strict
provenance sidecar that only persists successful transcodes (see
`packages/db/src/schema/printing_image.ts` head comment). The DB-only
failure signal is therefore *absence* (no row, or `printing.image_small_url
IS NULL`), and that is what `v_image_pipeline_coverage_gaps` exposes.
The rename is documented at the top of the migration and in the
"Notes from execution" appendix below.

The other four views match the stub set verbatim. Total: 5 views,
sized to S effort.

### `pg_stat_statements` posture

Verified at elaboration time against local Supabase:

```
$ psql … -c "SELECT name, default_version, installed_version
            FROM pg_available_extensions WHERE name='pg_stat_statements';"
        name        | default_version | installed_version
--------------------+-----------------+-------------------
 pg_stat_statements | 1.11            | 1.11
$ psql … -c "SHOW shared_preload_libraries;"
… pg_stat_statements, pgaudit, plpgsql, plpgsql_check, pg_cron, … (loaded)
$ psql … -c "SELECT n.nspname, c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relname='pg_stat_statements';"
   nspname  |      relname
------------+--------------------
 extensions | pg_stat_statements
```

Local Supabase ships `pg_stat_statements` v1.11 in the `extensions`
schema, loaded via `shared_preload_libraries`. The migration:

- Issues `CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH
  SCHEMA extensions;` at the top. No-op locally; in production
  Supabase the same statement is also a no-op when the extension is
  enabled (the default for new Supabase projects since 2023).
- References the underlying view as fully-qualified
  `extensions.pg_stat_statements` so the lookup is independent of
  whatever `search_path` the migration runner has.
- Does **not** GRANT directly on `extensions.pg_stat_statements` —
  the wrapper `public.v_pg_stat_statements_top_queries` is owned by
  `postgres` (the migration runner). Views default to `security_invoker
  = false` in PG 17, so the underlying-table read uses the **view
  owner's** privileges, which already include SELECT on
  `extensions.pg_stat_statements`. service_role only needs SELECT on
  the wrapper view.

If a future Supabase project disables the extension (uncommon — it
ships enabled), the migration will fail at `CREATE EXTENSION`. That
failure is loud and easy to diagnose; documented in the migration
header comment.

### Admin role posture

Verified at elaboration time:

```
$ psql … -c "SELECT rolname FROM pg_roles
            WHERE rolname IN ('admin','service_role','anon','authenticated','postgres')
            ORDER BY rolname;"
    rolname
---------------
 anon
 authenticated
 postgres
 service_role
```

No `admin` role exists. Defaulting to `service_role` only — matches
the precedent for `data_conflict` (`0015_data_conflict_rls.sql`),
`price_observation` (`0009_pricing_rls.sql` § price_observation
policies), and `grading_training_sample` (`0007_grading_rls.sql`).

The question of whether to provision a dedicated `admin` Postgres role
for read-only debug access by humans (e.g. via a future admin web UI
or break-glass psql session) is captured as **Q-007** in
`open-questions.md`. Not blocking — `service_role` is the canonical
v1 admin posture.

### Why this lives in SQL, not Drizzle pgView

Drizzle's `pgView` support exists but has rough edges around
`DISTINCT ON`, `LATERAL`, and aggregate views. The closest precedent
in this repo —`mv_current_price` (`0013_mv_current_price.sql`) —is
hand-authored SQL with no Drizzle TS layer; the elaborated task
explicitly recorded the same trade-off. The `dependencies.yaml`
entry's `owns_paths` listed `packages/db/src/views/`; we override.

App code that wants to read these views uses raw SQL via the
`postgres-js` client (the `createDbClient(...).$client` pattern used
elsewhere in the data-pipeline). For now, they are queried via psql.

### Migration posture

Single migration, hand-authored:

- One file: `packages/db/src/migrations/0016_admin_debug_views.sql`.
- Idempotent at the SQL level: every view is preceded by
  `DROP VIEW IF EXISTS … CASCADE;` so re-running the migration in
  dev (after a `supabase db reset`) succeeds.
- Comment header documents each view, the access posture, and the
  pg_stat_statements / admin-role caveats.
- One `_journal.json` entry at idx 16, tag
  `0016_admin_debug_views`. Schema changes are SQL-only — no
  drizzle-kit regeneration is needed.

### Verify-rls extension

The harness today asserts on `pg_class` /`pg_policies` /behavioral
SELECTs against tables. Views aren't `pg_class` tables for
`relrowsecurity` purposes (Postgres does not support RLS on regular
views). The new assertions add:

1. **Structural** — a new `EXPECTED_DEBUG_VIEWS` constant in
   `inventory.ts`. New `assertViewsExist` asserter (parallel to
   `assertTablesExist`) verifies every view name appears in
   `pg_catalog.pg_views` (schema `public`).
2. **Behavioral** — extend the existing role-switch passes in
   `assertBehavior`:
   - `anon`: `assertSelectDenied(sql, view, 'anon', results)` for
     each of the five views.
   - `authenticated`: same.
   - `service_role`: `assertSelectAllowed(sql, view, 'service_role',
     results)` for each.

Reuses existing helpers (`assertSelectDenied`,
`assertSelectAllowed`). The denial path either returns 0 rows (no
GRANT, but no error — depending on PG-version handling) or throws
`permission denied`; both count as "blocked". No new harness code
beyond the inventory addition + a parallel asserter and the
behavioral wiring.

## Acceptance criteria

- [ ] `packages/db/src/migrations/0016_admin_debug_views.sql` exists,
      is hand-authored, and ships exactly five views named
      `v_data_conflict_top`, `v_data_conflict_by_source`,
      `v_image_pipeline_coverage_gaps`, `v_fx_rate_freshness`,
      `v_pg_stat_statements_top_queries`.
- [ ] Each view ships with `DROP VIEW IF EXISTS … CASCADE;` (idempotency)
      followed by `CREATE VIEW`, and a per-view block:
      `REVOKE ALL ON public.<view> FROM PUBLIC; GRANT SELECT ON
      public.<view> TO service_role;`.
- [ ] The migration's first non-comment statement is
      `CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA
      extensions;` so the migration is self-contained when the
      extension is absent.
- [ ] Migration header comment documents (a) why the views exist,
      (b) the rename from `v_image_pipeline_failures` →
      `v_image_pipeline_coverage_gaps`, (c) the
      `service_role`-only posture and link to Q-007 about a future
      admin role, (d) the `pg_stat_statements` extension caveat.
- [ ] `_journal.json` carries a new entry at idx 16, tag
      `0016_admin_debug_views`, version `7`, breakpoints `true`,
      `when` strictly greater than the existing 0015 entry.
- [ ] `packages/db/scripts/verify-rls/inventory.ts` exports a
      `EXPECTED_DEBUG_VIEWS` constant listing the five view names.
- [ ] `packages/db/scripts/verify-rls/index.ts` calls the new
      structural asserter for views (parallel to
      `assertTablesExist`).
- [ ] `packages/db/scripts/verify-rls/assertions.ts` extends
      `assertBehavior`: anon and authenticated each fail
      `assertSelectDenied` for every view; service_role passes
      `assertSelectAllowed` for every view.
- [ ] `packages/db/README.md` carries a new `## Admin debug views`
      section that quotes each view body, names its access posture,
      and gives the paste-able psql smoke commands.
- [ ] Q-007 entry exists in `open-questions.md` covering the
      "should we provision an `admin` Postgres role?" question.
      `Pablo's answer:` left empty; non-blocking.
- [ ] All `@binderly/db` package gates pass clean: `format:check`,
      `lint`, `typecheck`.
- [ ] All five `@binderly/data-pipeline` package gates pass clean:
      `format:check`, `lint`, `typecheck`, `test`, `build`. Test
      count must NOT shrink (currently 1101).
- [ ] Branch `agent/T-DL-ADMIN-DEBUG-SURFACES` pushes; GitHub Actions
      checks pass green before the PR opens.

## Owns_paths

`dependencies.yaml`'s entry lists
`packages/db/src/migrations/, packages/db/src/views/`. We override:
`packages/db/src/views/` is dropped (no Drizzle TS layer for views;
see "Why this lives in SQL" above). Effective paths for this task:

- `packages/db/src/migrations/0016_admin_debug_views.sql`
- `packages/db/scripts/verify-rls/inventory.ts`
- `packages/db/scripts/verify-rls/assertions.ts`
- `packages/db/scripts/verify-rls/index.ts`

## Files outside `owns_paths` pre-authorized

- `packages/db/src/migrations/meta/_journal.json` — append idx 16 entry.
- `packages/db/README.md` — append `## Admin debug views` section.
- `open-questions.md` — append Q-007 entry.
- `dependencies.yaml` — flip `T-DL-ADMIN-DEBUG-SURFACES` from
  `in_progress` → `review` after CI green.
- This task file — flip `Status` header to `review` after CI green.

## Migrations

Adds `0016_admin_debug_views.sql` (hand-authored). Drizzle-kit doesn't
model views deeply, so the migration is authored in SQL by hand
following the precedent of every existing RLS migration
(`0001` / `0003` / `0005` / `0007` / `0009` / `0011` / `0012` /
`0013` / `0015`). The journal entry is appended manually at idx 16.

## Dependencies (sanity check vs `dependencies.yaml`)

```yaml
- id: T-DL-ADMIN-DEBUG-SURFACES
  depends_on: [T-DL-RLS-POLICIES]
  parallel_safe_with: [T-DL-PROFILE-GRANTS-FIX, T-DL-DATA-CONFLICT-TABLE]
  owns_paths: [packages/db/src/migrations/, packages/db/src/views/]
```

Hard dependency `T-DL-RLS-POLICIES` is `merged`. Both
`parallel_safe_with` peers (`T-DL-PROFILE-GRANTS-FIX`,
`T-DL-DATA-CONFLICT-TABLE`) are also `merged`, so there is no
parallel-write hazard.

## Test plan

No unit tests added — these views are pure SQL with no TypeScript
surface. Coverage is split between:

1. **Static review** — the migration SQL itself, audited at PR review
   against the per-view DDL listed above.
2. **`verify-rls` posture assertions** — every view gets a
   structural existence check (`pg_views`) plus a behavioral
   denied-for-anon, denied-for-authenticated, allowed-for-service_role
   triplet. These run in CI under
   `pnpm --filter @binderly/db verify-rls` against a freshly-migrated
   local Supabase (or hosted DB once available).
3. **Live smoke** — paste-able psql block in the PR body that runs
   `SELECT` on each view after a `seed --source tcgdex-en --set en-swsh9`
   ingest. Pablo runs it post-merge to confirm the views return
   sensible counts. The ingest already produces conflict rows
   (T-DL-DATA-CONFLICT-TABLE persists every resolver disagreement).

The data-pipeline test suite is untouched — current 1101 tests stay
flat because no TS lands.

CLI / live smoke (paste-able for Pablo, in PR body):

```sh
export PATH="/Users/pmiranda/.nvm/versions/node/v22.13.0/bin:$PATH"
pnpm install --prefer-offline

pnpm --filter @binderly/db db:migrate \
  --url postgresql://postgres:postgres@localhost:54322/postgres
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres \
  pnpm --filter @binderly/db verify-rls

# Reseed (produces resolver conflicts -> rows in v_data_conflict_top etc.)
pnpm --filter @binderly/data-pipeline seed --source tcgdex-en --set en-swsh9

psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM v_data_conflict_top LIMIT 5;"
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM v_data_conflict_by_source LIMIT 10;"
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM v_image_pipeline_coverage_gaps LIMIT 10;"
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM v_fx_rate_freshness;"
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM v_pg_stat_statements_top_queries LIMIT 5;"
```

Expected: every `SELECT *` returns either a non-empty result
(conflicts / coverage gaps / fx rates / top queries) or an empty
result (e.g. `v_data_conflict_top` is empty before the first ingest).
None should error.

## Open questions

### Q-007 — Should we provision a dedicated `admin` Postgres role?

This task ships the views gated to `service_role` only. An eventual
admin web UI (Phase 4+ scope) and human-driven psql debug sessions
would benefit from a narrower role with read-only access to the debug
surfaces — service_role's BYPASSRLS attribute means anyone holding
the key can read or write any catalog table, which is more surface
area than a debug operator needs. Surfaced to Pablo for ratification;
not blocking — service_role is the v1 admin posture. See
`open-questions.md` Q-007 for the full options analysis.

## Branch & PR

- Branch: `agent/T-DL-ADMIN-DEBUG-SURFACES`
- PR title: `T-DL-ADMIN-DEBUG-SURFACES: admin debug views (catalog audit + pg_stat_statements) — closes Phase 1`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and escalate to orchestrator (via `open-questions.md` append) if:

- Local Supabase reports `pg_stat_statements` is **not** installed
  AND the migration's `CREATE EXTENSION IF NOT EXISTS` cannot create
  it (e.g. the migration role lacks `CREATE` on the `extensions`
  schema). Document the failure mode and either skip the
  `v_pg_stat_statements_top_queries` view or surface a follow-up
  task that runs the extension-create out of band.
- The merged `printing_image` schema turns out to have an error
  column after all (re-read at start of work) — in which case the
  view rename is unnecessary.
- A `data_conflict` `sources` jsonb shape includes a key the
  resolver later starts using for new metadata (today: `reason` is
  the only metadata key); the
  `WHERE s.source_key NOT IN ('reason')` filter in
  `v_data_conflict_by_source` may need to widen.
- Any view ends up needing an index (none expected — debug surface
  read frequency is low).
- The view set drifts from S effort during implementation (cut a
  view rather than spilling to M).

## Notes from execution

### View rename — `v_image_pipeline_failures` → `v_image_pipeline_coverage_gaps`

The stub suggested `v_image_pipeline_failures` joining onto a
`printing_image` row "with a non-null error column". The merged
`printing_image` schema (read at start of work, per
`packages/db/src/schema/printing_image.ts` head comment) has **no**
error column — the table is a strict provenance sidecar that only
persists successful transcodes (Q-005 in `open-questions.md`
documents image-pipeline failures landing in run-report JSON, not in
the DB). Renamed the view to surface the actually-observable
DB-only signal: printings missing canonical URL or with zero
provenance rows. Decision recorded in the migration header comment
and the elaborated task .md under "Approach > v3.

### `pg_stat_statements` query-text masking

`pg_stat_statements` applies a runtime privilege check on
`current_user`: only superusers and members of `pg_read_all_stats`
see the full `query` text for queries executed by *other* roles. For
service_role (the gate role for these views) that means: queries
run by the data-pipeline / edge functions show full text, but
queries run by `postgres` / `supabase_admin` / `authenticator`
show `<insufficient privilege>` for the text — though stats columns
(calls / *_exec_time / rows / shared_blks_*) are always visible.
Granting `pg_read_all_stats` to service_role would lift the
restriction but requires `WITH ADMIN OPTION` on the predefined
role, which Supabase does not delegate by default
(`GRANT pg_read_all_stats TO service_role` returns "permission
denied to grant role"). Documented in the migration header comment
and the README as a known limitation rather than worked around.

### `verify-rls` extension

`assertViewsExist` mirrors `assertTablesExist` (parallel structural
asserter). The behavioral matrix (anon/authenticated denied,
service_role allowed) reuses the existing `assertSelectDenied` /
`assertSelectAllowed` helpers — no new harness primitives needed.
The full suite cannot be run from a sandboxed agent shell (tsx
spawn-IPC fails with EPERM, same as `db:migrate`). Validation done
by hand-applying `0014_data_conflict.sql`, `0015_data_conflict_rls.sql`,
and the new `0016_admin_debug_views.sql` against local Supabase via
`psql -f`, then running per-role `SET LOCAL ROLE` smoke checks
(service_role: 5/5 SELECT succeeds; anon + authenticated: 5/5 fail
with "permission denied for view"). Pablo can re-run the full suite
post-merge per the smoke commands in the PR body.

### Migrating production

`CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA
extensions;` is the first non-comment statement of the migration.
Local Supabase ships the extension already enabled (verified via
`pg_extension`); newer hosted Supabase projects do too. If a future
Supabase project disables it, the migration fails loudly at the
CREATE EXTENSION step — easy to recover (re-enable out of band, re-
run the migration). The data_conflict / printing_image / fx_rate /
printing tables are all merged on `main`, so the migration's other
references resolve cleanly.
