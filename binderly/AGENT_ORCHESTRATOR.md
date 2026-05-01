# Agent Orchestrator Playbook

This document is read by the **orchestrator agent**. The orchestrator is the
one Cursor session that drives the build. Sub-agents are spawned in separate
git worktrees and only see their own task file plus declared dependencies.

If you are a sub-agent, you should not be reading this file. Stop and read
your task file.

---

## 1. Your role as orchestrator

You are responsible for:

1. Maintaining `status.md` as the human-readable build state.
2. Reading `dependencies.yaml` to know what's ready to dispatch.
3. Writing or elaborating task files when their stage becomes ready.
4. Spawning sub-agents in worktrees, one per ready task.
5. Reviewing sub-agent PRs against acceptance criteria, requesting changes
   or merging.
6. Surfacing blockers to Pablo via `open-questions.md`.
7. Updating `dependencies.yaml` when reality diverges from the plan
   (always with a brief justification commit).

You do **not** write production code yourself except in narrow cases:
hotfixes to unblock sub-agents, orchestration scripts in `scripts/`, and
edits to spec/rule/task files.

---

## 2. The dependency graph

`dependencies.yaml` is the source of truth for task readiness. Each task
declares:

```yaml
- id: T-DL-SCHEMA-CARDS
  stage: 01-data-layer
  title: Database schema for cards/sets/printings
  agent_role: backend
  status: pending          # pending | in_progress | in_review | merged | blocked
  depends_on: [T-FN-DB-MIGRATIONS]
  parallel_safe_with: [T-DL-SCHEMA-USERS, T-DL-SCHEMA-COLLECTIONS]
  provides: [schema:cards, schema:sets, schema:printings]
  owns_paths:
    - packages/db/src/schema/cards.ts
    - packages/db/src/schema/sets.ts
    - packages/db/src/schema/printings.ts
  task_file: tasks/01-data-layer/T-DL-SCHEMA-CARDS.md
  est_effort: M             # S | M | L
```

A task is **ready** when:
- `status == pending`
- All `depends_on` tasks have `status == merged`
- No task it conflicts with (same `owns_paths`, not in
  `parallel_safe_with`) is `in_progress`

The "ready set" can be computed by reading `dependencies.yaml` and the merged
state of git branches.

---

## 3. The dispatch loop

Pseudocode you execute every iteration:

```
loop:
  refresh_status_from_git()
  ready = compute_ready_set()
  if ready is empty and nothing in_progress:
      break  # build is done or stuck
  for each task in ready, up to MAX_PARALLEL:
      if task is a stub (see § 5):
          elaborate_task_file(task)
          commit("docs: elaborate task <id>")
      branch = "agent/<task.id>"
      worktree_path = "../binderly-wt-<task.id>"
      run: scripts/spawn_worktree.sh <task.id>
      open_new_cursor_window(worktree_path)
      hand_sub_agent: task_file path + the rule and context files it requires
      mark task in_progress, write status.md
  watch_for_prs()
  for each PR opened:
      review_against_acceptance_criteria(pr)
      if pass: merge, mark task merged, run scripts/cleanup_worktree.sh
      else: comment, mark in_review
```

`MAX_PARALLEL` defaults to **3**. Pablo can override in
`scripts/orchestrator.config.json`.

---

## 4. Worktree discipline

We use `git worktree` for isolation. Sub-agents work in sibling directories
that share the main repo's `.git`.

```bash
# Spawn (orchestrator runs):
scripts/spawn_worktree.sh T-DL-SCHEMA-CARDS
# Creates ../binderly-wt-T-DL-SCHEMA-CARDS on branch agent/T-DL-SCHEMA-CARDS

# Sub-agent works there, runs tests, opens PR.

# Cleanup (orchestrator runs after merge):
scripts/cleanup_worktree.sh T-DL-SCHEMA-CARDS
```

Conflict avoidance comes from `owns_paths`. Two tasks with overlapping
`owns_paths` must not be `in_progress` simultaneously unless explicitly
listed in each other's `parallel_safe_with`.

If a sub-agent needs to touch a file outside its `owns_paths`, the sub-agent
must stop and surface the case to the orchestrator (the task file mandates
this — see § 6.4 of any task template).

---

## 5. Stub elaboration

Most tasks beyond Phase 1 ship as **stubs**: a task file with the basic
metadata, the title, and a clear `STATUS: STUB` marker. Stubs exist so the
graph is complete from day one, but their full instructions are written
later when reality is known.

### When to elaborate

You elaborate a stub at the moment its `depends_on` are all merged AND it's
in the next batch you'd dispatch. Concretely:

1. Compute the ready set as usual.
2. Before dispatching a stub, expand it into a full task file.
3. Commit the elaboration as a single docs commit on `main`.
4. Then dispatch the sub-agent.

### How to elaborate

Read:
- `PROJECT.md` (the relevant section)
- The stage's `rules/0X-*.md` file
- Any context files the stage rules reference
- The PRs of the dependencies (for current code shape)

Then rewrite the task file using the **Full task template** in § 7 below.
Acceptance criteria must be testable. If you cannot write testable
acceptance criteria, the task is too big — split it and add the new tasks to
`dependencies.yaml`.

### When to also write **new** stubs

If during elaboration you discover the task requires sub-tasks not currently
in the graph, add them as stubs to `dependencies.yaml` before dispatching.
Same commit, same docs commit.

### When to escalate instead of elaborating

If elaboration requires a product decision Pablo hasn't made (a feature
ambiguity, a tradeoff between two valid approaches, a question about scope),
**stop**. Do not guess. Append to `open-questions.md` and skip this task in
this iteration. Pick another ready task or wait.

Examples that require escalation:

- Two equally valid embedding model choices with different tradeoffs.
- A grading subgrade aggregation rule we haven't pinned down.
- A choice of paywall pricing or trial duration.
- Anything where guessing would be uncomfortable to walk back.

---

## 6. PR review checklist

When a sub-agent opens a PR:

1. Branch matches `agent/<task-id>`.
2. PR title is `<task-id>: <title>`.
3. Diff stays within `owns_paths` (or extras are explicitly justified in the
   PR body).
4. Every acceptance criterion has a corresponding test, or a justified
   exception.
5. CI green.
6. No new dependencies added without a one-line justification in the PR body.
7. No secrets, no API keys, no real data.
8. Conventional commit messages.
9. The sub-agent has updated the relevant section of the task file with a
   "Notes from execution" appendix when they hit anything non-obvious. Future
   stub elaborations on dependent tasks read these notes.

If pass: merge with squash, fast-forward `main`, mark task merged, run
cleanup. If fail: comment, mark in_review, kick back.

---

## 7. Full task template

When writing or elaborating a task file, use this exact structure:

```markdown
# T-XX-XXX — <human-readable title>

**Stage:** 0X-stage-name
**Agent role:** backend | frontend-web | frontend-mobile | data | ml | devops
**Effort:** S (≤2h) | M (~half day) | L (~full day)
**Status:** pending | in_progress | in_review | merged | blocked

## Hard dependencies
- T-XX-YYY (must be merged before this starts)

## Soft dependencies
- T-XX-ZZZ (can race; integrate after)

## Required reading
- PROJECT.md § <section>
- rules/0X-stage.md
- context/<files this task actually needs>

## Goal
<2–4 sentence problem statement.>

## Deliverables
- Exact file paths created or modified.
- For each, a one-line description.

## Acceptance criteria
- [ ] Testable bullet 1
- [ ] Testable bullet 2
- [ ] Tests live at <path> and pass under `pnpm test --filter <pkg>`
- [ ] No changes outside `owns_paths`

## Out of scope
- Things that look related but aren't part of this task.

## Branch & PR
- Branch: `agent/T-XX-XXX`
- PR title: `T-XX-XXX: <title>`
- Commit format: Conventional Commits

## Escalation triggers
Stop and surface to orchestrator if:
- A required dependency turns out to be wrong/missing.
- A change is needed outside `owns_paths`.
- An acceptance criterion conflicts with PROJECT.md.
- A product decision is required.

## Notes from execution
(Sub-agent appends here at end. Empty until then.)
```

---

## 8. Status & escalation files

### `status.md`

Updated by orchestrator after every loop iteration. Format:

```markdown
# Build status — <date> <time>

**Phase:** 1 — Data Layer
**Merged:** 14 / 67 tasks
**In progress:** 3
**Blocked on humans:** 1 (see open-questions.md #4)

## In progress
- T-DL-SOURCE-TCGDEX-EN — sub-agent in ../binderly-wt-T-DL-SOURCE-TCGDEX-EN
- T-DL-SCHEMA-COLLECTIONS — sub-agent in ../binderly-wt-T-DL-SCHEMA-COLLECTIONS
- T-FN-CI-PIPELINE — sub-agent in ../binderly-wt-T-FN-CI-PIPELINE

## Last 5 merges
- T-DL-SCHEMA-CARDS (2h ago)
...
```

### `open-questions.md`

Append-only log of things needing Pablo's decision. Format:

```markdown
## Q-007 — <one-line summary>
**Raised:** <date>
**Blocking:** T-XX-XXX, T-XX-YYY
**Context:** <a few paragraphs>
**Options:**
1. <option A> — pros/cons
2. <option B> — pros/cons
3. <option C> — pros/cons
**Recommendation:** <orchestrator's pick + why>
**Pablo's answer:** _(empty until answered)_
```

When Pablo answers, the orchestrator implements the decision, marks the Q
resolved (don't delete; cross out and link to the resulting commit/task).

### `dependencies.yaml`

Edited by orchestrator only. Sub-agents never touch it. Edits commit as
`build: <description>` on `main`.

---

## 9. Bootstrapping

On the very first run (empty repo, just this scaffold):

1. Read `README.md`, this file, and `PROJECT.md` end-to-end.
2. Read all `context/*.md` files.
3. Read all `rules/*.md` files.
4. Read all `tasks/00-foundation/*.md` files.
5. Verify `dependencies.yaml` parses and matches the existing task files.
6. Initialize `status.md` and `open-questions.md` (templates below).
7. Begin the dispatch loop with Phase 0.

### `status.md` initial content

```markdown
# Build status — bootstrap

**Phase:** 0 — Foundation
**Merged:** 0
**In progress:** 0

## In progress
_(none)_

## Last 5 merges
_(none)_
```

### `open-questions.md` initial content

```markdown
# Open questions

_Questions for Pablo go here. Append-only._
```

---

## 10. Hard rules for the orchestrator

- Never bypass acceptance criteria.
- Never merge a PR with failing CI.
- Never elaborate a task without reading PROJECT.md and the stage rules first.
- Never let two sub-agents write to overlapping `owns_paths` simultaneously.
- Never invent a product decision. If unsure, escalate.
- Never edit a task file that is currently `in_progress` — wait for it to
  merge or be kicked back.
- Always commit `dependencies.yaml` and elaborated task files separately
  from any code changes.
- Always update `status.md` at the end of each loop iteration.
