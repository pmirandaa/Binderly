# @binderly/db

Drizzle ORM schemas, generated SQL migrations, and the typed Postgres
client for Binderly.

This is a **server-side** package. App code (web, mobile, edge
functions) talks to Postgres through the Supabase JS SDK so that RLS is
enforced for end users. `@binderly/db` is consumed by:

- migration scripts (`db:generate`, `db:migrate`)
- data-pipeline jobs that need raw SQL/typed access
- service-role surfaces (cron, ingestion) running with bypass

## Layout

```
packages/db/
  drizzle.config.ts          # drizzle-kit config (schema/out/dialect/credentials)
  package.json
  tsconfig.json
  eslint.config.js
  src/
    index.ts                 # public barrel — re-exports client + schema
    client.ts                # createDbClient(connectionString)
    schema/
      index.ts               # schema barrel — Phase 1 schema tasks fill this
    migrations/
      .gitkeep               # placeholder; populated by db:generate
      meta/_journal.json     # drizzle-managed metadata (committed)
      0001_*.sql             # generated SQL, committed and reviewed by humans
  scripts/
    generate.mjs             # wraps drizzle-kit generate + convention checks
    migrate.mjs              # applies migrations to a target Postgres URL
```

> The generate/migrate scripts are plain ESM (`.mjs`, run with `node`,
> not `tsx`) so they never depend on the tsx transpile runtime — see
> `scripts/migrate.mjs` header and #FU-1 / #FU-7 for the rationale.

## Targets

Two local Postgres instances coexist on this repo. Migrations target
**Supabase**; the Compose Postgres is for the data-pipeline only and
never receives schema migrations.

| Stack            | Port    | Owns                                | Migration target? |
| ---------------- | ------- | ----------------------------------- | ----------------- |
| Supabase CLI     | `54322` | App schema (auth, RLS, app tables)  | **YES**           |
| Compose Postgres | `5433`  | Data-pipeline ETL/ingestion staging | NO                |

Set `SUPABASE_DB_URL` (already pre-populated in `.env.example`) for
local migrations. `DATABASE_URL`, if set, takes precedence — useful for
production CI pointing at the cloud Supabase Postgres.

## Adding a schema (Phase 1+)

1. Create `src/schema/<feature>.ts` with Drizzle table definitions:

   ```ts
   import { pgTable, uuid, text } from 'drizzle-orm/pg-core';

   export const card = pgTable('card', {
     id: uuid('id').primaryKey().defaultRandom(),
     name: text('name').notNull(),
   });
   ```

2. Re-export it from `src/schema/index.ts`:

   ```ts
   export * from './card.js';
   ```

3. Generate SQL:

   ```bash
   pnpm --filter @binderly/db db:generate
   ```

   This invokes `drizzle-kit generate` and asserts the output file
   matches the `NNNN_<snake_case_summary>.sql` naming convention. The
   first migration produced is `0000_*.sql`; subsequent ones increment.

4. Review the generated SQL in `src/migrations/<NNNN>_*.sql`. Edit if
   needed (e.g. add `IF NOT EXISTS` for extension creation, RLS policy
   adjustments, manual data backfill). The file is what we ship — it's
   not regenerated downstream.

5. Apply it locally:

   ```bash
   pnpm db:migrate:local
   ```

## Naming convention

Sequential numeric: `NNNN_<snake_case_summary>.sql`. Drizzle-kit's
default output already uses this shape; `scripts/generate.mjs`
asserts so a future drizzle-kit upgrade can't silently change it.

If you need to author a non-Drizzle migration (e.g. an RLS-only
migration that drizzle's diff engine doesn't model), increment the next
free number and add a SQL file by hand. Keep the journal in sync.

## Migration files vs the journal

- **`src/migrations/<NNNN>_<name>.sql`** — the migration. SQL.
  Reviewed in PRs. Applied to Postgres by `migrate.mjs`.
- **`src/migrations/meta/_journal.json`** — drizzle-managed metadata
  tracking which migrations exist and when they were generated. Also
  committed (it's how drizzle knows what's been generated locally) but
  it is **not** the migration. Migrations are SQL.

## Why no `drizzle-kit push` in production

`drizzle-kit push` diffs the live DB against the Drizzle schema and
applies changes directly — convenient in dev, dangerous in prod
(silent data loss, hidden index drops, no review surface). In Binderly
we **always** generate SQL, review the SQL in a PR, and apply via
`migrate.mjs`. `push` is an emergency dev tool, not a deploy mechanism.

## Driver: postgres-js (not pg)

We use the `postgres` package (a.k.a. postgres-js) as the driver. It's
lighter, has first-class TypeScript types, and works in Edge runtimes.
If a future use case needs `pg`-specific features (PgBouncer
transaction-pool with prepared statements, custom binary protocol
overrides, etc.), surface it before switching — they have different
pooling semantics.

## Scripts

| Script                  | What it does                                                       |
| ----------------------- | ------------------------------------------------------------------ |
| `pnpm db:generate`      | Generate next SQL migration from current schema                    |
| `pnpm db:migrate`       | Apply all pending migrations to `$DATABASE_URL` (or `--url`)       |
| `pnpm db:migrate:local` | Apply against local Supabase Postgres (`$SUPABASE_DB_URL`)         |
| `pnpm build`            | `tsc -p .` — emit `dist/` for downstream consumers                 |
| `pnpm lint`             | ESLint with `--max-warnings=0`                                     |
| `pnpm typecheck`        | `tsc -p . --noEmit`                                                |
| `pnpm format`           | Prettier write                                                     |
| `pnpm format:check`     | Prettier check                                                     |
| `pnpm test`             | Placeholder until Phase 1 introduces real schema integration tests |

## Phase 1 hand-off

When `T-DL-SCHEMA-CARDS` / `T-DL-SCHEMA-USERS` / etc. land:

- They add files under `src/schema/` and add re-exports to
  `src/schema/index.ts`.
- They run `pnpm db:generate` and commit the SQL file alongside the
  schema TS file in the **same PR**.
- They add RLS policies as **separate** migrations (one logical change
  per migration — see `context/conventions.md`). Hand-write the SQL,
  bump the journal, and the policy ships in `<NNNN+1>_<name>.sql`.

## Admin debug views

Migration `0016_admin_debug_views.sql` ships five hand-authored
read-only `v_*` views that surface pipeline-internal debug signals to
the `service_role` only. They live in `public` for ergonomics
(callers don't need to qualify the schema) but are gated via
`REVOKE ALL FROM PUBLIC` + `GRANT SELECT TO service_role` — same
posture as the `data_conflict` table from `0015_data_conflict_rls.sql`.
PostgreSQL does not support RLS on regular views (RLS is "supported
for tables" only), so the gate is enforced by SQL grants alone — same
shape as `mv_current_price` from `0013_mv_current_price.sql`.

| View                               | Reads from                                  | Surfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v_data_conflict_top`              | `public.data_conflict`                      | Top 100 conflicts ordered by `dispute_count DESC, last_seen_at DESC`. The headline view for "what conflicts are recurring most often?".                                                                                                                                                                                                                                                                                                                                                                         |
| `v_data_conflict_by_source`        | `public.data_conflict`                      | Per-source-per-field rollup. Built with `jsonb_object_keys(sources)`. Columns: `source`, `field_name`, `conflict_count`, `total_dispute_count`.                                                                                                                                                                                                                                                                                                                                                                 |
| `v_image_pipeline_coverage_gaps`   | `public.printing` ⨝ `public.printing_image` | Printings missing canonical image URL or with zero provenance rows. The DB-only "image pipeline failed" signal — the merged `printing_image` schema persists only successful transcodes, so the failure surface is "no row was written".                                                                                                                                                                                                                                                                        |
| `v_fx_rate_freshness`              | `public.fx_rate`                            | Per `(base_currency, quote_currency)` pair: max + min rate date, `gap_days` vs `CURRENT_DATE`, `row_count_30d`, `last_fetched_at`. Sorted by `gap_days DESC` so stale pairs surface first.                                                                                                                                                                                                                                                                                                                      |
| `v_pg_stat_statements_top_queries` | `extensions.pg_stat_statements`             | Top 50 normalized queries by `total_exec_time DESC`. The migration runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;` so the migration is self-contained when the extension is missing in production. Note: pg_stat_statements applies its own runtime privilege check on `current_user` — service_role sees full `query` text only for queries it executed itself; queries run by other roles show `<insufficient privilege>` for the text but stats columns are always visible. |

### Querying the views

The views are gated to `service_role`. Two consumption paths:

1. **Direct psql via the `postgres` superuser** (local dev / break-glass):

   ```sh
   psql "$SUPABASE_DB_URL" -c "SELECT * FROM v_data_conflict_top LIMIT 5;"
   psql "$SUPABASE_DB_URL" -c "SELECT * FROM v_data_conflict_by_source LIMIT 10;"
   psql "$SUPABASE_DB_URL" -c "SELECT * FROM v_image_pipeline_coverage_gaps LIMIT 10;"
   psql "$SUPABASE_DB_URL" -c "SELECT * FROM v_fx_rate_freshness;"
   psql "$SUPABASE_DB_URL" -c "SELECT * FROM v_pg_stat_statements_top_queries LIMIT 5;"
   ```

2. **Service-role-keyed Postgres client** (data-pipeline jobs, the
   eventual admin web UI). Use the same `createDbClient(...).$client`
   raw-SQL pattern that `data-pipeline/src/jobs/pricing-current-view.ts`
   established for `mv_current_price`.

Anon and authenticated sessions are denied — verified by
`pnpm --filter @binderly/db verify-rls`, which drives every view
through `assertSelectDenied` for anon + authenticated and
`assertSelectAllowed` for service_role.

### Why no Drizzle TS layer

Drizzle's `pgView` support is light around `DISTINCT ON`, `LATERAL`,
and aggregate views (the patterns `v_data_conflict_by_source` and
`v_image_pipeline_coverage_gaps` use). The closest precedent in this
repo — `mv_current_price` from `0013_mv_current_price.sql` — is
hand-authored SQL with no Drizzle TS layer. The views are read via
raw SQL when the app needs them.

### Admin role posture

`v1` ships gated to `service_role` only. Whether to provision a
narrower read-only `admin` Postgres role for human-driven debug
access (e.g. via a future admin web UI) is captured as **Q-007** in
`open-questions.md`. Non-blocking — service_role is the v1 admin
posture, matching the `data_conflict` / `price_observation` /
`grading_training_sample` precedent.
