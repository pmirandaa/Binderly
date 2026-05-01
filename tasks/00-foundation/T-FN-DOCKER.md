# T-FN-DOCKER — Docker Compose for local dev

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** M
**Status:** pending

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
_(empty)_
