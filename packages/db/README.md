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
    generate.ts              # wraps drizzle-kit generate + convention checks
    migrate.ts               # applies migrations to a target Postgres URL
```

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
default output already uses this shape; `scripts/generate.ts`
asserts so a future drizzle-kit upgrade can't silently change it.

If you need to author a non-Drizzle migration (e.g. an RLS-only
migration that drizzle's diff engine doesn't model), increment the next
free number and add a SQL file by hand. Keep the journal in sync.

## Migration files vs the journal

- **`src/migrations/<NNNN>_<name>.sql`** — the migration. SQL.
  Reviewed in PRs. Applied to Postgres by `migrate.ts`.
- **`src/migrations/meta/_journal.json`** — drizzle-managed metadata
  tracking which migrations exist and when they were generated. Also
  committed (it's how drizzle knows what's been generated locally) but
  it is **not** the migration. Migrations are SQL.

## Why no `drizzle-kit push` in production

`drizzle-kit push` diffs the live DB against the Drizzle schema and
applies changes directly — convenient in dev, dangerous in prod
(silent data loss, hidden index drops, no review surface). In Binderly
we **always** generate SQL, review the SQL in a PR, and apply via
`migrate.ts`. `push` is an emergency dev tool, not a deploy mechanism.

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
