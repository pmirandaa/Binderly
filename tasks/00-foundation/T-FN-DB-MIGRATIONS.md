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

### Pinned versions (npm `latest` at time of authoring)

| Package       | Pin        | Notes                                                       |
| ------------- | ---------- | ----------------------------------------------------------- |
| `drizzle-orm` | `0.45.2`   | postgres-js binding consumed at runtime.                    |
| `drizzle-kit` | `0.31.10`  | devDep; used only for `drizzle-kit generate`.               |
| `postgres`    | `3.4.9`    | postgres-js driver.                                         |
| `zod`         | `3.25.76`  | held at 3.x per spec — Phase-1 callers stay on 3.x for now. |
| `tsx`         | `4.21.0`   | runs the TS scripts directly.                               |
| `typescript`  | `5.9.3`    | matches workspace pin (`packages/config/tsconfig`).         |
| `@types/node` | `22.19.17` | matches workspace pin.                                      |
| `eslint`      | `9.39.4`   | matches `@binderly/eslint-config` peer.                     |
| `prettier`    | `3.8.3`    | matches `@binderly/prettier-config` peer.                   |

### Acceptance criteria results

| AC   | Status   | Proof / paste-able verification                                                                                                                                                                                                                                                         |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | PASS     | `pnpm exec tsx packages/db/scripts/generate.ts --config drizzle.smoke.config.ts` produced `0000_flowery_makkari.sql` matching `^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$`. Output cleaned post-check.                                                                                       |
| AC-2 | DEFERRED | Sandbox cannot reach Docker. Run from main shell: `cd /Users/pmiranda/Stuff/binderly-wt-T-FN-DB-MIGRATIONS && pnpm db:start && pnpm db:migrate:local` (no-op until Phase 1 lands a real schema).                                                                                        |
| AC-3 | PASS     | `cd packages/db && tsc -p . && tsc -p . --noEmit && eslint --max-warnings=0 . && prettier --check .` all exit 0.                                                                                                                                                                        |
| AC-4 | DEFERRED | Same Docker dependency as AC-2. Round-trip command: `pnpm exec tsx packages/db/scripts/generate.ts --config drizzle.smoke.config.ts && pnpm db:migrate:local && psql "$SUPABASE_DB_URL" -c 'select * from _smoke; drop table _smoke;'`, then `git restore packages/db/src/migrations/`. |
| AC-5 | PASS     | The smoke run produced `src/migrations/0000_flowery_makkari.sql` containing real SQL (`CREATE TABLE "_smoke" (...)`) and `src/migrations/meta/_journal.json` as separate metadata. Verified by file inspection before deletion.                                                         |

### Decisions

- **Driver**: `postgres` (postgres-js) per spec. Edge-runtime friendly,
  lighter than `pg`, first-class TS types. Pooling note: postgres-js
  uses a single Postgres connection pool with a `max` parameter; for
  PgBouncer-fronted prod (transaction pool mode) we may need to disable
  prepared statements (`prepare: false`). Documented in
  `packages/db/README.md` "Driver" section so a future schema/data-layer
  task can re-evaluate without re-deriving the choice.
- **Schema barrel**: empty `src/schema/index.ts` ships `export {};`.
  Once Phase-1 schema files land they'll switch to
  `export * from './<feature>.js';` — `verbatimModuleSyntax` is OFF in
  the inherited `@binderly/tsconfig/library.json`, so `export *` from a
  freshly-populated barrel works without ceremony. Confirmed by typecheck.
- **Sequential-name enforcement**: drizzle-kit's default naming
  (`NNNN_<random_two_word>.sql`) already matches the convention regex.
  `scripts/generate.ts` asserts this on every invocation so a future
  drizzle-kit upgrade that changes naming fails the build instead of
  shipping a divergent file.
- **`scripts/migrate.ts`** uses Drizzle's official
  `migrate(db, { migrationsFolder })` from `drizzle-orm/postgres-js/migrator`.
  URL precedence: `--url` flag > `DATABASE_URL` > `SUPABASE_DB_URL`.
  Always closes the postgres-js pool in a `finally` block.

### Sandbox-deferred verification (orchestrator should run)

```bash
cd /Users/pmiranda/Stuff/binderly-wt-T-FN-DB-MIGRATIONS
pnpm db:start
# AC-2: applies the empty migrations folder (no-op until Phase 1 lands).
pnpm db:migrate:local
# AC-4 (full round-trip):
pnpm exec tsx packages/db/scripts/generate.ts --config packages/db/drizzle.smoke.config.ts
pnpm db:migrate:local
psql "$SUPABASE_DB_URL" -c 'select * from _smoke; drop table _smoke;'
# Then restore the migrations folder so the schema barrel stays empty:
git restore packages/db/src/migrations/
pnpm db:stop
```

### Lockfile

`pnpm install --frozen-lockfile` failed with `ERR_PNPM_OUTDATED_LOCKFILE`
(expected — the new package adds deps). Fell back to `pnpm install`
which regenerated `pnpm-lock.yaml` cleanly with all new deps pinned at
the exact versions above. This matches the foundation-stage lockfile
carve-out for new dep additions.

### Escalations

None. The PG17-vs-PG16 question (Supabase 17, Compose 16) is already
inert per `infra/supabase/README.md` — the app schema lives only on
Supabase, so PG17 is what every generated migration targets. Drizzle's
generated SQL uses portable DDL (`CREATE TABLE … PRIMARY KEY DEFAULT
gen_random_uuid()`, `timestamp with time zone DEFAULT now()`) so the
PG16-vs-PG17 distinction is not a live concern for this skeleton.
