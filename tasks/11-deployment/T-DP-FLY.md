# T-DP-FLY — Fly.io deployment for the Python service

**Stage:** 11-deployment
**Agent role:** devops
**Effort:** M
**Status:** merged (scaffolding; live deploy blocked on an HTTP entrypoint — see Q-021)

## Hard dependencies
- T-SC-ANN-INDEX (merged — ANN index build path)
- T-GR-AGGREGATE (merged — grading aggregate path)

## Soft dependencies
- T-DP-R2-PROD (the Python service reads/writes R2 artefacts in prod)

## Required reading
- PROJECT.md § 3 (Tech Stack — "Heavy services | Python (FastAPI) on Fly.io"), § 4
- rules/11-deployment.md
- apps/api-python/README.md, apps/api-python/pyproject.toml (deps + entrypoints)
- .github/workflows/ci-python.yml (the Python CI conventions)

## Goal
Scaffold the Fly.io deployment for the Binderly Python service
(`apps/api-python/`): a `fly.toml`, a `Dockerfile` that builds the package
with its runtime deps, and a `deploy-fly` workflow that deploys on merge to
`main` (api-python-path-filtered) + manual dispatch, guarded on
`secrets.FLY_API_TOKEN`. Inert until the token is provisioned.

## Escalation outcome (Q-021)
`apps/api-python/` currently ships **only batch/CLI jobs** (`embeddings/`,
`ann/`, `grading/` modules + console scripts in `pyproject.toml`
`[project.scripts]`). There is **no FastAPI/ASGI HTTP server** despite
PROJECT.md § 3 naming "Python (FastAPI) on Fly.io". A live Fly app that
serves traffic + passes a healthcheck needs an HTTP entrypoint (and
`fastapi`/`uvicorn` added to deps) — which is application source owned by the
Python track, not config. Per the dispatch rules this is escalated as **Q-021**
and the entrypoint is logged as a follow-up. This task ships everything that
is pure config/docs and is correct the moment the entrypoint lands.

## Deliverables
- `infra/fly/fly.toml` — app-name placeholder, `internal_port` 8080, HTTP
  service + `/healthz` http check, primary region, small shared-cpu VM defaults.
- `infra/fly/Dockerfile` — python:3.12-slim base, installs the api-python
  package (runtime extras only; TF/torch excluded), non-root user, `CMD`
  launching uvicorn against the documented future entrypoint.
- `infra/fly/.dockerignore` — keep the build context lean.
- `infra/fly/README.md` — what runs here, the Q-021 entrypoint prerequisite,
  rollback (`fly releases rollback`), and the go-live checklist pointer.
- `.github/workflows/deploy-fly.yml` — push-to-`main` (`apps/api-python/**`) +
  `workflow_dispatch`; `flyctl deploy` guarded on `FLY_API_TOKEN`.

## Acceptance criteria
- [ ] `infra/fly/fly.toml` parses as valid TOML and declares an internal port,
      an HTTP healthcheck path, a region, and VM sizing.
- [ ] `infra/fly/Dockerfile` builds the api-python package deps and runs as a
      non-root user; lints clean under hadolint (or careful manual review).
- [ ] `deploy-fly.yml` is valid YAML, path-filtered to `apps/api-python/**`,
      and the deploy step is skipped (not failed) when `FLY_API_TOKEN` is absent.
- [ ] The missing HTTP entrypoint is escalated as Q-021 + logged as a follow-up.
- [ ] No edits to feature code under `apps/api-python/` (Dockerfile lives in `infra/fly/`).

## Out of scope
- Adding the FastAPI entrypoint + `fastapi`/`uvicorn` deps (Q-021 follow-up, Python track).
- Provisioning the Fly app / token (Pablo, at go-live).
- Splitting batch jobs vs the serving app across multiple Fly apps (revisit post-entrypoint).

## Branch & PR
- Branch: `agent/T-DP-INFRA`
- PR title: `feat(deploy): T-DP-VERCEL/FLY/SUPABASE-PROD/R2-PROD — Stage 11 deployment scaffolding (secrets pending)`

## Notes from execution
Dockerfile installs from `apps/api-python` (build context is the repo root so
the package tree is visible). It deliberately does NOT install the `build`
(TensorFlow ~500 MB) or `ml` (torch ~2 GB) extras — the serving runtime needs
only `ai-edge-litert` + opencv-headless + httpx etc. The `CMD` targets
`binderly_api.main:app` (the entrypoint Q-021/the follow-up will add); until
then the image builds but the container has no server to bind `:8080`, so the
Fly deploy stays inert behind `FLY_API_TOKEN` regardless.
