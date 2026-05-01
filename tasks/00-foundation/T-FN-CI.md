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

### Files created (only in `owns_paths`)

- `.github/workflows/ci.yml` — main pipeline.
- `.github/workflows/ci-pr-title.yml` — Conventional Commits PR-title gate.
- `.github/dependabot.yml` — weekly grouped bumps for npm, github-actions,
  pip, docker.

No file outside `.github/workflows/` and `.github/dependabot.yml` was
touched.

### Action versions pinned

All `uses:` lines pin a major-version tag, per the task spec ("pin every
action by major-version-pinned tag"). Digest pinning across the repo is a
separate hardening pass; nothing in this task blocks it.

| File                                  | `uses:`                  | Pin    |
| ------------------------------------- | ------------------------ | ------ |
| `.github/workflows/ci.yml`            | `actions/checkout`       | `@v4`  |
| `.github/workflows/ci.yml`            | `actions/setup-node`     | `@v4`  |
| `.github/workflows/ci.yml`            | `actions/cache`          | `@v4`  |
| `.github/workflows/ci-pr-title.yml`   | _(none — inline bash)_   | n/a    |

`pnpm/action-setup` was not used: each job activates pnpm via Corepack
(`corepack enable && corepack prepare pnpm@9.15.9 --activate`). This
matches the version pinned in `package.json`'s `packageManager` field
from T-FN-MONOREPO and avoids depending on a third-party action for
something Corepack already does. The pnpm store is cached separately via
`actions/cache@v4` keyed on `runner.os` + `hashFiles('**/pnpm-lock.yaml')`,
which is what the task spec asked for.

### Tooling versions wired

- Node `22.22.2` (sourced from `.nvmrc` via `node-version-file`).
- pnpm `9.15.9` (sourced from `packageManager: pnpm@9.15.9`; reasserted
  via `corepack prepare`).
- ESLint `9.39.4`, Prettier `3.8.3`, Turbo `2.9.6` — all resolved
  transitively by `pnpm install --frozen-lockfile` against the committed
  lockfile; no version is hardcoded inside the workflow.

### Triggers and concurrency

- `pull_request` (NOT `pull_request_target` — security footgun called out
  in `rules/00-foundation.md`).
- `push: branches: [main]`.
- `workflow_dispatch:` (manual re-runs).
- Concurrency group `ci-${{ github.workflow }}-${{ github.ref }}` cancels
  in-flight runs on PRs only — `main` and manual runs are never
  cancelled mid-flight.

### Turbo remote-cache wiring

`TURBO_TOKEN` and `TURBO_TEAM` are present in `ci.yml` `env:` as
commented-out placeholders. No signup is required at this stage; until a
Vercel/Turbo team is provisioned, Turbo falls back to local cache, which
the pnpm-store cache already accelerates across runs. `TURBO_TELEMETRY_DISABLED`
is set to `"1"` workflow-wide.

### PR-title check — deviation from spec regex (documented)

The task spec's PR-title regex was:

```
^(T-[A-Z]{2}-[A-Z0-9-]+:|chore|build|docs|feat|fix|refactor|test):
```

That literal pattern rejects two test cases the orchestrator's verification
step explicitly required to pass:

- `T-FN-CI: GitHub Actions CI skeleton` — the alternative
  `T-[A-Z]{2}-[A-Z0-9-]+:` already includes the trailing `:`, so the
  full pattern then requires another `:` after it (i.e. it would only
  match `T-FN-CI::`). This is the orchestrator's own PR-title format
  for agent PRs (`PR title: T-FN-CI: GitHub Actions CI skeleton`),
  so the spec regex would reject every agent PR.
- `feat(scanner): add ANN index loader` — Conventional Commits scope
  syntax `(scope)` between type and `:` is not allowed by the spec
  regex, but it's the canonical example in `context/conventions.md`
  § Commits.

Active regex used in `.github/workflows/ci-pr-title.yml` (minimal
correction):

```
^(T-[A-Z]{2}-[A-Z0-9-]+|chore|build|docs|feat|fix|refactor|test)(\([a-z0-9.-]+\))?!?:[[:space:]].+
```

Changes:

1. Moved the `:` out of the `T-XX-NAME` alternative (it's now required
   exactly once after the alternation).
2. Added an optional `(\([a-z0-9.-]+\))?` group for Conventional Commits
   scopes.
3. Tolerated an optional `!` for breaking-change marker.
4. Required `[[:space:]].+` after the `:` so titles like `fix:no space`
   or a bare `feat:` are rejected.

Surfacing here so the orchestrator can decide whether to ratify the
correction (preferred) or amend the spec regex.

### PR-title regex — one-shot verification

```
regex='^(T-[A-Z]{2}-[A-Z0-9-]+|chore|build|docs|feat|fix|refactor|test)(\([a-z0-9.-]+\))?!?:[[:space:]].+'
```

| Title                                              | Expected | Result |
| -------------------------------------------------- | -------- | ------ |
| `T-FN-CI: GitHub Actions CI skeleton`              | PASS     | PASS   |
| `feat(scanner): add ANN index loader`              | PASS     | PASS   |
| `chore: bump turbo to 2.x`                         | PASS     | PASS   |
| `fix(web): correct set ordering on browse page`    | PASS     | PASS   |
| `feat!: drop legacy api`                           | PASS     | PASS   |
| `T-DL-PRICING-AGGREGATOR: add eBay client`         | PASS     | PASS   |
| `hello world`                                      | FAIL     | FAIL   |
| `Add stuff`                                        | FAIL     | FAIL   |
| `feature: typo type`                               | FAIL     | FAIL   |
| `fix:no space`                                     | FAIL     | FAIL   |
| `T-fn-ci: lowercase task`                          | FAIL     | FAIL   |
| `T-FN: missing-name segment`                       | FAIL     | FAIL   |

All 12 cases matched expectations (overall exit 0).

### Dependabot config

- Schema: dependabot-2.0 (https://json.schemastore.org/dependabot-2.0.json).
- Four ecosystems exactly as the task spec called for: `npm`,
  `github-actions`, `pip` (in `/data-pipeline`), `docker` (in `/`).
- Each ecosystem has a single group named `<eco>-minor-patch` that
  bundles `update-types: [minor, patch]` (`applies-to: version-updates`).
  Major bumps still open as individual PRs.
- Schedule: weekly on Monday 06:00 UTC.
- `commit-message.prefix` set to a Conventional Commits type (`build`
  for npm/pip/docker; `ci` for github-actions) per `context/conventions.md`.
- `pip` (`/data-pipeline`) and `docker` (`/`) entries are forward-looking:
  the data-pipeline workspace currently contains only `.gitkeep`, and
  no Dockerfile exists yet. Dependabot will warn that no manifests were
  found until those land. This is documented in inline comments in
  `.github/dependabot.yml`.

### Acceptance criteria results

| # | Criterion | Status |
|---|-----------|--------|
| 1 | CI runs on a draft PR; all four jobs succeed on empty workspace. | DEFERRED — needs a real PR to verify. |
| 2 | CI runs on push to `main` with the same outcome. | DEFERRED — needs a merge to `main`. |
| 3 | PR title check rejects malformed and accepts valid titles. | PASS — see one-shot table above. |
| 4 | Cache hit on second run shaves time materially. | DEFERRED — needs two runs in CI. |
| 5 | Dependabot config valid (no warnings on the GH UI). | LIKELY PASS offline (structural validation against schema-style checks); the GH UI assertion needs the merged PR. |

(1), (2), (4), and the GH-UI portion of (5) cannot be verified offline.
Pablo to confirm after the PR opens and CI runs at least twice.

### Branch-protection compatibility check

`docs/github-setup.md` § 3 lists the required status checks as
`lint`, `typecheck`, `test`, `build`. The four job IDs in `ci.yml`
match exactly (case-sensitive), and each job's `name:` field also
matches its ID, so both the job-id selector and the display-name
selector in the branch-protection UI/API will resolve.

### Push status

Pushed `agent/T-FN-CI` to `origin`. PR-create URL (gh auth is broken,
Q-001):

  https://github.com/pmirandaa/Binderly/compare/main...agent/T-FN-CI?expand=1

(GitHub also printed the legacy URL `https://github.com/pmirandaa/Binderly/pull/new/agent/T-FN-CI` after `git push`; both work.)

### Notes for later tasks

- **First real PR run** will exercise the deferred acceptance criteria
  (1), (2), (4). Expect a cache miss on run 1 and a hit on run 2; the
  saved time will scale with how many packages the workspace gains.
- **Branch protection** can be wired (per `docs/github-setup.md` § 3)
  immediately after this PR's first CI run completes, so the four
  required status checks appear in GitHub's selector. Until then,
  branch-protection enforcement is a no-op.
- **Dependabot warnings** for `pip` and `docker` will disappear once
  `data-pipeline/requirements.txt` (or `pyproject.toml`) and the first
  `Dockerfile` land in their respective foundation/feature tasks. No
  config change required at that point — Dependabot will just start
  scanning.
- **Adding a new CI job** (e.g. coverage upload, Lighthouse, E2E in
  later stages): keep the four load-bearing job ids unchanged. New
  jobs should use distinct ids and be added to branch protection
  separately.
- **Turbo remote cache**: when a Vercel/Turbo team is provisioned,
  uncomment the two `TURBO_*` env entries in `ci.yml` and add the
  matching `CI_TURBO_TOKEN` / `CI_TURBO_TEAM` secrets per
  `docs/github-setup.md` § 4.
- **Optional hardening pass** (separate task): replace each major-tag
  pin (`@v4`) with a digest pin (`@<sha>`) and keep the tag in a
  trailing comment for readability. Not done here per the task spec
  ("major-version-pinned tag").

