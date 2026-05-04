# Build status — Phase 0 at 8/10; ENV-CONVENTIONS in flight

**Phase:** 0 — Foundation (80% merged)
**Merged:** 8 / 109 tasks
**In progress:** 1 (T-FN-ENV-CONVENTIONS)
**Blocked:** 0
**Blocked on humans:** 0

## Dispatch loop status

T-FN-ENV-CONVENTIONS dispatched into `../binderly-wt-T-FN-ENV-CONVENTIONS`.
T-FN-DB-MIGRATIONS held back deliberately: both tasks add scripts to
root `package.json` and may both touch `pnpm-lock.yaml`. Sequencing
avoids the merge conflict; ENV-CONVENTIONS is S-effort (~5-10 min)
so the wall-clock cost is small. DB-MIGRATIONS dispatches as soon as
ENV-CONVENTIONS merges.

## Phase 0 remaining

| Task | Direct deps | Status | When ready |
|---|---|---|---|
| T-FN-ENV-CONVENTIONS | T-FN-DOCKER | in_progress | now |
| T-FN-DB-MIGRATIONS | T-FN-SUPABASE-LOCAL, T-FN-TS-CONFIG | pending | held; dispatches after ENV-CONVENTIONS merges |

After both merge, **Phase 0 is complete** and Phase 1 (data layer)
unlocks. Most schema tasks become parallel-ready (cards, users, then
collections/grading/pricing/source-interfaces).

## Verification protocol learnings (this session)
The Cursor Shell sandbox blocks Docker socket access for `bash`-style
chained commands and arbitrary scripts under `/tmp/`, even with
`required_permissions: ["all"]`. Direct allowlisted commands
(`docker info`, `gh pr ...`, `git push`, `bash scripts/<workspace>/...`)
escape it. Workaround for runtime ACs that need Docker:
1. Static-analyze the diff in foreground (always works).
2. If a smoke test is needed, give Pablo a paste-able one-liner.
3. Merge on his thumbs-up.

T-FN-SUPABASE-LOCAL was verified this way: ALL CHECKS PASSED on
Pablo's manual smoke run before merge.

## Last 5 merges
- T-FN-SUPABASE-LOCAL — `e81cb2f` (E-003: npm wrapper + --workdir infra; PG17 vs PG16 inert divergence approved)
- T-FN-DOCKER        — `3aae727` (gh pr merge --squash)
- T-FN-CI            — `79805a3` (E-002: PR-title regex)
- T-FN-LINT-CONFIG   — `f20b66b`
- T-FN-ORCHESTRATOR-SCRIPTS — `79a2587`

## Side note
Dependabot still has ~9 open PRs from when CI landed. Triage when
convenient; not blocking.

## Notes
This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
