# `scripts/` — Orchestrator helpers

These are the bash scripts the orchestrator agent runs to spawn sub-agent
worktrees, tear them down after merge, and compute the "ready set" from
`dependencies.yaml`. See `../AGENT_ORCHESTRATOR.md` (sections 3 and 4) for
the model these scripts implement.

## Files

| File | Purpose |
| ---- | ------- |
| `spawn_worktree.sh` | Create branch `agent/<task-id>` off `main` and `git worktree add ../binderly-wt-<task-id>`. |
| `cleanup_worktree.sh` | After merge: remove the worktree, prune stale entries, delete the local branch. |
| `list_ready_tasks.sh` | Parse `dependencies.yaml` and print every `pending` task whose deps are all merged on `main`. |
| `orchestrator.config.json` | Runtime knobs (max parallel, branch prefix, worktree prefix, main branch name). |

All `.sh` scripts use `bash`, start with `set -euo pipefail`, and have no
external dependencies beyond what macOS ships (`git`, `awk`, `sed`,
`grep`). No `jq`, `yq`, or Python.

## Conventions (must match `orchestrator.config.json`)

- **Branch prefix:** `agent/`
- **Worktree prefix:** `../binderly-wt-` (sibling of repo root, shares `.git`)
- **Main branch:** `main`
- **Max parallel sub-agents:** `3`

So task `T-DL-SCHEMA-CARDS` lives on branch `agent/T-DL-SCHEMA-CARDS` in
worktree `../binderly-wt-T-DL-SCHEMA-CARDS`.

## Usage

```bash
# Orchestrator dispatches a sub-agent
scripts/spawn_worktree.sh T-DL-SCHEMA-CARDS
# → creates branch + worktree, prints absolute path; orchestrator opens
#   that path in a new Cursor window.

# After the sub-agent's PR is merged
scripts/cleanup_worktree.sh T-DL-SCHEMA-CARDS
# → refuses unless the merge is detected; pass --force to override.

# Each loop iteration: which tasks are now unblocked?
scripts/list_ready_tasks.sh
# → one task id per line on stdout; informational logs on stderr.
```

## How "is task merged?" is detected

The orchestrator squash-merges every sub-agent PR with the title
`<task-id>: <human title>` (see `T-FN-MONOREPO: ...`, `T-FN-GITHUB: ...`
already in `git log`). Squash merges erase the agent branch's individual
commits, so we can't use `git branch --merged` reliably. Instead, both
`cleanup_worktree.sh` and `list_ready_tasks.sh` scan the most recent N
commit subjects on `main` for one starting with `<task-id>:`.

- **Exact pattern:** `^<task-id>:` (anchored, colon-suffixed) applied via
  `git log --format=%s main -n N | grep -E`.
- **N defaults to 200**, override via env var `BINDERLY_MERGE_LOG_DEPTH=500`.
- `cleanup_worktree.sh` also has a fallback ancestry check
  (`git merge-base --is-ancestor`) for the rare `--no-ff` merge case.

If the project ever adopts a different merge title convention, update the
regex in both scripts at the same time.

## How `dependencies.yaml` is parsed

We don't ship `yq` or Python so we use a tiny awk state machine that walks
the file once and emits `id|status|dep1,dep2,...` per task. It relies on
the rigid formatting that the orchestrator already follows:

- Each task starts with a list-item line `  - id: T-XX-XXX` (two-space
  indented dash).
- `status:` and `depends_on:` are sibling fields, each on their own line.
- `depends_on:` always uses inline-array form: `depends_on: [T-A, T-B]` or
  `depends_on: []`.

Recipe (abbreviated; see `list_ready_tasks.sh` for full code):

```awk
/^[[:space:]]+- id: /        { emit_previous(); id = $3; status=""; deps="" }
/^[[:space:]]+status: /      { status = $2 }
/^[[:space:]]+depends_on: \[/ {
  line = $0
  sub(/^[^[]*\[/, "", line); sub(/\].*$/, "", line)
  gsub(/[[:space:]]/, "", line)
  deps = line
}
```

The simpler "task exists in deps" check used by `spawn_worktree.sh` is
just:

```bash
grep -E "^[[:space:]]+- id: ${TASK_ID}$" dependencies.yaml
```

If we ever switch `depends_on` to multi-line YAML lists, both the awk
recipe and this README must be revisited.

## Failure modes (and what each script does about them)

| Situation | Behaviour |
| --------- | --------- |
| `spawn_worktree.sh` called with no arg / extra args | exits 64 with usage banner |
| Task id doesn't match `^T-[A-Z]+-[A-Z0-9-]+$` | exits 65 |
| Task id not in `dependencies.yaml` | exits 65 |
| `orchestrator.config.json` or `dependencies.yaml` missing | exits 66 |
| Worktree path already exists on disk | exits 73, hint to run cleanup |
| Worktree already registered with git (stale entry) | exits 73, hint to run cleanup |
| Branch `agent/<task-id>` already exists | exits 73, hint to run cleanup |
| `cleanup_worktree.sh` on an unmerged branch | exits 69, hint to use `--force` |
| `cleanup_worktree.sh` when worktree path absent | logs and continues; idempotent |
| `cleanup_worktree.sh` with dirty working tree (no `--force`) | git refuses (`worktree remove` non-zero) |
| `--force` on cleanup | uses `worktree remove --force` and `branch -D` |
| `list_ready_tasks.sh` finds zero ready tasks | exits 0 with empty stdout (current state) |
| Local `main` is stale | merge detection misses recent merges; do `git fetch origin main:main` first |

## Worktree discipline reminders

- A sub-agent's worktree shares `.git` with the main checkout. Don't `rm
  -rf` a worktree directory by hand — always go through
  `cleanup_worktree.sh` so git's bookkeeping stays consistent.
- The orchestrator runs these from the **main** worktree
  (`/Users/pmiranda/Stuff/Binderly`). They will *technically* run from any
  worktree (they `git rev-parse --show-toplevel` to find the repo root)
  but the `dependencies.yaml` they read is the one in the calling
  worktree, which can drift from `main`.
- `spawn_worktree.sh` does not auto-fetch. Before spawning, the
  orchestrator should ensure local `main` is current
  (`git pull --ff-only`).
- The `config:` block at the top of `dependencies.yaml` is informational
  only; the source of truth for runtime knobs is
  `orchestrator.config.json`. They duplicate `max_parallel` and
  `branch_prefix` deliberately — keep them in sync when one changes.
