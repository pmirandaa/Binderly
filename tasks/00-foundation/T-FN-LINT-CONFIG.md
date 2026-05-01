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
_(empty)_
