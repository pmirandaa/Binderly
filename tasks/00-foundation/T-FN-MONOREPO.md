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

### Versions pinned
- **Node.js:** `22.22.2` (latest Node 22 LTS "Jod" patch as of 2026-04-30,
  per https://nodejs.org/dist/index.json). Pinned in `.nvmrc` and
  `engines.node`.
- **pnpm:** `9.15.9` (latest `latest-9` dist-tag on npm). Pinned in
  `engines.pnpm` and `packageManager`. Activated via Corepack — *not*
  `npm i -g pnpm`.
- **Turborepo:** `2.9.6` (latest stable). Single root devDependency.
- **Corepack:** the system-shipped corepack `0.30.0` (bundled with
  Node 22.13.0) failed signature verification when preparing pnpm
  ("Cannot find matching keyid"); upgraded to corepack `0.34.7`
  (`npm i -g corepack@latest`) to resolve. Subsequent tasks
  bootstrapping new dev machines should `npm i -g corepack@latest`
  before `corepack enable`.

### Decisions
- **Workspace globs:** `apps/*`, `packages/*`, and the literal
  `data-pipeline` (per PROJECT.md § 3 layout, `data-pipeline/` is a
  single workspace, not a glob parent).
- **`turbo.json` schema:** Turbo 2.x `tasks` key (not the legacy
  `pipeline` key). `dev` is `persistent: true` + `cache: false`. `format`
  is `cache: false`. `build`/`test`/`typecheck` `dependsOn: ["^build"]`
  with appropriate `outputs` for caching.
- **`globalDependencies`:** added `**/.env.*`, `.nvmrc`, and
  `tsconfig.base.json` so cache invalidates when any of those change
  (the `tsconfig.base.json` reference is forward-looking; T-FN-TS-CONFIG
  will create that file).
- **`engines` enforcement:** pnpm does not strict-check `engines.node` by
  default (only warns). Verification for this task ran on locally
  available Node `v22.13.0` (already installed via nvm); the `.nvmrc`
  pin to `22.22.2` is what new contributors will land on. The `Unsupported
  engine` warning during `pnpm install` is therefore expected on any
  machine that hasn't yet run `nvm install` against this repo's `.nvmrc`.
- **`.gitignore`:** kept comprehensive (Node, build outputs across all
  toolchains we know we'll use, Python venv, Expo/EAS signing material,
  OS junk, IDE droppings) so subsequent foundation tasks don't have to
  amend it for routine additions.
- **`README.md`:** appended a "Getting started" section only; the
  pre-existing scaffold-state content above was left untouched per the
  task spec.

### Execution-environment note (escalation)
The system-default `node --version` on this machine is `v16.14.2`. Node
22 LTS (`v22.13.0`) was already installed via `nvm` and used in-shell
(`nvm use 22`) for verification — no system-wide install or default
switch was performed. If subsequent foundation tasks run on the same
machine, they should activate Node 22 in their shell the same way.

### Acceptance criteria — all green
- `pnpm install` → exit 0 (lockfile committed).
- `pnpm dev` → exit 0 ("0 packages, no tasks executed", as expected).
- `pnpm build` → exit 0 (same).
- `pnpm test` → exit 0 (same).
- `pnpm lint` → exit 0 (same).
- `pnpm typecheck` → exit 0 (same).
- `node_modules/` confirmed gitignored (`git check-ignore -v`).
- No `apps/<x>` or `packages/<x>` beyond `.gitkeep`.
- Corepack documented in README "Getting started".

### Out-of-scope work explicitly NOT done
- No ESLint / Prettier config (T-FN-LINT-CONFIG).
- No shared `tsconfig.base.json` (T-FN-TS-CONFIG).
- No `apps/web`, `apps/mobile`, `apps/api-python`, no `packages/*`
  beyond placeholders.
- No Docker / Compose, no GitHub Actions, no env scaffolding —
  separate foundation tasks per `dependencies.yaml` (orchestrator owns).
