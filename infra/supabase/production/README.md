# Supabase — production

Production counterpart to the local Supabase CLI project at
`infra/supabase/` (config, auth docs, Edge Functions, seed). This directory
is **documentation + runbooks** — there is no second live `config.toml`
here (the CLI uses the single `infra/supabase/config.toml`; production
differences are dashboard- and env-driven, enumerated in
[`config.notes.md`](./config.notes.md)).

Scaffolding (Stage 11 / T-DP-SUPABASE-PROD): the migration-apply CI
(`.github/workflows/deploy-db.yml`) is wired and inert until Pablo
provisions the prod project + `PROD_DATABASE_URL` (see
`infra/DEPLOYMENT_SECRETS.md`).

---

## Topology

| Concern              | Local dev                                  | Production                                          |
| -------------------- | ------------------------------------------ | --------------------------------------------------- |
| Postgres + Auth + Storage + Edge | Supabase CLI containers (543xx ports) | Supabase Cloud project (Pro plan, per PROJECT.md § 4) |
| Migrations applied via | `pnpm db:migrate` against `:54322`       | `pnpm db:migrate` against `$PROD_DATABASE_URL` (CI) |
| Schema source        | `packages/db/src/migrations/*.sql`         | identical — same files, applied forward-only        |
| Auth secrets         | placeholders in `config.toml` + `.env.local` | real client IDs/secrets in the Supabase dashboard |

The **app schema lives only on the Supabase Postgres** (PG17). The Compose
Postgres (`infra/docker-compose.yml`, PG16) is data-pipeline staging only
and never receives these migrations (see `infra/supabase/README.md` §
"Postgres version note").

---

## Provisioning + linking flow (Pablo, one time)

```bash
# 1. Create the production project in the Supabase dashboard
#    (https://supabase.com/dashboard) — region close to Vercel `iad1`
#    (e.g. East US). Note the PROJECT REF (the subdomain, e.g. abcdefgh).
#    Set + store the database password (shown once at creation).

# 2. Link the local CLI workdir to the prod project (workdir is `infra`,
#    NOT `infra/supabase` — see infra/supabase/README.md).
pnpm exec supabase link --project-ref <PROJECT_REF> --workdir infra

# 3. Push the non-secret config (auth toggles, storage limits, etc.) from
#    config.toml to the remote project. Review the diff first.
pnpm exec supabase config push --workdir infra

# 4. Provide the migration connection string to CI as a GitHub secret
#    PROD_DATABASE_URL (see infra/DEPLOYMENT_SECRETS.md for the exact
#    connection-string shape + which pooler port to use).
```

Real OAuth credentials (Google / Apple / Discord) and the SMTP provider are
configured in the **dashboard** (Authentication → Providers / Email), not in
the committed `config.toml`. See `infra/supabase/auth/*.md`.

---

## Migrations

The migration-apply flow, idempotency guarantees, rollback story, and
staging-first guidance live in [`migration-runbook.md`](./migration-runbook.md).

TL;DR: every push to `main` that touches `packages/db/src/migrations/**`
runs `pnpm db:migrate` against the prod DB via CI — forward-only, journal-
tracked, non-destructive.
