# Binderly local infrastructure

Docker Compose stack for local development. Brings up the **non-Supabase**
backing services that Binderly needs: Postgres, MinIO (R2 emulator with
auto-created buckets), and Mailpit (capture-everything dev SMTP).

The Supabase services (Auth, Storage, Edge Functions, Studio, gateway)
run separately via the **Supabase CLI** — see
[`infra/supabase/README.md`](./supabase/README.md). Host ports here are
picked so the two stacks can run side-by-side.

---

## Quickstart

```bash
# from the repo root
cp .env.example .env                                # one time
docker compose -f infra/docker-compose.yml up -d
```

That's it. On the very first `up` Postgres runs
`docker/postgres/init.sql` (creates extensions) and `minio-init` creates
the four buckets, then exits 0. Subsequent `up`s are fast.

Verify:

```bash
docker compose -f infra/docker-compose.yml ps
# postgres + minio + mailpit -> running (healthy where applicable)
# minio-init                  -> exited (0)
```

| Service  | Host URL                                 | Notes                              |
|----------|------------------------------------------|------------------------------------|
| Postgres | `postgresql://binderly:binderly@localhost:5433/binderly` | extensions: citext, pg_trgm, pgcrypto |
| MinIO API     | `http://localhost:9000`             | S3-compatible, path-style          |
| MinIO console | `http://localhost:9001`             | login: `minio` / `miniominio`      |
| Mailpit SMTP  | `localhost:1025`                    | no auth, accepts everything        |
| Mailpit web   | `http://localhost:8025`             | dev inbox UI                       |

Default buckets (created by `minio-init`): `images`, `models`, `ann`,
`user-uploads`.

---

## Common operations

```bash
# Start
docker compose -f infra/docker-compose.yml up -d

# Stop (keep data)
docker compose -f infra/docker-compose.yml stop

# Stop + remove containers (keep volumes)
docker compose -f infra/docker-compose.yml down

# Full reset — wipe Postgres data + MinIO buckets, re-init from scratch
docker compose -f infra/docker-compose.yml down -v

# Tail logs
docker compose -f infra/docker-compose.yml logs -f
docker compose -f infra/docker-compose.yml logs -f postgres
docker compose -f infra/docker-compose.yml logs -f minio

# psql shell into the local Postgres
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U binderly -d binderly

# mc shell against the local MinIO
docker compose -f infra/docker-compose.yml run --rm minio-init \
  /bin/sh -c 'mc alias set local http://minio:9000 minio miniominio && mc ls local'
```

---

## Environment variables

The stack reads from the repo-root `.env` file (loaded automatically by
Compose because the file lives next to `docker-compose.yml`'s parent).
All variables have safe dev defaults inside the compose file itself —
running with no `.env` works too.

The variables the stack consumes are the four blocks at the top of
`.env.example`:

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / POSTGRES_PORT
MINIO_ROOT_USER / MINIO_ROOT_PASSWORD / MINIO_API_PORT / MINIO_CONSOLE_PORT
MAILPIT_SMTP_PORT / MAILPIT_WEB_PORT
DATABASE_URL / SMTP_HOST / SMTP_PORT / S3_ENDPOINT_URL
```

Override any of them in `.env` to dodge a port collision or to match a
non-default credential expectation downstream.

---

## Pinned images

Every image is pinned by both **tag and digest** for reproducibility and
to make supply-chain audits easy. All four have native `linux/arm64`
manifests, so Apple Silicon runs them without emulation.

| Service     | Image                                                   |
|-------------|---------------------------------------------------------|
| postgres    | `postgres:16.13` — sha256:`71e27bf6…0c1ed7bc13ddf`       |
| minio       | `minio/minio:RELEASE.2025-09-07T16-13-09Z` — sha256:`14cea493…0462bd8936e` |
| minio-init  | `minio/mc:RELEASE.2025-08-13T08-35-41Z` — sha256:`a7fe349e…bdf11727`       |
| mailpit     | `axllent/mailpit:v1.29.7` — sha256:`757f22b5…5cee7e16fdbc`                 |

To upgrade: pull the new tag, run
`docker inspect --format '{{index .RepoDigests 0}}' <image>:<tag>`,
update both the tag and the digest in `infra/docker-compose.yml`, smoke
the stack, commit.

---

## Why these ports?

| Port  | Service          | Why this port                                  |
|-------|------------------|------------------------------------------------|
| 5433  | Postgres         | avoid host Postgres on 5432 and Supabase CLI's Postgres on 54322 |
| 9000  | MinIO API        | upstream default                                |
| 9001  | MinIO console    | upstream default                                |
| 1025  | Mailpit SMTP     | upstream default                                |
| 8025  | Mailpit web      | upstream default                                |

Supabase CLI reserves **5432, 54321, 54322, 54323, 54324** — none of
which we touch. If a port still collides on your machine, override via
`.env` (e.g. `POSTGRES_PORT=5544`) and update the URL constants
downstream.

---

## Troubleshooting

**`bind: address already in use`** — something else is on the port.
Find it with `lsof -nP -i :5433` (substitute the port), kill it, or set
the corresponding `*_PORT` in `.env` to something free.

**`pg_isready` keeps failing** — usually a corrupt data volume from an
earlier crash. `docker compose -f infra/docker-compose.yml down -v` and
re-up.

**MinIO health endpoint flapping** — hardly ever, but if so:
`docker compose -f infra/docker-compose.yml logs minio`. The healthcheck
hits `/minio/health/live` via in-container `curl`; both the binary and
the endpoint exist in the pinned image.

**`minio-init` shows "exited (1)"** — most often a transient race where
MinIO had not yet finished its first-time setup. `docker compose
-f infra/docker-compose.yml up -d minio-init` re-runs just the bootstrap.

**Init SQL didn't run** — Postgres' init scripts only run on a *fresh*
data volume. If you see `pg_extension` missing extensions, you need
`docker compose -f infra/docker-compose.yml down -v` to wipe the volume
and trigger the init again.

**Apple Silicon / ARM** — every image has a native arm64 manifest. If
`docker compose up` ever logs platform-mismatch warnings, file an issue
— it means a digest drifted under us.

**Conflict with the Supabase CLI stack** — both stacks are designed to
coexist. If you see weirdness, run `supabase status` and confirm only
54321-54324 + 5432 are in use on the Supabase side.
