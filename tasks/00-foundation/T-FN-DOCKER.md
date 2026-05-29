# T-FN-DOCKER — Docker Compose for local dev

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** M
**Status:** merged

## Hard dependencies
- T-FN-MONOREPO

## Soft dependencies
- T-FN-TS-CONFIG, T-FN-LINT-CONFIG, T-FN-GITHUB (parallel-safe)

## Required reading
- rules/00-foundation.md
- context/tech-stack.md (Local development)
- context/secrets-and-env.md

## Goal
Provide a Docker Compose stack that brings up Postgres, MinIO (R2
emulator), and Mailpit (magic link emails). This stack is the default for
local development and runs alongside the Supabase CLI's own stack
(T-FN-SUPABASE-LOCAL handles supabase services). Configure ports so they
don't collide.

## Deliverables

- `infra/docker-compose.yml`:
  - `postgres` service: postgres:16, port 5433 (avoid Supabase's 54322
    conflict), user/password/db from env vars defaulting to dev values,
    volume mount for data persistence.
  - `minio` service: `minio/minio:latest` (pin a digest), port 9000
    (API) + 9001 (console), default access key `minio` / secret
    `miniominio`. Healthcheck.
  - `minio-init` service: a one-shot container that creates the buckets
    `images`, `models`, `ann`, `user-uploads` on stack start using
    `mc`.
  - `mailpit` service: `axllent/mailpit`, ports 1025 (smtp) + 8025
    (web ui).
- `infra/docker/postgres/init.sql` — minimal init: extensions
  (`citext`, `pg_trgm`, `pgcrypto`).
- `.env.example` (root) — values for the docker stack (DATABASE_URL,
  MinIO keys, SMTP host/port). Marked as dev-only.
- `infra/README.md` — how to start, stop, reset, view logs, common
  troubleshooting (ports in use, etc.).

## Acceptance criteria

- [ ] `docker compose -f infra/docker-compose.yml up -d` brings the
      stack up cleanly on a fresh machine.
- [ ] Postgres reachable on `localhost:5433` with the documented
      credentials.
- [ ] MinIO reachable; the four buckets exist after `up`.
- [ ] Mailpit web UI accessible at `localhost:8025`.
- [ ] `docker compose down -v` cleans up volumes; subsequent `up`
      starts fresh.
- [ ] No file modified outside `infra/`, `.env.example`, and a one-line
      mention in the root `README.md` pointing at `infra/README.md`.

## Out of scope

- Wiring the Python services into compose — they get added when those
  apps land. Compose stays minimal here.
- Supabase services — T-FN-SUPABASE-LOCAL.

## Branch & PR

- Branch: `agent/T-FN-DOCKER`
- PR title: `T-FN-DOCKER: Docker Compose for local dev`

## Escalation triggers

- Apple Silicon vs Intel image availability for any of the chosen
  containers.
- Port conflicts with Supabase CLI (5432, 54321, 54322, 54323, 54324).

## Notes from execution

### Pinned image digests (all native linux/arm64 — no emulation on Apple Silicon)

| Service     | Tag                                          | Digest |
|-------------|----------------------------------------------|--------|
| postgres    | `16.13`                                      | `sha256:71e27bf60b70bded003791b5573f8b808365613f341df20ffcf0c1ed7bc13ddf` |
| minio       | `RELEASE.2025-09-07T16-13-09Z`               | `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` |
| minio-init  | `minio/mc:RELEASE.2025-08-13T08-35-41Z`      | `sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727` |
| mailpit     | `axllent/mailpit:v1.29.7`                    | `sha256:757f22b56c1da03570afdb3d259effe5091018008a81bbedc8158cee7e16fdbc` |

Both tag and digest are pinned in `infra/docker-compose.yml` so a `docker
compose pull` upgrade requires editing both fields and re-smoke-testing.

### Acceptance criteria verification

- `up -d` brings all 4 services up cleanly on a fresh machine (volumes + network created from nothing). `minio-init` exits 0 after `mc mb` finishes.
- Postgres reachable on `localhost:5433` with creds `binderly:binderly@/binderly`. Connected via host `psql` and verified `pg_extension` lists `citext`, `pg_trgm`, `pgcrypto`, `plpgsql`.
- MinIO live (`/minio/health/live` → 200), console on `:9001`, the four buckets `images / models / ann / user-uploads` exist after first `up` (verified via `mc ls local/`).
- Mailpit web UI returns 200 on `GET http://localhost:8025/` (sends 405 on `HEAD`, which is normal — it's a single-page app, not a static file server).
- `down -v` removes containers, named volumes (`binderly-postgres-data`, `binderly-minio-data`), and the network in one call. Subsequent `up -d` re-runs the Postgres init script on the fresh volume and the bucket bootstrap on the fresh MinIO data, confirming idempotent fresh state.

### Healthchecks

- `postgres`: `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`, 5s/5s/10 retries, 10s start_period.
- `minio`: in-container `curl -fsS http://localhost:9000/minio/health/live` (the pinned MinIO image has both `curl` and `mc` baked in — verified). Same cadence as Postgres.
- `minio-init`: no healthcheck (one-shot). Waits on `minio: condition: service_healthy` via `depends_on` so bucket creation never races MinIO startup.
- `mailpit`: relies on the image's built-in healthcheck (`HEALTHCHECK` baked into `axllent/mailpit:v1.29.7`); status reports `(healthy)` without us declaring one.

### Port choices (none collide with Supabase CLI's 5432 / 54321-54324)

- Postgres host **5433** (container 5432).
- MinIO API **9000**, console **9001** (upstream defaults).
- Mailpit SMTP **1025**, web **8025** (upstream defaults).

All are overridable via `.env` (`POSTGRES_PORT`, `MINIO_API_PORT`, etc.) without editing the compose file, so a developer with a clash on any of these can bypass without touching the repo.

### Deviations / things to know

- The `version:` top-level key is intentionally omitted (Compose v2 ignores it; v3 deprecated it).
- A `name: binderly` top-level key sets the project namespace, which gives stable container names (`binderly-postgres` etc.) and stable named volumes (`binderly-postgres-data`, `binderly-minio-data`) regardless of the directory the compose command runs from. Worktree-friendly.
- `init.sql` is mounted into `/docker-entrypoint-initdb.d/00-extensions.sql` (not `init.sql`) so any future scripts dropped in by other tasks can be ordered alphabetically. The `00-` prefix asserts ours runs first.
- Default credentials are `binderly:binderly` for Postgres and `minio:miniominio` for MinIO. Hard-coded into compose defaults; overridable via `.env`. **Dev-only** — `secrets-and-env.md` calls out that `.env.example` placeholders are not real secrets.
- `.env.example` lives at the repo root because Compose auto-loads `.env` next to the calling directory's parent and we want a single canonical env file across the monorepo (per `T-FN-ENV-CONVENTIONS` heuristic). `T-FN-ENV-CONVENTIONS` may want to refactor the layout / scope; this version is shaped to match the canonical names already documented in `context/secrets-and-env.md`.
- `infra/README.md` is the operational reference for Pablo / future agents. The root `README.md` is **not** modified — the spec allows a one-line pointer there but it wasn't strictly necessary, so it's left untouched to keep the diff minimal. If a downstream task wants the pointer, that task can add it.

### Notes for downstream tasks

- **T-FN-SUPABASE-LOCAL**: ports here (5433, 9000-9001, 1025, 8025) are all free on Pablo's box and don't touch Supabase's 5432 / 54321-54324. Reuse the healthcheck pattern (5s / 5s / 10 retries / 10s start_period) for parity.
- **T-FN-DB-MIGRATIONS**: canonical local DSN is `postgresql://binderly:binderly@localhost:5433/binderly` (also exported as `DATABASE_URL` in `.env.example`). Extensions `citext`, `pg_trgm`, `pgcrypto` are pre-installed by `init.sql`, so migrations may assume them.
- **T-FN-ENV-CONVENTIONS**: `.env.example` has the basic shape (DEV-only at top, app-scoped vars below, `# REQUIRED` markers on real-secret holes). That task may refactor structure; the variable names follow `context/secrets-and-env.md` already.
