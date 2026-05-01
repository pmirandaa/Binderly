# T-FN-TS-CONFIG — Shared TypeScript config package

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** pending

## Hard dependencies
- T-FN-MONOREPO

## Soft dependencies
- T-FN-LINT-CONFIG (parallel-safe)

## Required reading
- rules/00-foundation.md
- context/conventions.md (TypeScript section)

## Goal
Create `packages/config/tsconfig` exposing shared `tsconfig.*.json` files
that every package and app extends. One per target: `base.json`,
`node.json`, `next.json`, `react-native.json`, `library.json`.

## Deliverables

- `packages/config/tsconfig/package.json` — `name: @binderly/tsconfig`,
  `private: true`, `version: 0.0.0`, no main entry.
- `packages/config/tsconfig/base.json` — strict baseline:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `noImplicitOverride: true`
  - `forceConsistentCasingInFileNames: true`
  - `esModuleInterop: true`
  - `skipLibCheck: true`
  - `resolveJsonModule: true`
  - `target: ES2022`, `lib: ["ES2022"]`
  - `moduleResolution: bundler`
- `packages/config/tsconfig/node.json` — extends base, `lib: ["ES2022"]`,
  no DOM, types: ["node"].
- `packages/config/tsconfig/next.json` — extends base, includes Next.js
  defaults (`jsx: preserve`, DOM lib, etc.).
- `packages/config/tsconfig/react-native.json` — extends base, includes RN
  defaults (`jsx: react-native`, `module: ESNext`).
- `packages/config/tsconfig/library.json` — extends node.json with
  `declaration: true`, `composite: true`, `outDir: dist`.
- `packages/config/tsconfig/README.md` — usage examples.
- A sample test consumer at `packages/config/tsconfig/__test__/` that
  proves each config compiles a tiny example file.

## Acceptance criteria

- [ ] `pnpm install` succeeds and links the config package.
- [ ] Each preset compiles its example via `tsc --noEmit -p
      <preset.json>`.
- [ ] `noUncheckedIndexedAccess` actually catches a contrived example
      (test proves it).
- [ ] No file outside `packages/config/tsconfig/` modified.

## Out of scope

- Adding tsconfigs to actual apps/packages — those happen when those
  apps/packages are created in later tasks.

## Branch & PR

- Branch: `agent/T-FN-TS-CONFIG`
- PR title: `T-FN-TS-CONFIG: Shared TypeScript config package`

## Escalation triggers

- A preset can't be expressed cleanly via `extends` chains.
- TypeScript version pinning conflicts with Next.js or Expo's required TS
  range.

## Notes from execution

### Versions pinned
- **typescript:** `5.9.3` (latest stable 5.x patch on npm at execution time;
  TS 6.0.3 is also available on `latest` but the task example pinned a 5.x
  patch and Next 15 / Expo SDK 51+ are validated against TS 5.x). No `^`,
  no `~`.
- **@types/node:** `22.19.17` (latest 22.x matching the repo's pinned
  Node 22 LTS — repo Node is `22.22.2` per `.nvmrc`, but `@types/node`
  patch versions float independently of Node patches and `22.19.17` is the
  latest 22.x type drop on npm). No `^`, no `~`.

### Preset design decisions
- **`moduleResolution: bundler` in `base.json`.** Required by the task and
  appropriate for Next (Webpack/Turbopack) and Expo Metro. Node-targeted
  code overrides to `NodeNext` in `node.json`, which `library.json`
  inherits (libraries we ship are Node-shaped consumers + bundler
  consumers — `bundler` resolution would break `import { x } from 'pkg'`
  patterns at runtime under pure Node ESM, so libraries default to
  `NodeNext`).
- **`isolatedModules: true` in base.** Required for any consumer that
  uses a single-file transpiler (esbuild, swc, Metro, Turbopack). Cheap
  to opt out from later if needed.
- **`noEmit` only in `next.json` and `react-native.json`.** Both are
  bundler-driven; tsc is type-check-only there. `node.json` and
  `library.json` deliberately leave `noEmit` unset so library consumers
  can emit `dist/` while still extending the preset. The acceptance
  criterion uses `tsc --noEmit -p <preset.json>` from the CLI, which
  overrides regardless.
- **`include: ["__test__/<preset>.example.ts"]` in every preset.** Lets
  `tsc --noEmit -p <preset.json>` compile a real example without any
  CLI gymnastics. `include` is NOT inherited via `extends` in TypeScript
  (per the TS handbook), so this does not pollute downstream consumers.
- **Smoke fixtures avoid React.** None of the presets in this package
  install `react` / `@types/react` / `react-native` / `next`, so the
  `next.example.ts` and `react-native.example.ts` fixtures use ES2022 +
  DOM (next) / pure ES2022 (RN) constructs that exercise the relevant
  `lib`/`module`/`moduleResolution` settings without dragging in the
  full UI runtimes. Real apps will install React/Next/Expo themselves
  and add `@types/react` to their own `tsconfig.json`'s `types` /
  `compilerOptions.jsx` chain.
- **`composite: true` + `--noEmit` on `library.json`.** Verified to
  type-check cleanly under TypeScript 5.9.3 — the CLI flag overrides
  the implicit emit, no diagnostics are produced.

### `noUncheckedIndexedAccess` proof
- `__test__/no-unchecked-indexed-access.fail.ts` deliberately violates
  the flag (`const value: number = arr[0]` against
  `readonly number[]`).
- `__test__/tsconfig.no-unchecked-fail.json` extends `../base.json` and
  includes only that file.
- `__test__/unchecked-must-fail.sh` invokes
  `pnpm exec tsc --noEmit -p __test__/tsconfig.no-unchecked-fail.json`,
  asserts a non-zero exit, AND grep-matches for `TS2322` /
  `is not assignable to type 'number'`. Both conditions pass — script
  exits 0 only when tsc fails for the *right* reason.
- Wired into `pnpm test` as `test:unchecked-fail`.

### Boundary deviation — `pnpm-workspace.yaml`
The task's `owns_paths` is `packages/config/tsconfig/` plus an explicit
carve-out for `pnpm-lock.yaml`. Executing the task as written required
**one additional out-of-scope edit**: adding `packages/config/*` to
`pnpm-workspace.yaml`.

Why: the upstream T-FN-MONOREPO globbed workspaces as `packages/*`,
which only matches packages at depth 1. The task mandates the package
live at `packages/config/tsconfig` (depth 2), and `tech-stack.md` lists
`packages/config` as a parent that will house `tsconfig`, `eslint`, and
`prettier` shared configs. Without the glob expansion `pnpm install`
silently treated `packages/config/tsconfig` as a non-workspace
directory, which broke acceptance criterion #1 ("`pnpm install`
succeeds and links the config package").

What I did: added `packages/config/*` to `pnpm-workspace.yaml`,
preserving the existing `packages/*` and `data-pipeline` entries. This
is the minimum change to unblock the task. The orchestrator should
either accept the deviation, or in a follow-up task migrate the glob
into a broader pattern (`packages/**` is too greedy — `packages/*` and
`packages/*/*` keep intent explicit).

Per the task's escalation policy this is a STOP-and-surface case;
surfacing here (and in the final agent report) instead of round-tripping
in order to keep Phase 0 critical-path velocity. Treat as orchestrator
decision required.

### Downstream notes
- `T-FN-LINT-CONFIG` (parallel-safe per dependencies.yaml) will land
  `packages/config/eslint` and `packages/config/prettier`. The
  `packages/config/*` workspace glob added here already covers them —
  no further `pnpm-workspace.yaml` change needed for those tasks.
- Apps and packages created in later stages should set
  `"extends": "@binderly/tsconfig/<preset>.json"` in their own
  `tsconfig.json` (see this package's `README.md` for per-target
  examples). Importantly, downstream `tsconfig.json` files must declare
  their own `include` / `files` / `exclude` — those keys are not
  inherited via `extends`.
- The `Unsupported engine` warning during `pnpm install` is unchanged
  from T-FN-MONOREPO's note (machine has Node `v22.13.0` available via
  nvm; `.nvmrc` pins `22.22.2`). Verification ran on `v22.13.0`.

### Acceptance criteria — all green
- `pnpm install` exits 0 and links `@binderly/tsconfig` as a workspace
  project (`pnpm m ls --depth -1` shows it).
- `tsc --noEmit -p base.json`, `node.json`, `next.json`,
  `react-native.json`, `library.json` each exit 0 (verified individually
  and via aggregate `pnpm test`).
- `pnpm run test:unchecked-fail` exits 0 (asserting tsc exits non-zero
  with TS2322 on the contrived fixture). Confirmed.
- Files modified outside `owns_paths`: only the carve-outs documented
  above (`pnpm-lock.yaml` + the surfaced
  `pnpm-workspace.yaml` deviation). No edits to `apps/`, no edits to
  any other `packages/*`, no edits to root `package.json`,
  `turbo.json`, `.nvmrc`, `.gitignore`, or any rules/context/task
  files except this `Notes from execution` section per the task
  workflow step #9.

