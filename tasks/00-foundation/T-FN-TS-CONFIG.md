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
_(empty)_
