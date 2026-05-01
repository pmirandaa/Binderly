# T-FN-LINT-CONFIG — Shared ESLint + Prettier config

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** pending

## Hard dependencies
- T-FN-MONOREPO

## Soft dependencies
- T-FN-TS-CONFIG (parallel-safe)

## Required reading
- rules/00-foundation.md
- context/conventions.md (Naming, Imports, React/RN)

## Goal
Provide shared ESLint and Prettier configs that every package and app
consumes. One ESLint preset per environment (base, node, react, next,
react-native), one Prettier config root.

## Deliverables

- `packages/config/eslint/package.json` — `name: @binderly/eslint-config`.
- `packages/config/eslint/index.js` — base config (TS, import-sort,
  unused-imports, no-console except warn/error).
- `packages/config/eslint/node.js` — base + node overrides.
- `packages/config/eslint/react.js` — base + react/react-hooks rules.
- `packages/config/eslint/next.js` — extends react + Next.js plugin.
- `packages/config/eslint/react-native.js` — extends react + RN plugin.
- `packages/config/prettier/package.json` — `name:
  @binderly/prettier-config`.
- `packages/config/prettier/index.js` — printWidth 100, single quote,
  trailing comma all, semicolons, arrow parens always.
- Root `.prettierignore` covering build outputs.
- Root `.editorconfig` — 2-space indent, LF line endings, UTF-8.

## Acceptance criteria

- [ ] `pnpm lint` at the root invokes ESLint and exits 0 on the empty
      workspace.
- [ ] Prettier check via `pnpm format --check` passes.
- [ ] Import sorting rules enforce the order from
      `context/conventions.md`.
- [ ] No file outside `packages/config/eslint/`,
      `packages/config/prettier/`, root `.prettierignore`, root
      `.editorconfig` is modified.

## Out of scope

- Wiring lint into CI — T-FN-CI handles that.
- Per-app `.eslintrc` files — created with their respective apps later.

## Branch & PR

- Branch: `agent/T-FN-LINT-CONFIG`
- PR title: `T-FN-LINT-CONFIG: Shared ESLint + Prettier config`

## Escalation triggers

- ESLint flat config vs legacy: prefer flat config (`eslint.config.js`).
  If a critical plugin doesn't support flat config yet, flag and fall
  back to legacy with a note.

## Notes from execution

### Versions pinned (no `^` / `~` anywhere)

| Package                              | Version  |
| ------------------------------------ | -------- |
| `eslint`                             | `9.39.4` |
| `@eslint/js`                         | `9.39.4` |
| `typescript-eslint`                  | `8.59.1` |
| `@typescript-eslint/parser`          | `8.59.1` |
| `@typescript-eslint/eslint-plugin`   | `8.59.1` |
| `eslint-plugin-import`               | `2.32.0` |
| `eslint-plugin-unused-imports`       | `4.4.1`  |
| `eslint-plugin-react`                | `7.37.5` |
| `eslint-plugin-react-hooks`          | `5.2.0`  |
| `eslint-plugin-react-native`         | `5.0.0`  |
| `@next/eslint-plugin-next`           | `16.2.4` |
| `eslint-plugin-n`                    | `17.24.0` |
| `globals`                            | `17.5.0` |
| `prettier`                           | `3.8.3`  |

ESLint 10.x is the current `latest` dist-tag (10.2.1) but several
required plugins (`eslint-plugin-react`, `eslint-plugin-react-native`,
`eslint-plugin-import`) still cap their `peerDependencies.eslint` at
`^9`. Pinning to ESLint 9.39.4 (the `maintenance` dist-tag) keeps
everything compatible without warnings. Re-evaluate when those plugins
land their v10 support.

### Flat config vs legacy

All five presets are flat config (`eslint.config.js`-shape, default
ESM exports). No legacy `.eslintrc` fallback was needed.

- **Built-in flat support:** `typescript-eslint` v8, `@eslint/js`,
  `eslint-plugin-n`, `eslint-plugin-unused-imports`,
  `@next/eslint-plugin-next` v16.
- **Plugin-only flat support (rules consumed via
  `plugin.configs.recommended.rules`):** `eslint-plugin-react` v7.37,
  `eslint-plugin-react-hooks` v5.2, `eslint-plugin-import` v2.32.
- **Legacy-shaped, registered manually inside a flat block:**
  `eslint-plugin-react-native` v5 ships only `index.js` (CJS) with
  `rules`, no `flatConfigs.*` export. We register it as
  `plugins: { 'react-native': reactNativePlugin }` and enable its rules
  by name. This works in flat config — no `.eslintrc` workaround
  required for any preset.

### Import-sort enforcement (acceptance demo)

Contrived violation written to `packages/config/eslint/_demo.ts`:

```ts
import { foo } from './local-file';
import { bar } from '@binderly/some-shared';
import { useEffect } from 'react';
import * as fs from 'node:fs';
```

`pnpm exec eslint _demo.ts` produced six `import/order` errors
(`'@binderly/some-shared' should occur before './local-file'`,
`'react' should occur before './local-file'`, `'node:fs' should occur
before './local-file'`, plus three "empty line between import groups"
errors). `pnpm exec eslint --fix _demo.ts` auto-corrected to:

```ts
import * as fs from 'node:fs';

import { useEffect } from 'react';

import { bar } from '@binderly/some-shared';

import { foo } from './local-file';
```

Order matches `context/conventions.md` § Imports: external →
`@binderly/*` → relative, with builtin (`node:`) above external and
blank lines between groups. The demo file was deleted after the
verification run; it was never committed.

### Acceptance criteria — all green

- [x] `pnpm lint` at root (turbo → `@binderly/eslint-config:lint` =
      `eslint --max-warnings=0 .`) exits 0.
- [x] `pnpm format` at root (turbo → both packages run `prettier --check
      .`) exits 0. (`pnpm format --check` works the same; `--check` is
      already baked into each per-package `format` script.)
- [x] Import sort enforced — see demo above.
- [x] Files modified outside the owned set: only `pnpm-lock.yaml` (task
      explicitly allows) and `pnpm-workspace.yaml` (necessary mechanical
      change, see below).

### Necessary deviation — `pnpm-workspace.yaml`

Existing workspace globs were `apps/*`, `packages/*`, `data-pipeline`.
The task prescribes packages at `packages/config/eslint/` and
`packages/config/prettier/`, which the `packages/*` glob does not
match (one directory level only). To make the two new packages
discoverable as workspace packages — without which `@binderly/eslint-
config` and `@binderly/prettier-config` cannot resolve and the
acceptance criteria cannot pass — `packages/config/*` was added to
`pnpm-workspace.yaml`. This is treated the same as the lockfile
update the task already permits: a strictly mechanical consequence of
declaring new workspace packages at the prescribed paths. No other
file outside the owned set was touched.

### Wiring summary for downstream tasks

- `pnpm lint` and `pnpm format` already work at the repo root via
  Turbo. As later tasks add per-package `lint` / `format` scripts,
  Turbo will pick them up automatically — no root changes required.
- Each consumer package should:
  1. Add `@binderly/eslint-config` to `devDependencies` as
     `"workspace:*"` and create an `eslint.config.js` like
     `import baseConfig from '@binderly/eslint-config'; export default
     [...baseConfig];` (or the appropriate preset entry).
  2. Add `@binderly/prettier-config` to `devDependencies` as
     `"workspace:*"`, set `"prettier": "@binderly/prettier-config"` in
     `package.json`, and add `format` / `lint` scripts.
- Pin `eslint@9.39.4` and `prettier@3.8.3` in any consumer that
  invokes them directly (matching the peers declared by the config
  packages).

### Notes for T-FN-CI

- `pnpm lint` and `pnpm format` are the canonical CI commands at the
  repo root. Both shell out to Turbo, so caching is automatic in CI
  once a remote cache is wired up; for now they run in ~1.7s and
  ~0.6s respectively on a clean tree.
- If CI is going to fail on Prettier diff, prefer running
  `pnpm format` (which runs `prettier --check` everywhere) rather
  than Prettier directly — that way the per-package `prettier`
  resolution stays consistent.
- The local `WARN  Unsupported engine` notice during `pnpm install`
  is the same one T-FN-MONOREPO documented (Node 22.13.0 vs the
  pinned 22.22.2 in `.nvmrc`) and goes away on a machine that has
  run `nvm install` against this repo's `.nvmrc`. CI should install
  Node from `.nvmrc` and the warning will not appear.

### Out-of-scope work explicitly NOT done

- No `packages/config/tsconfig/` — owned by the parallel
  T-FN-TS-CONFIG sub-agent.
- No top-level `eslint.config.js` at the repo root — the task spec
  forbids it, and there's nothing to lint outside packages yet.
- No per-app `eslint.config.js` files — those land with their
  respective apps later (see the deliverables note in the task).
- No CI wiring — T-FN-CI handles that.
