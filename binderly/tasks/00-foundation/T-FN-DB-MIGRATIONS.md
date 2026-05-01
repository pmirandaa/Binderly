# T-FN-DB-MIGRATIONS — Drizzle ORM + migration tooling

**Stage:** 00-foundation
**Agent role:** backend
**Effort:** M
**Status:** pending

## Hard dependencies
- T-FN-SUPABASE-LOCAL
- T-FN-TS-CONFIG

## Soft dependencies
_(none)_

## Required reading
- rules/00-foundation.md
- context/data-model.md (general structure; specifics handled in stage 01)
- context/conventions.md (Database migrations)
- context/tech-stack.md (Why Drizzle)

## Goal
Wire up Drizzle as our schema-and-migration tool. Provide the
`packages/db` package skeleton that subsequent data-layer tasks will fill
with real schemas. Migrations are SQL files committed to git; Drizzle is
used to author and validate, but we do NOT use `drizzle-kit push` in
production — only generated SQL.

## Deliverables

- `packages/db/package.json` — name `@binderly/db`, dependencies on
  `drizzle-orm`, `drizzle-kit` (devDep), `postgres` (driver), `zod`.
- `packages/db/tsconfig.json` — extends `@binderly/tsconfig/library`.
- `packages/db/drizzle.config.ts` — schema path, out path, dialect
  postgresql, credentials from env (`API_PYTHON_DB_URL` shape, but
  package can use a generic `DATABASE_URL`).
- `packages/db/src/index.ts` — empty barrel, exports schema (added
  later) and the typed client.
- `packages/db/src/client.ts` — function `createDbClient(connectionString)`
  returning a Drizzle instance over `postgres-js`.
- `packages/db/src/schema/index.ts` — empty barrel.
- `packages/db/src/migrations/.gitkeep` — directory placeholder.
- `packages/db/scripts/generate.ts` — wraps `drizzle-kit generate` and
  enforces sequential numeric naming
  (`NNNN_<snake_case_summary>.sql`).
- `packages/db/scripts/migrate.ts` — applies migrations against a target
  DB URL.
- `packages/db/README.md` — usage: how to add a schema file, generate a
  migration, apply it, how migrations are reviewed.
- Root `package.json` scripts:
  - `db:generate` → runs the generate script
  - `db:migrate` → applies via `migrate.ts`
  - `db:migrate:local` → migrate against local Supabase

## Acceptance criteria

- [ ] `pnpm db:generate` produces a migration file (when a schema
      change exists) named in the documented format.
- [ ] `pnpm db:migrate:local` applies migrations against the running
      local Supabase Postgres without errors.
- [ ] `packages/db` builds, lints, typechecks.
- [ ] A trivial example schema (a single `_smoke` table, gitignored or
      in a test fixture, never committed to `src/schema/`) can be
      round-tripped: define → generate SQL → apply → query → drop.
- [ ] Migration files are SQL, NOT Drizzle's TypeScript-only journal
      format. Journal stays as metadata only.

## Out of scope

- Actual schema definitions — those live in stage 01 task files.
- RLS policies — they're separate migrations authored in stage 01.
- Production migration CI — stage 11.

## Branch & PR

- Branch: `agent/T-FN-DB-MIGRATIONS`
- PR title: `T-FN-DB-MIGRATIONS: Drizzle ORM + migration tooling`

## Escalation triggers

- Drizzle's generated SQL diverges from how Postgres 16 expects DDL in
  ways that would silently break in Supabase.
- The `postgres-js` driver vs `pg` choice has unexpected implications
  for connection pooling later — flag as a note, don't switch
  unilaterally.

## Notes from execution
_(empty)_
