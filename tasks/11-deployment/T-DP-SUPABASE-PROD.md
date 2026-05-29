# T-DP-SUPABASE-PROD — Supabase production project + migrations CI

**Stage:** 11-deployment
**Agent role:** devops
**Effort:** M
**Status:** merged

## Hard dependencies
- T-DL-RLS-POLICIES (merged — the RLS posture the prod DB must enforce)

## Soft dependencies
- All schema/migration tasks (the 25 migrations in `packages/db/src/migrations/`)

## Required reading
- PROJECT.md § 4 (Infra & Deployment), § 5 (Auth)
- rules/11-deployment.md (esp. "Migrations run before app deploy", rollback rules)
- infra/supabase/config.toml, infra/supabase/README.md (local config to diff from)
- packages/db/scripts/migrate.ts, packages/db/package.json (`db:migrate` path)

## Goal
Stand up the production Supabase project documentation + the
migration-apply CI. On merge to `main` that touches
`packages/db/migrations/**` (and on manual dispatch), apply pending Drizzle
SQL migrations to the production Postgres via the repo's `db:migrate` script
against `$PROD_DATABASE_URL`. Must be **idempotent and non-destructive** (no
auto-reset). Guarded on the prod DB secret so it no-ops until provisioned.

## Deliverables
- `infra/supabase/production/README.md` — prod project linking flow
  (`supabase link --project-ref`), the prod-vs-local `config.toml` diff
  (SMTP, OAuth secrets, network restrictions, SSL enforcement), and how
  prod differs from local dev.
- `infra/supabase/production/config.notes.md` — annotated diff of which
  `config.toml` blocks change for production and why (no second live config
  file — the CLI uses the single `infra/supabase/config.toml`; prod overrides
  are dashboard + env-driven).
- `infra/supabase/production/migration-runbook.md` — apply flow, rollback
  story (down-migration file or PITR restore), staging-first guidance.
- `.github/workflows/deploy-db.yml` — push-to-`main`
  (`packages/db/migrations/**` + the migrate script + workflow) +
  `workflow_dispatch`; runs `pnpm db:migrate` against `PROD_DATABASE_URL`,
  guarded on the secret.

## Acceptance criteria
- [ ] `deploy-db.yml` is valid YAML, path-filtered to the migration sources,
      reuses the repo's pnpm/corepack setup block, and runs `pnpm db:migrate`.
- [ ] The migrate step is skipped (not failed) when `PROD_DATABASE_URL` is absent.
- [ ] The workflow uses the additive `db:migrate` (drizzle migrator) path —
      never `db reset` / `drizzle-kit push` — so it is idempotent + non-destructive.
- [ ] Rollback + staging-first guidance documented in the runbook.
- [ ] The prod project linking flow + config diff are documented.
- [ ] No changes outside `owns_paths` (+ shared `infra/DEPLOYMENT_SECRETS.md`).

## Out of scope
- Provisioning the real prod Supabase project / DB password (Pablo, go-live).
- Edge Function deploys (separate; the functions tree is owned elsewhere).
- Migration ordering vs app deploy at the org level beyond documenting it.

## Branch & PR
- Branch: `agent/T-DP-INFRA`
- PR title: `feat(deploy): T-DP-VERCEL/FLY/SUPABASE-PROD/R2-PROD — Stage 11 deployment scaffolding (secrets pending)`

## Notes from execution
The repo applies migrations with `drizzle-orm/postgres-js/migrator` via
`packages/db/scripts/migrate.ts`, which resolves the target from `--url` >
`DATABASE_URL` > `SUPABASE_DB_URL`. The workflow sets `DATABASE_URL` to the
`PROD_DATABASE_URL` secret. The drizzle migrator tracks applied migrations in
its journal table, so re-runs are no-ops on already-applied migrations
(idempotent). The migrations live at `packages/db/src/migrations/` (the
dependencies.yaml `owns_paths` says `packages/db/migrations/**`; the workflow
path filter matches both spellings defensively).
