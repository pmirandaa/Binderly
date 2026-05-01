# Build status — Phase 0, 5/10 merged

**Phase:** 0 — Foundation (50% merged)
**Merged:** 5 / 109 tasks
**In progress:** 1 / 3 (T-FN-CI; two slots idle, gated on Q-002)
**Blocked:** 1 (T-FN-DOCKER → Q-002)
**Blocked on humans:** 2 (Q-001 gh auth, Q-002 Docker Desktop)

## In progress
- T-FN-CI — sub-agent in `../binderly-wt-T-FN-CI`

## Blocked
- T-FN-DOCKER — Q-002 (Docker Desktop not running). Worktree clean, ready for re-dispatch.

## Idle slots
2 of 3 parallel slots are free, both gated on Q-002:
- T-FN-SUPABASE-LOCAL → T-FN-DB-MIGRATIONS / T-FN-ENV-CONVENTIONS chain.

T-SP-UI-TOKENS (Phase 3 stub) remains technically dep-ready but
deferred (out of "Phase 0" scope until Pablo greenlights or Phase 0
completes).

## Tooling
First successful real use of `scripts/cleanup_worktree.sh` after
hotfixing a SIGPIPE/pipefail bug in `is_merged_by_title()`
(`git log | grep -q` was producing 141 because grep -q closes stdin
on first match and pipefail then reports the pipeline as failed; fix
is to drop `-q` and redirect grep output to /dev/null so it consumes
the full stream). Hotfix justified per AGENT_ORCHESTRATOR.md § 1
allowance for orchestration-script edits.

Note for Pablo: Cursor's sandbox forbids deleting `.claude/settings.local.json`
files that get auto-created inside sub-agent worktrees' node_modules,
which means `git worktree remove` from inside Cursor leaves orphaned
directories on disk (git itself unregisters them via `git worktree
prune`). Stale dirs at `/Users/pmiranda/Stuff/binderly-wt-T-FN-MONOREPO/`,
`/binderly-wt-T-FN-GITHUB/`, `/binderly-wt-T-FN-TS-CONFIG/`,
`/binderly-wt-T-FN-ORCHESTRATOR-SCRIPTS/`, `/binderly-wt-T-FN-LINT-CONFIG/`
can be cleared with a one-shot `rm -rf` from your own terminal at any time.
None block the build.

## Last 5 merges
- T-FN-LINT-CONFIG          — `f20b66b` (lockfile conflict resolved by regenerating via `pnpm install`)
- T-FN-ORCHESTRATOR-SCRIPTS — `79a2587`
- T-FN-TS-CONFIG            — `df01a4d`
- T-FN-GITHUB               — `6864abc`
- T-FN-MONOREPO             — `cf9c0ab`

## Notes
This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
