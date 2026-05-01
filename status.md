# Build status — Phase 0 dispatch loop, iteration 2

**Phase:** 0 — Foundation
**Merged:** 1 / 109 tasks
**In progress:** 3 (saturating MAX_PARALLEL=3)
**Blocked on humans:** 1 (see open-questions.md Q-001)

## In progress
- T-FN-TS-CONFIG  — sub-agent in `../binderly-wt-T-FN-TS-CONFIG`
- T-FN-GITHUB     — sub-agent in `../binderly-wt-T-FN-GITHUB`
- T-FN-DOCKER     — sub-agent in `../binderly-wt-T-FN-DOCKER`

## Last 5 merges
- T-FN-MONOREPO — merged into `main` as `cf9c0ab`

## Iteration 2 dispatch reasoning

After T-FN-MONOREPO merged, four tasks became ready: T-FN-TS-CONFIG,
T-FN-LINT-CONFIG, T-FN-GITHUB, T-FN-DOCKER (all parallel-safe with each
other). MAX_PARALLEL=3 means deferring one. T-FN-LINT-CONFIG was deferred
because its only downstream is T-FN-CI, which already needs all of
TS-CONFIG + LINT-CONFIG + GITHUB merged before it can run; deferring
LINT-CONFIG by one iteration costs nothing on the critical path.

The dispatched three sit on the longest critical paths:
- **T-FN-DOCKER** unblocks T-FN-SUPABASE-LOCAL → T-FN-DB-MIGRATIONS →
  every Phase 1 schema task.
- **T-FN-TS-CONFIG** also feeds T-FN-DB-MIGRATIONS (alongside the
  Supabase chain) and T-FN-CI.
- **T-FN-GITHUB** unblocks T-FN-ORCHESTRATOR-SCRIPTS, which retires the
  manual-worktree workaround currently in use.

T-FN-LINT-CONFIG dispatches in iteration 3 once one of these merges.

## Notes
This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
