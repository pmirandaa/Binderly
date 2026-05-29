# Fly.io — Binderly Python service

Production deploy config for `apps/api-python` (the offline/server-side
Python pieces: embeddings, ANN index builds, grading, scrapers). Per
`PROJECT.md` § 3–4, heavy Python services run on Fly.io (1 small VM,
combine where reasonable).

This directory is **scaffolding** (Stage 11 / T-DP-FLY). It ships the
deploy config + container build; the live deploy is inert until Pablo
provisions a Fly app + `FLY_API_TOKEN`, **and** the service grows an HTTP
entrypoint (see the Q-021 prerequisite below).

---

## ⚠️ Prerequisite: HTTP entrypoint (Q-021)

`apps/api-python/` currently ships **only batch/CLI jobs** — `embeddings/`,
`ann/`, `grading/` modules plus the console scripts in `pyproject.toml`
`[project.scripts]`. There is **no FastAPI/ASGI HTTP server**, even though
`PROJECT.md` names "Python (FastAPI) on Fly.io".

A Fly app that serves traffic and passes a healthcheck needs:

1. An ASGI app module — `binderly_api.main:app` — exposing at minimum
   `GET /healthz` (and, eventually, the grading/recognition endpoints
   referenced by #FU-46 / `T-GR-SERVING`).
2. `fastapi` + `uvicorn[standard]` added to the `dependencies` in
   `apps/api-python/pyproject.toml`.

Both are **application source** owned by the Python track, not deploy
config, so they're out of scope for this task and tracked as a follow-up
(see `status.md` Known Follow-ups, the Stage 11 go-live item, and
`open-questions.md` Q-021). `fly.toml` + `Dockerfile` are written to be
correct the moment that entrypoint lands.

If instead Fly is meant to host **batch/cron jobs** (no long-running
server), the topology changes (a `[processes]` worker or scheduled
machines instead of `[http_service]`). That's the decision Q-021 asks
Pablo to make.

---

## Files

| File           | Purpose                                                             |
| -------------- | ------------------------------------------------------------------- |
| `fly.toml`     | App config: internal port 8080, `/healthz` HTTP check, region, VM.  |
| `Dockerfile`   | python:3.12-slim image; installs api-python runtime deps; non-root. |
| `.dockerignore`| Trims the build context (excludes the JS monorepo + model blobs).   |

The image installs **runtime deps only** — not the `build` (TensorFlow) or
`ml` (torch) extras, which are offline-training-only.

---

## Go-live (Pablo, once provisioned)

```bash
# 1. Authenticate + create the app (one time).
fly auth login
fly apps create binderly-api          # or pick a name; update fly.toml `app`

# 2. Set runtime secrets the service needs (R2 keys, DB url, etc. — see
#    infra/DEPLOYMENT_SECRETS.md for the full list).
fly secrets set R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... --app binderly-api

# 3. Mint a deploy token for CI and add it to GitHub as FLY_API_TOKEN.
fly tokens create deploy --app binderly-api
#   → GitHub repo → Settings → Secrets and variables → Actions → New secret
#     name: FLY_API_TOKEN

# 4. First deploy (after the HTTP entrypoint lands — see Q-021):
fly deploy --config infra/fly/fly.toml
```

After that, every push to `main` touching `apps/api-python/**` (or this
config) auto-deploys via `.github/workflows/deploy-fly.yml`.

## Rollback

```bash
fly releases --app binderly-api          # list releases
fly releases rollback --app binderly-api # roll back to the previous release
```

(Per `rules/11-deployment.md`: "Fly: `fly releases rollback`.")

## Local image smoke (optional)

```bash
# From the repo root (build context must be the root so apps/api-python
# is visible to the Dockerfile COPY).
docker build -f infra/fly/Dockerfile -t binderly-api:local .
# Note: the container has no server to run until the Q-021 entrypoint lands;
# this only verifies the image builds + deps install.
```
