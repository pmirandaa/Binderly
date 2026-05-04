# Build status — Phase 0 at 9/10; DB-MIGRATIONS in flight (final task)

**Phase:** 0 — Foundation (90% merged)
**Merged:** 9 / 109 tasks
**In progress:** 1 (T-FN-DB-MIGRATIONS — last Phase 0 task)
**Blocked:** 0
**Blocked on humans:** 0

## Dispatch loop status

T-FN-DB-MIGRATIONS dispatched into `../binderly-wt-T-FN-DB-MIGRATIONS`.
This is the **final Phase 0 task**. After it merges, Phase 0 is
complete and Phase 1 (data layer) unlocks: most schema tasks become
parallel-ready (cards, users, then collections / grading / pricing /
source-interfaces).

## Phase 0 ledger (final)

| Task | Status |
|---|---|
| T-FN-MONOREPO | merged |
| T-FN-TS-CONFIG | merged |
| T-FN-LINT-CONFIG | merged |
| T-FN-GITHUB | merged |
| T-FN-ORCHESTRATOR-SCRIPTS | merged |
| T-FN-CI | merged |
| T-FN-DOCKER | merged |
| T-FN-SUPABASE-LOCAL | merged |
| T-FN-ENV-CONVENTIONS | merged |
| T-FN-DB-MIGRATIONS | in_progress |

## Last 5 merges
- T-FN-ENV-CONVENTIONS — `cbd38f2` (73 vars / 11 sections / docs/env.md / scripts/check-env.sh / pnpm check:env)
- T-FN-SUPABASE-LOCAL — `e81cb2f` (E-003: npm wrapper, --workdir infra; PG17 vs PG16 inert)
- T-FN-DOCKER — `3aae727` (gh pr merge --squash; 6/6 ACs PASS in static + Pablo's smoke test)
- T-FN-CI — `79805a3` (E-002: PR-title regex)
- T-FN-LINT-CONFIG — `f20b66b`

## Verification protocol
For runtime ACs that need Docker socket access, the orchestrator
hands Pablo a paste-able one-liner and merges on his thumbs-up.
Static-only ACs are verified in foreground via the diff inspector.

## What unblocks Phase 1
T-FN-DB-MIGRATIONS provides the Drizzle ORM + migration tooling that
every Phase 1 schema task (T-DL-SCHEMA-CARDS, USERS, COLLECTIONS,
GRADING, PRICING) hard-depends on. Phase 1 begins as soon as it
merges.

## Side note
Dependabot still has ~9 open PRs from when CI landed. Triage when
convenient; not blocking.

## Notes
This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
