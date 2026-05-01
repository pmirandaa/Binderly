# T-DL-MASTER-SET-RULES — Master set rules engine — per-set flags + tests

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M
**Status:** STUB — must be elaborated by the orchestrator before dispatch.

---

> ## STUB — Orchestrator instructions
>
> This task file is intentionally incomplete. The orchestrator agent
> elaborates it into a full task per the template in
> `AGENT_ORCHESTRATOR.md` § 7 (Full task template) **at the moment all
> hard dependencies have merged AND this task is in the next batch to
> dispatch**.
>
> **Steps to elaborate:**
>
> 1. Read `PROJECT.md` (especially § 6 (Data Model), § 7 (Sources & Standardization), § 8 (Master Set)) and any
>    referenced sections.
> 2. Read `rules/01-data-layer.md` (the stage rules).
> 3. Read every context file referenced by the stage rules.
> 4. Read the merged code from each `depends_on` task — the actual
>    diffs that landed, not just their task files. Reality may have
>    diverged from the original plan; align this task with what
>    actually exists.
> 5. If the work needs additional sub-tasks not in
>    `dependencies.yaml`, add them as additional stub entries (in the
>    same docs commit) before dispatching this one.
> 6. Rewrite this file using the full template. Replace the entire
>    "STUB" section above with the elaborated task. Keep the
>    metadata at the top (Stage, Agent role, Effort) accurate.
> 7. **Acceptance criteria must be testable.** If you cannot write
>    testable criteria, the task is too big — split it.
> 8. Commit as `docs(tasks): elaborate T-DL-MASTER-SET-RULES`.
> 9. Then dispatch the sub-agent.
>
> **Escalate instead of guessing if:**
>
> - A product decision is required (feature ambiguity, tradeoff between
>   two valid approaches, scope question).
> - The merged dependencies suggest the task as scoped is no longer
>   correct or necessary.
> - The work as scoped would require touching paths outside this
>   task's `owns_paths` and other tasks own them.
>
> Append to `open-questions.md` and skip this task in the iteration.

---

## Provisional metadata (from `dependencies.yaml`)

**Hard dependencies:**

- T-DL-SCHEMA-CARDS
- T-DL-SOURCE-INTERFACES

**Parallel-safe with:** _(none)_

**Owns paths:**

- `data-pipeline/src/master-set/`

## Provisional goal

Master set rules engine — per-set flags + tests.

(One paragraph from the orchestrator goes here at elaboration time
describing the problem this task solves and how it fits into the
stage.)

## Provisional reading list

- PROJECT.md § 6 (Data Model), § 7 (Sources & Standardization), § 8 (Master Set)
- rules/01-data-layer.md
- (context files added at elaboration time based on the stage rules)

## Branch & PR

- Branch: `agent/T-DL-MASTER-SET-RULES`
- PR title: `T-DL-MASTER-SET-RULES: Master set rules engine — per-set flags + tests`

## Notes from execution
_(empty until the sub-agent runs)_
