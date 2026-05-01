# T-FN-ENV-CONVENTIONS — Environment variable conventions and .env.example

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** pending

## Hard dependencies
- T-FN-DOCKER

## Soft dependencies
- T-FN-SUPABASE-LOCAL, T-FN-ORCHESTRATOR-SCRIPTS (parallel-safe)

## Required reading
- rules/00-foundation.md
- context/secrets-and-env.md

## Goal
Codify the env var naming convention and produce the canonical
`.env.example` and `docs/env.md`. Subsequent tasks add their own vars to
both files in the same convention.

## Deliverables

- `.env.example` — every var listed in `context/secrets-and-env.md`,
  organized by scope (`# ===== WEB =====`, `# ===== MOBILE =====`,
  etc.), with dev-default values where applicable and `# REQUIRED` for
  secrets. Includes the docker compose stack defaults from T-FN-DOCKER
  and the Supabase locals from T-FN-SUPABASE-LOCAL.
- `docs/env.md` — human-readable reference: every var, what it's for,
  where to get it, which scope owns it, whether it's required for local
  dev or production-only.
- `scripts/check-env.sh` — bash script that validates a target env file
  against `.env.example`: every var in example must be present (value
  can be empty for non-required), no extra vars unless tagged `#
  EXTRA-OK`. Exit non-zero on mismatch.
- `package.json` (root) — add script `check:env` →
  `bash scripts/check-env.sh .env.local`.

## Acceptance criteria

- [ ] `.env.example` covers every var documented in
      `context/secrets-and-env.md` at the time of this task.
- [ ] `pnpm check:env` against `.env.example` itself passes (vacuously
      — example matches example).
- [ ] `pnpm check:env` against a deliberately broken `.env.local`
      fails with a clear message.
- [ ] `docs/env.md` is up to date and clear.
- [ ] No file modified outside `.env.example`, `docs/env.md`,
      `scripts/check-env.sh`, root `package.json`.

## Out of scope

- Per-app `env.d.ts` typed access — added with each app.
- Loading env files into apps — handled per-app (Next.js, Expo, etc.
  each have their own conventions).

## Branch & PR

- Branch: `agent/T-FN-ENV-CONVENTIONS`
- PR title: `T-FN-ENV-CONVENTIONS: Environment variables and .env.example`

## Escalation triggers

- A naming convention conflict surfaces (e.g., a third-party SDK
  *requires* a specific env var name that breaks our scoped scheme).
  Resolution: keep the SDK's required name and document the exception.

## Notes from execution
_(empty)_
