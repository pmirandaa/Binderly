# Binderly

A Pokémon TCG collection tracker that's collection-first, not portfolio-first.
Mobile + web, fast stack scanning, BGS-style grading prediction, smart
collections, shareable public pages.

This repository is in the **specification stage**. No application code exists
yet. The contents of this repo are the implementation plan, ground rules, and
task graph that an AI coding agent (Cursor + Claude Opus 4.7) will execute to
build the actual product.

## If you are an AI agent

Read these in order, then stop:

1. `PROJECT.md` — the product spec (the north star)
2. `AGENT_ORCHESTRATOR.md` — how the build is run (orchestrator vs sub-agent)
3. The rules file for the stage you are in (`rules/0X-*.md`)
4. The specific task file you were dispatched to work on (`tasks/0X-*/T-*.md`)
5. Only the context files (`context/*.md`) that your task explicitly references

Do **not** load the entire repo into context. Tasks are designed to be
self-contained when read alongside their declared dependencies.

If you are the orchestrator agent, you are the only one allowed to read
`dependencies.yaml`, `status.md`, and `open-questions.md`. Sub-agents do not
read these — they only read what their task file points them at.

## If you are the human (Pablo)

The intended workflow:

1. Push this repo to GitHub (`git init`, `git remote add origin`, push).
2. Open the repo in Cursor.
3. Start a new chat with Opus 4.7 and tell it: *"Read README.md and
   AGENT_ORCHESTRATOR.md and act as the orchestrator. Begin Phase 0."*
4. Approve PRs as they land. Answer questions in `open-questions.md` when the
   orchestrator escalates. Repeat until shipped.

## Repo layout

```
PROJECT.md              Product spec
AGENT_ORCHESTRATOR.md   Orchestrator playbook
dependencies.yaml       Build graph (machine-readable)
status.md               Current build state (orchestrator updates this)
open-questions.md       Escalations awaiting human decision
context/                Shared knowledge (referenced by tasks)
rules/                  Per-stage ground rules
tasks/                  PR-sized work units, grouped by stage
scripts/                Orchestrator helpers (worktree management, etc.)
```

## State of this scaffold

| Area | State |
|---|---|
| Orchestration files | Complete |
| Context files | Complete |
| Rules files (all 12 stages) | Complete |
| Phase 0 (foundation) tasks | Fully written |
| Phase 1 (data layer) tasks | Fully written |
| Phase 2–11 tasks | Stubbed; orchestrator elaborates them when their stage becomes ready (see `AGENT_ORCHESTRATOR.md` § Stub Elaboration) |
