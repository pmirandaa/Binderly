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

### "Is this task merged?" detection strategy

We scan the most recent N commit subjects on `main` for one beginning with
`<task-id>:`. Exact recipe (used in both `cleanup_worktree.sh` and
`list_ready_tasks.sh`):

```bash
git -C "${REPO_ROOT}" log --format=%s "${MAIN_BRANCH}" -n "${LOG_DEPTH}" \
  | grep -qE "^${TASK_ID}:"
```

- N defaults to **200**, override via env var `BINDERLY_MERGE_LOG_DEPTH`.
- This is reliable because the orchestrator squash-merges every PR with
  the title `<task-id>: <human title>` (already proven by the existing
  `T-FN-MONOREPO:` and `T-FN-GITHUB:` commits on `main`).
- `cleanup_worktree.sh` has a secondary ancestry fallback for hypothetical
  `--no-ff` merges: branch tip must be reachable from main *and* differ
  from main's tip. The "differ from main's tip" guard is important — a
  brand-new branch sitting at main's tip is a trivial ancestor but
  represents zero merged work, and without the guard cleanup would
  silently succeed on unmerged branches (caught during testing).

### YAML parsing approach

No `yq` / Python — macOS-only deps. We use a tiny awk state machine that
emits one `id|status|dep1,dep2,...` line per task block. The state
machine relies on the rigid formatting orchestrator-edited YAML already
follows (one field per line, `depends_on` always inline-array).

Recipe (full version in `scripts/list_ready_tasks.sh`):

```awk
/^[[:space:]]+- id: /         { emit_previous(); id = $3; status=""; deps="" }
/^[[:space:]]+status: /       { status = $2 }
/^[[:space:]]+depends_on: \[/ {
  line = $0
  sub(/^[^[]*\[/, "", line)   # strip everything up to and including [
  sub(/\].*$/, "", line)      # strip ] and anything after
  gsub(/[[:space:]]/, "", line)
  deps = line
}
```

The simpler "task exists" check used by `spawn_worktree.sh` is just:

```bash
grep -E "^[[:space:]]+- id: ${TASK_ID}$" dependencies.yaml
```

If the orchestrator ever switches `depends_on` to multi-line YAML lists,
both the awk recipe and `scripts/README.md` must be revisited (search
for "If we ever switch").

### Test methodology

Per the orchestrator's instruction, no test fixture was added to
`dependencies.yaml`. We exercised against:

- **`T-FN-SAMPLE`** and **`T-FN-NEVER-USED-XX`** — never-declared ids,
  used to prove the "exists in deps" check rejects properly.
- **`T-DL-FX-RATES`** — a real Phase 1 task far from any in-flight work,
  used for the round-trip spawn → re-spawn (idempotent failure) →
  cleanup-without-force (refused) → cleanup-with-force (succeeds) path.
  Cleaned up immediately so no artifacts remained; verified with
  `git worktree list` and `git branch | grep T-DL-FX-RATES`.

All 9 acceptance tests passed. See PR description for the full table.

### Edge cases / gotchas surfaced

1. **Trivial ancestor false-positive** (described above) — the original
   ancestry-only fallback would have approved cleanup of any
   never-touched branch. Guarded with `branch_tip != main_tip`.
2. **Worktree-local `dependencies.yaml`** — `list_ready_tasks.sh` reads
   the deps file from the calling worktree, not from `main`. Inside a
   sub-agent worktree the file reflects state at branch creation time
   (which can lag main). The orchestrator runs from `main` so this is a
   non-issue in practice; documented in `scripts/README.md` under
   "Worktree discipline reminders".
3. **`git worktree prune` writing to `.git/config`** — when
   `cleanup_worktree.sh` runs in a writable-only-to-worktree sandbox,
   prune logs `Operation not permitted` updating the main repo's config.
   It's a warning only (cleanup completes, exit 0) and won't fire when
   the orchestrator runs from the main worktree where it has full write
   access.
4. **No auto-fetch in `spawn_worktree.sh`** — keeps the script
   network-free per the foundation rule. The orchestrator must
   `git pull --ff-only` before spawning so the new branch starts from
   the latest `main`. Documented in `scripts/README.md`.
5. **`config:` block at top of `dependencies.yaml`** is informational
   only; runtime knobs come from `scripts/orchestrator.config.json`.
   They duplicate `max_parallel` and `branch_prefix` deliberately —
   keep them in sync when one changes (called out in the README).
