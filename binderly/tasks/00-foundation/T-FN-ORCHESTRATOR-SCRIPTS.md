# T-FN-ORCHESTRATOR-SCRIPTS — Worktree spawn/cleanup scripts and config

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** pending

## Hard dependencies
- T-FN-GITHUB

## Soft dependencies
- T-FN-DOCKER, T-FN-CI (parallel-safe)

## Required reading
- AGENT_ORCHESTRATOR.md (entire file)
- rules/00-foundation.md

## Goal
Provide the bash scripts the orchestrator agent uses to spawn and clean
up sub-agent worktrees, plus a JSON config the orchestrator reads for
runtime knobs (max_parallel, etc.).

## Deliverables

- `scripts/spawn_worktree.sh`:
  - Usage: `scripts/spawn_worktree.sh <task-id>`
  - Validates the task ID matches `^T-[A-Z]{2}-[A-Z0-9-]+$`.
  - Confirms the task ID exists in `dependencies.yaml`.
  - Refuses to spawn if a worktree at the target path already exists
    (idempotent failure with a clear message).
  - Creates the branch off `main`: `agent/<task-id>`.
  - `git worktree add ../binderly-wt-<task-id> agent/<task-id>`.
  - Prints the absolute path of the new worktree on success.
  - `set -euo pipefail`.
- `scripts/cleanup_worktree.sh`:
  - Usage: `scripts/cleanup_worktree.sh <task-id>`
  - Verifies the branch is merged into `main` (refuses if not, with
    `--force` flag to override).
  - `git worktree remove ../binderly-wt-<task-id>`.
  - Optionally deletes the local branch (it's already merged).
  - Cleans up any stale lock files.
- `scripts/orchestrator.config.json`:
  ```json
  {
    "max_parallel": 3,
    "branch_prefix": "agent/",
    "worktree_prefix": "../binderly-wt-",
    "default_main_branch": "main"
  }
  ```
- `scripts/list_ready_tasks.sh`:
  - Reads `dependencies.yaml`, prints task IDs whose `depends_on` are
    all merged (i.e., branches `agent/<id>` exist *or* commit history
    contains `T-XX-XXX:` markers — pick a strategy and document).
  - Used by the orchestrator each loop. Output one task ID per line.
- `scripts/README.md` — explains the model, the assumptions, the failure
  modes (worktree path conflicts, dirty working tree on main, etc.).

## Acceptance criteria

- [ ] `bash scripts/spawn_worktree.sh T-FN-SAMPLE` (with a fake ID
      added to a test fixture) creates a worktree and branch.
- [ ] `bash scripts/cleanup_worktree.sh T-FN-SAMPLE` cleans it up
      (after a manual merge or with `--force`).
- [ ] Both scripts handle bad input gracefully: missing arg,
      malformed task ID, nonexistent task.
- [ ] `scripts/list_ready_tasks.sh` outputs the foundation tasks (as
      they become ready) when run against the actual
      `dependencies.yaml`.
- [ ] No file modified outside `scripts/`.

## Out of scope

- Spawning the actual Cursor windows — Pablo does this manually by
  opening the worktree path in a new Cursor window. The orchestrator
  prints the path; the human routes it.
- Automating sub-agent dispatch — the orchestrator agent does this
  conversationally inside Cursor.

## Branch & PR

- Branch: `agent/T-FN-ORCHESTRATOR-SCRIPTS`
- PR title: `T-FN-ORCHESTRATOR-SCRIPTS: Worktree management scripts`

## Escalation triggers

- The "is this task merged?" detection is unreliable on a squash-merge
  history. If so, fall back to checking for a `T-XX-XXX:` marker in
  the most recent N commits on main. Document the choice.
- Windows compatibility (Pablo on Mac per memory; if he ever moves to
  Windows, scripts need a PowerShell variant — out of scope here).

## Notes from execution
_(empty)_
