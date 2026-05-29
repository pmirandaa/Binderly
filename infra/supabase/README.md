# Binderly — local Supabase

Supabase CLI project for local development. Brings up the **app-facing**
backend — Auth (Google / Apple / Discord / magic link), Postgres, REST,
Realtime, Storage, Edge Functions runtime, and Studio. Coexists with the
non-Supabase services in `infra/docker-compose.yml` (Postgres, MinIO,
Mailpit) on disjoint ports.

This stack is owned by `T-FN-SUPABASE-LOCAL`. Migrations are deferred to
`T-FN-DB-MIGRATIONS`.

---

## Prerequisites

- Docker Desktop running (Supabase services run as containers).
- Repo bootstrap done: `pnpm install` from the repo root. This pulls the
  pinned `supabase` CLI as a workspace dev dependency, so no global
  install is required and every developer is on the same version.

Verify the CLI is available:

```bash
pnpm exec supabase --version
# → 2.98.1
```

If you'd rather use a globally installed CLI, `brew install
supabase/tap/supabase` works too — just keep the version in sync with
the pin in root `package.json` (`devDependencies.supabase`). The pinned
version is the source of truth.

---

## Pinned versions

| Tool                   | Version | Source                               |
|------------------------|---------|--------------------------------------|
| Supabase CLI           | `2.98.1` | root `package.json` devDependencies |
| Supabase Postgres      | major `17` | `config.toml` `[db].major_version` |

`major_version = 17` is the Supabase CLI default in 2.98.x and matches
what Supabase Cloud provisions for new projects today. The Compose
Postgres at `infra/docker-compose.yml` is a *separate* database pinned
at PG16 used by data-pipeline workflows; the two never share data, so
the version difference is intentional and inert. See
"Postgres version note" below.

---

## Quickstart

From the repo root:

```bash
# Start (first run pulls Supabase's container images — 5–10 min on a
# cold cache; subsequent starts are ~30s).
pnpm db:start

# Show endpoints + dev keys (anon, service-role, db url).
pnpm exec supabase status --workdir infra

# Stop (keeps the volume; data persists across restarts).
pnpm db:stop

# Reset database — drops + reapplies migrations + reapplies seed.sql.
pnpm db:reset
```

| Service          | URL                                                  |
|------------------|------------------------------------------------------|
| API (REST/Auth)  | `http://localhost:54321`                             |
| Postgres         | `postgresql://postgres:postgres@localhost:54322/postgres` |
| Studio           | `http://localhost:54323`                             |
| Inbucket (mail)  | `http://localhost:54324`                             |

The dev-only anon and service-role keys are pre-populated in
`.env.example` under the `# ===== SUPABASE LOCAL =====` block.
`supabase status` prints the live values if you ever need to re-check.

---

## Port plan

The Supabase CLI reserves the **543xx** range and never collides with
the Compose stack. Quick reference for the whole repo's local ports:

| Port  | Stack                              | Service          |
|-------|------------------------------------|------------------|
| 1025  | Compose (`infra/docker-compose.yml`) | Mailpit SMTP   |
| 5433  | Compose                            | Postgres         |
| 8025  | Compose                            | Mailpit web      |
| 9000  | Compose                            | MinIO API        |
| 9001  | Compose                            | MinIO console    |
| 54321 | Supabase CLI                       | API gateway      |
| 54322 | Supabase CLI                       | Postgres (app)   |
| 54323 | Supabase CLI                       | Studio           |
| 54324 | Supabase CLI                       | Inbucket (mail)  |
| 54327 | Supabase CLI                       | Analytics        |

If anything binds 54321–54327 on your box, edit the corresponding
`port` in `config.toml` and bump the matching env var in `.env.local`.

---

## Auth providers

`config.toml` ships with **Google**, **Apple**, **Discord**, and
**email magic-link** enabled with placeholder values so that all four
appear in Studio out of the box. OAuth round-trips will fail until real
client IDs and secrets are configured (the secrets are wired through
`env(...)` substitution from your `.env.local`).

To plug real values:

1. Edit `infra/supabase/config.toml` and replace the
   `REPLACE_WITH_*_OAUTH_CLIENT_ID` placeholder under the relevant
   `[auth.external.<provider>]` block with your real client ID.
2. Set the corresponding secret in `.env.local`:
   - Google → `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
   - Apple → `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` (a signed JWT from
     Apple — see Supabase docs for generation)
   - Discord → `SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET`
3. Restart with `pnpm db:stop && pnpm db:start`.

Magic-link / email OTP works locally without extra config: outbound
emails are captured by Inbucket on `localhost:54324`.

---

## Migrations and seeds

Migration tooling has landed (`T-FN-DB-MIGRATIONS`). Binderly's schema
migrations are **plain SQL files committed under
`packages/db/src/migrations/`** and applied by the Drizzle migrator
(`packages/db/scripts/migrate.mjs`), **not** by `supabase migration
up`. We deliberately do not keep a second copy of the SQL under
`infra/supabase/migrations/` — `packages/db` is the single source of
truth, and the migrator targets whatever Postgres URL it is given.

The canonical local loop, against the Supabase CLI Postgres on `54322`:

```bash
pnpm db:start          # bring up local Supabase (Postgres on 54322)
pnpm db:migrate:local  # apply packages/db/src/migrations/*.sql to $SUPABASE_DB_URL
```

`db:migrate:local` resolves the target URL from `SUPABASE_DB_URL`
(pre-populated in `.env.example`); pass `--url <postgres://…>` to point
elsewhere (e.g. CI hitting cloud Supabase, or the Compose Postgres on
5433 for a one-off). The migrator degrades gracefully: if the journal
(`packages/db/src/migrations/meta/_journal.json`) is missing, empty, or
unparseable it logs a clear message and exits 0 rather than throwing, so
a fresh checkout with no migrations is a no-op rather than an error. See
[`packages/db/README.md`](../../packages/db/README.md) for the full
generate → review → apply workflow.

The seed file is `seed.sql` and is currently empty — fixture tasks in
stage 01 populate it. `pnpm db:reset` drops the database, reapplies the
Supabase CLI's own migration directory (intentionally empty here), and
reruns `seed.sql`; it does **not** apply the `packages/db` SQL, so after
a reset re-run `pnpm db:migrate:local` to restore the app schema.

> **Why `--workdir infra` and not `--workdir infra/supabase`?** The
> Supabase CLI expects a project layout where `<workdir>/supabase/`
> contains `config.toml`. Our config lives at
> `infra/supabase/config.toml`, so the workdir is `infra`. The scripts
> in root `package.json` already pass the right flag — you only need to
> remember this for ad-hoc `supabase` invocations.

---

## Troubleshooting

**"Cannot connect to the Docker daemon"** — Docker Desktop isn't
running. Start it (or `colima start` if you use colima), wait for the
whale icon to settle, retry `pnpm db:start`.

**"port already in use" on 54321–54327** — something else is bound to
the Supabase port. Find it with `lsof -nP -i :54321` (substitute the
port), kill it, or override the port in `config.toml`. The Compose
stack never uses these ports, so the offender is something else.

**`pnpm db:start` hangs at "Pulling images"** — first run downloads
~3 GB of container images. Be patient. If it actually stalled, `^C`,
ensure Docker has internet, retry.

**"unable to connect to the gotrue/storage/edge service"** — usually
means a stale container from a previous run. `pnpm db:stop` then
`pnpm db:start`. If that doesn't clear it, `pnpm exec supabase stop
--workdir infra/supabase --no-backup` removes all containers and
volumes, then start fresh.

**Compose Postgres on 5433 unreachable while Supabase runs** — both
stacks should run side-by-side. Verify both with `docker ps`; you
should see `binderly-postgres` (Compose) AND `supabase_db_binderly`
(Supabase CLI). If only one is up, run the relevant `up`.

**"can't apply migrations / wrong PG version"** — see the version
note below.

---

## Postgres version note

The Supabase CLI runs Postgres **17** locally; the Compose Postgres in
`infra/docker-compose.yml` runs Postgres **16**. This is intentional:

- The **app schema** (auth, RLS, app tables) lives **only** on the
  Supabase Postgres (54322). Production runs Supabase Cloud, which is
  PG17 today.
- The **Compose Postgres** (5433) is for **data-pipeline workflows** —
  ETL/ingestion staging that doesn't sync to Supabase.

So the two never share migrations or rows; PG16-vs-PG17 drift is
inert. If a future task needs the two stacks to share schema, surface
it to the orchestrator (escalation trigger documented in
`tasks/00-foundation/T-FN-SUPABASE-LOCAL.md`).
