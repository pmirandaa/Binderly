# T-FN-CI — GitHub Actions CI skeleton

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** M
**Status:** pending

## Hard dependencies
- T-FN-MONOREPO
- T-FN-TS-CONFIG
- T-FN-LINT-CONFIG
- T-FN-GITHUB

## Soft dependencies
_(none)_

## Required reading
- rules/00-foundation.md
- context/conventions.md
- context/secrets-and-env.md

## Goal
Create GitHub Actions workflows for the always-on CI pipeline: lint,
typecheck, test, build. Workflows must run on PRs and on push to `main`.
Cache pnpm, Turbo, and node_modules. Use Turbo's remote cache when
configured (env-only; no signup required as part of this task).

## Deliverables

- `.github/workflows/ci.yml` — main pipeline:
  - `lint` job (eslint + prettier check)
  - `typecheck` job
  - `test` job
  - `build` job
  - All four run in parallel; matrix is unnecessary at this scale
  - Uses `actions/setup-node@v4` with `corepack enable`
  - Caches `~/.pnpm-store` keyed on `pnpm-lock.yaml` hash
  - Uses Turborepo remote caching env vars (commented placeholders)
- `.github/workflows/ci-pr-title.yml` — checks PR titles match
  `^(T-[A-Z]{2}-[A-Z0-9-]+:|chore|build|docs|feat|fix|refactor|test):`
- `.github/dependabot.yml` — weekly bumps for `npm`, `github-actions`,
  `pip` (data-pipeline), `docker`. Group minor + patch.

## Acceptance criteria

- [ ] CI runs on a draft PR and all four jobs succeed on the empty
      workspace.
- [ ] CI runs on push to `main` with the same outcome.
- [ ] PR title check rejects a malformed title and accepts a valid one.
- [ ] Cache hit on second run shaves time materially (verify in run logs).
- [ ] Dependabot config valid (no warnings on the GH UI).

## Out of scope

- Deploy workflows — those come in stage 11.
- Lighthouse / E2E in CI — added when those tools are wired.

## Branch & PR

- Branch: `agent/T-FN-CI`
- PR title: `T-FN-CI: GitHub Actions CI skeleton`

## Escalation triggers

- Branch protection on `main` not yet configured (status checks won't be
  enforceable).
- pnpm version in the action doesn't match the `.nvmrc` / corepack
  expectation.

## Notes from execution
_(empty)_
