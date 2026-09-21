# Binderly

A Pokémon TCG collection tracker that's collection-first, not portfolio-first.
Mobile + web, fast stack scanning, BGS-style grading prediction, smart
collections, shareable public pages.

Unofficial fan project. Not affiliated with The Pokémon Company or Nintendo.

## Status

**Feature-complete build, never deployed, no longer in active development.**

All 86 planned tasks across 11 build stages are merged: data layer, backend,
shared packages, web, mobile, card scanner, grading, shareable pages,
offline sync, billing and deployment scaffolding. Web, mobile and the Python
services all build, lint and typecheck. Roughly 100k lines of TypeScript and
Python with around 480 test files.

What never happened: production go-live (deploy paths are wired but inert
until real secrets are added) and real model training for grading, which
needs a labelled dataset. See `status.md` for the full record.

## Stack

- **Web:** Next.js, React, TanStack Query
- **Mobile:** Expo / React Native, SQLite offline store with a sync queue
- **Backend:** Supabase (Postgres, row-level security, Edge Functions), Drizzle migrations
- **Python services:** grading models, embeddings and ANN search for the scanner, ingestion
- **Data pipeline:** multi-source card ingestion, image pipeline, pricing rollups
- **Monorepo:** pnpm workspaces + Turborepo

A good place to start reading is `packages/smart-collection-dsl`: a small,
pure rule language (parser, evaluator, SQL compiler, explainer) with 212 tests.

## How it was built

Binderly was built by coding agents working from a written plan rather than
ad-hoc prompts. The product spec and ground rules were drafted by an agent
working adversarially with me, before any code was written. An orchestrator
agent then dispatched small, self-contained tasks from a dependency graph to
sub-agents. My role was direction: answering the escalations the orchestrator
raised and making the product decisions (`open-questions.md` has the trail).

The planning artifacts are all in the repo:

```
PROJECT.md              Product spec
AGENT_ORCHESTRATOR.md   Orchestrator playbook
dependencies.yaml       Build graph (machine-readable)
status.md               Build log, updated by the orchestrator each iteration
open-questions.md       Escalations that needed a human decision
context/                Shared knowledge referenced by tasks
rules/                  Per-stage ground rules
tasks/                  PR-sized work units, grouped by stage
scripts/                Orchestrator helpers (worktree management, etc.)
```

## Getting started

Binderly is a Turborepo monorepo managed with pnpm workspaces. Versions are
pinned exactly (no `^` / `~`) in `package.json`, `.nvmrc`, and
`pnpm-workspace.yaml`.

### Prerequisites

- **Node.js 22 LTS** — pinned in [`.nvmrc`](./.nvmrc). If you use
  [nvm](https://github.com/nvm-sh/nvm), run `nvm install` then `nvm use`.
- **pnpm** — managed by Node's built-in [Corepack](https://nodejs.org/api/corepack.html).
  Do **not** `npm i -g pnpm`. Instead:

  ```bash
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
  ```

  Corepack reads the `packageManager` field in `package.json` and pins pnpm
  for everyone working on the repo.

### Install & run

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # start every app in dev mode (Turbo fan-out)
pnpm build          # build everything
pnpm test           # run all tests
pnpm lint           # lint everything
pnpm typecheck      # typecheck everything
pnpm format         # format everything
```

All scripts delegate to Turbo; each workspace package may define its own
`dev` / `build` / `test` / `lint` / `typecheck` / `format` script. See
`turbo.json` for the task pipeline (caching, dependencies, outputs).

### Workspace layout

The workspace globs are declared in `pnpm-workspace.yaml`:

```
apps/*           # user-facing apps (web, mobile, api-python, …)
packages/*       # shared TypeScript packages
data-pipeline    # ingestion + standardization layer (single workspace)
```
