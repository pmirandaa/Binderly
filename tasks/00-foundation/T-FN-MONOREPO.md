# T-FN-MONOREPO — Initialize Turborepo monorepo with pnpm

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** pending

## Hard dependencies
_(none — this is the first task)_

## Soft dependencies
_(none)_

## Required reading
- PROJECT.md § 3 (Tech Stack), § 4 (Infra)
- rules/00-foundation.md
- context/tech-stack.md
- context/conventions.md

## Goal
Bootstrap the monorepo skeleton: pnpm workspaces, Turborepo task pipeline,
the root `package.json`, `.nvmrc`, and a top-level `.gitignore`. After this
task lands, subsequent foundation tasks can each create their own packages
and apps under the existing skeleton.

## Deliverables

- `package.json` — root, with `name: binderly`, `private: true`, scripts
  for `dev`, `build`, `test`, `lint`, `typecheck`, `format` all delegating
  to Turbo.
- `pnpm-workspace.yaml` — declares `apps/*`, `packages/*`, `data-pipeline`
  as workspaces.
- `turbo.json` — pipeline definition with `dev`, `build`, `test`, `lint`,
  `typecheck` tasks; correct `dependsOn` between them; cache configuration.
- `.nvmrc` — Node version pin (e.g., `22.11.0`; pick the latest stable LTS
  patch at execution time).
- `.gitignore` — covers `node_modules`, build outputs, `.env*` (not
  `.env.example`), OS junk, IDE files.
- `apps/.gitkeep`, `packages/.gitkeep`, `data-pipeline/.gitkeep` — empty
  placeholders so the directories exist.
- `README.md` — already exists at the repo root from the spec scaffold;
  do not overwrite. If you need to add a "Getting started" snippet,
  append at the bottom.

## Acceptance criteria

- [ ] `pnpm install` runs cleanly with no errors.
- [ ] `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`
      all execute and exit 0 (with no work to do — printing "no tasks
      found" or similar is fine).
- [ ] `corepack` is documented in the README as the recommended pnpm
      install path.
- [ ] Versions pinned exactly (no `^` / `~` in `package.json`).
- [ ] No `node_modules` committed.
- [ ] No `apps/<anything>` or `packages/<anything>` is created beyond
      empty `.gitkeep` placeholders.

## Out of scope

- ESLint/Prettier setup — that's T-FN-LINT-CONFIG.
- TypeScript shared config — that's T-FN-TS-CONFIG.
- Any `apps/web`, `apps/mobile`, etc. — those come in their stages.

## Branch & PR

- Branch: `agent/T-FN-MONOREPO`
- PR title: `T-FN-MONOREPO: Initialize Turborepo monorepo with pnpm`
- Commits: Conventional Commits

## Escalation triggers

- pnpm or Turborepo behavior diverges from the documented config in a way
  that suggests the version pinning is wrong.
- A required Node feature (e.g., a corepack flag) is unstable on the
  pinned version.

## Notes from execution
_(empty)_
