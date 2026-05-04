# Build status — Phase 0 COMPLETE; Phase 1 begun (2 tasks in flight)

**Phase 0:** 10 / 10 tasks merged ✓ (foundation locked)
**Phase 1:** 2 / 6 tasks in_progress (data layer underway)
**Total merged:** 10 / 109 tasks
**In progress:** 2 (T-DL-SCHEMA-CARDS, T-DL-SCHEMA-USERS — parallel-safe)
**Blocked:** 0
**Blocked on humans:** 0

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
| T-FN-DB-MIGRATIONS | merged |

## Phase 1 dispatch plan

**Iteration 1 (now):** CARDS + USERS in parallel.
- Disjoint `owns_paths`: CARDS owns `sets.ts / cards.ts / printings.ts`,
  USERS owns `profiles.ts / subscriptions.ts`.
- Single shared file: `packages/db/src/schema/index.ts` (the barrel).
  Pre-staged with sectioned headers (`// === T-DL-SCHEMA-<NAME> ===`)
  so each task uncomments only its own section. Parallel edits land
  in disjoint regions, git merges cleanly.
- COLLECTIONS / GRADING / PRICING all hard-depend on CARDS or USERS
  → blocked until iteration 1 merges.

**Iteration 2 (after iteration 1 merges):** COLLECTIONS + GRADING + PRICING.
- COLLECTIONS depends on both CARDS and USERS.
- GRADING depends on USERS only.
- PRICING depends on CARDS only.
- All three declared `parallel_safe_with` each other in dependencies.yaml.
  All have disjoint `owns_paths`. They share the same barrel as CARDS+USERS;
  pre-staged sections handle that.

After iteration 2 merges, **Phase 1 is complete** and Phase 2 (apps,
ingestion, scanner, etc.) unlocks across the dependency graph.

## Last 5 merges
- T-FN-DB-MIGRATIONS — `7b4529e` (Phase 0 closer; AC-2 + AC-4 verified by Pablo's smoke test)
- T-FN-ENV-CONVENTIONS — `cbd38f2` (73 vars / 11 sections / docs/env.md / scripts/check-env.sh)
- T-FN-SUPABASE-LOCAL — `e81cb2f` (E-003 ratified; PG17 vs PG16 inert)
- T-FN-DOCKER — `3aae727`
- T-FN-CI — `79805a3` (E-002 ratified)

## Documented follow-ups (not blocking)
- `packages/db/scripts/migrate.ts` errors loudly when `meta/_journal.json`
  doesn't exist (fresh-clone UX wart). Self-heals once first schema task
  generates a journal. Small graceful-skip patch can land any time.
- Dependabot has ~9 open PRs. Triage when convenient.

## Notes
This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
