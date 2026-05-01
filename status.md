# Build status — Phase 0 dispatch loop

**Phase:** 0 — Foundation
**Merged:** 0 / 109 tasks
**In progress:** 1
**Blocked on humans:** 1 (see open-questions.md Q-001)

## In progress
- T-FN-MONOREPO — sub-agent in `../binderly-wt-T-FN-MONOREPO` (background subagent)

## Last 5 merges
_(none)_

## Bootstrap notes
- Spec scaffold promoted from `binderly/` subfolder to repo root
  (commit `chore: move spec scaffold from binderly/ to repo root`).
  All task `owns_paths` now resolve directly against the filesystem.
- Local default branch renamed `master` → `main` and pushed; origin's
  default-branch swap is deferred (see Q-001).
- Phase 0 ready set on iteration 1: `T-FN-MONOREPO` only — every other
  Phase 0 task depends on it (transitively via the monorepo skeleton).
- Orchestrator scripts (`scripts/spawn_worktree.sh`, etc.) do not yet
  exist — they are produced by `T-FN-ORCHESTRATOR-SCRIPTS` later in
  Phase 0. Until then the orchestrator creates worktrees manually with
  `git worktree add ../binderly-wt-<task-id> -b agent/<task-id>`.

## Notes
This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
