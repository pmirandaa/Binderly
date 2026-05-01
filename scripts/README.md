# scripts/

This directory will hold orchestrator helper scripts. It's intentionally
empty in the spec scaffold — the actual scripts are produced by
`T-FN-ORCHESTRATOR-SCRIPTS` (a Phase 0 task) once the agent build begins.

After T-FN-ORCHESTRATOR-SCRIPTS merges, this directory will contain:

- `spawn_worktree.sh` — create a worktree + branch for a sub-agent
- `cleanup_worktree.sh` — tear down a worktree after merge
- `list_ready_tasks.sh` — read `dependencies.yaml`, print ready tasks
- `orchestrator.config.json` — runtime knobs (max_parallel, etc.)
- (later) `check-env.sh` from T-FN-ENV-CONVENTIONS

See `../AGENT_ORCHESTRATOR.md` for the orchestrator's role and how these
scripts are used.
