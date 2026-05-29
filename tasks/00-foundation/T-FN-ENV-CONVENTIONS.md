# T-FN-ENV-CONVENTIONS — Environment variable conventions and .env.example

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** merged

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

### Section ordering rationale

`.env.example` and `docs/env.md` are organized in 11 sections, in this
order: STACK → DERIVED URLS → SUPABASE LOCAL → AUTH PROVIDERS → WEB →
MOBILE → API_PYTHON → PIPELINE → EDGE → CI → FEATURE FLAGS. The
ordering follows what a new contributor encounters in the order they
encounter it: bring up Compose first (`STACK`), use the derived URLs,
then bring up Supabase (`SUPABASE LOCAL`), wire OAuth (`AUTH
PROVIDERS`), then per-app sections, then the deploy concerns (`CI`)
and feature toggles (`FEATURE FLAGS`). The `PIPELINE` scope is
reserved with a header but ships empty — data-source tasks (e.g.
`T-DL-SOURCE-TCGDEX-EN`) will populate it.

### Var inventory by section

73 vars total in `.env.example`:

- STACK: 10
- DERIVED URLS: 5
- SUPABASE LOCAL: 4
- AUTH PROVIDERS: 4 (3 OAuth secrets + `OPENAI_API_KEY` for Studio AI)
- WEB: 10
- MOBILE: 8
- API_PYTHON: 20
- PIPELINE: 0 (reserved scope)
- EDGE: 3
- CI: 6
- FEATURE FLAGS: 3

### EXTRA-OK convention choice

`scripts/check-env.sh` enforces "no extras unless tagged `# EXTRA-OK`
on the comment line directly above". The flag resets at the next
blank line so `# EXTRA-OK` only marks the next var declaration, not
arbitrarily later ones. Matches the spec's first option (extras
require explicit opt-in).

### Vars added beyond `context/secrets-and-env.md`

The canonical doc enumerates app-side vars but does not list:

- `STACK` infra vars (`POSTGRES_*`, `MINIO_*`, `MAILPIT_*`) — these
  are infrastructure-level, intentionally unscoped.
- `DERIVED URLS` (`DATABASE_URL`, `SMTP_*`, `S3_*`) — convenience.
- `SUPABASE LOCAL` block (`SUPABASE_*`) — added by
  `T-FN-SUPABASE-LOCAL`.
- `SUPABASE_AUTH_EXTERNAL_*_SECRET` and `OPENAI_API_KEY` — referenced
  via `env(...)` substitution in `infra/supabase/config.toml`. No
  changes to those source files; only documented and pre-declared
  here.

The OAuth `*_SECRET` triplet was already in `.env.example` from
`T-FN-SUPABASE-LOCAL`; preserved verbatim. `OPENAI_API_KEY` is new
this task — it powers Studio's AI panel and is referenced at
`infra/supabase/config.toml:109`. Left empty (optional).

### `check-env.sh` test cases

Verified locally before the commit:

1. **Self-check** — `bash scripts/check-env.sh .env.example` → exit
   `0`, `OK: 73 vars match`.
2. **Missing var** — copy `.env.example`, remove `POSTGRES_USER` →
   exit `2`, `FAIL: 1 missing, 0 extra` and a named diff.
3. **Extra var** — copy `.env.example`, append `FAKE_VAR=hello` →
   exit `2`, `FAIL: 0 missing, 1 extra` and a named diff.
4. **Extra var with `# EXTRA-OK`** — copy `.env.example`, append a
   `# EXTRA-OK: prototype` line then `MY_PROTOTYPE_KNOB=1` → exit
   `0`, `OK: 73 vars match`.
5. **Missing target file** — `bash scripts/check-env.sh
   /tmp/does-not-exist.env` → exit `1`, `ERROR: target file not
   found`.
6. **Usage error** — `bash scripts/check-env.sh` (no arg) → exit `1`,
   prints usage.
7. **`pnpm check:env` wiring** — without `.env.local` exits with the
   "target file not found" error; with `cp .env.example .env.local`
   passes (`OK: 73 vars match`).

### Notes for later tasks

- **`T-FN-DB-MIGRATIONS`**: `DATABASE_URL` (Compose, port 5433) and
  `SUPABASE_DB_URL` (Supabase CLI, port 54322) are already declared
  with their dual-Postgres explainer. Migration tooling targets
  `SUPABASE_DB_URL`. The Python migration baseline (if any) targets
  `API_PYTHON_DB_URL`.
- **Phase 1 schema tasks**: All Supabase auth scaffolding is in
  place: `SUPABASE_*` keys, `SUPABASE_AUTH_EXTERNAL_*_SECRET`. RLS
  policies will use the anon/service-role split that's already
  declared.
- **Per-app scoping**: `WEB_*`, `MOBILE_*`, `API_PYTHON_*`,
  `PIPELINE_*`, `EDGE_*`, `CI_*` scopes are reserved with section
  headers in `.env.example` and `docs/env.md`. New per-app vars slot
  under their existing section. PIPELINE has zero canonical vars
  yet — data-source tasks own that scope.
- **New vars added in later tasks**: append the var under its
  scope's section in BOTH `.env.example` and `docs/env.md`. The
  canonical list at `context/secrets-and-env.md` is the governance
  doc — keep that updated too. `pnpm check:env` will catch drift in
  any developer's `.env.local`.
