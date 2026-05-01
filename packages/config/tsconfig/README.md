# `@binderly/tsconfig`

Shared TypeScript configuration presets that every Binderly package and app
extends. **No runtime code, types-only by virtue of `extends` chains.**

## Presets

| File                  | Use it when…                                            | Extends         |
| --------------------- | ------------------------------------------------------- | --------------- |
| `base.json`           | You're not sure — start here. Strict baseline.          | _(root)_        |
| `node.json`           | Node-only code (CLIs, scripts, edge functions, server). | `./base.json`   |
| `next.json`           | A Next.js (App Router) app.                             | `./base.json`   |
| `react-native.json`   | Expo / React Native code.                               | `./base.json`   |
| `library.json`        | A publishable / consumable shared package with `dist/`. | `./node.json`   |

The base preset is opinionated:

- `strict: true` (no implicit any, all the strict family).
- `noUncheckedIndexedAccess: true` — array/object indexed access yields
  `T | undefined`. **The codebase relies on this**; turning it off in a
  consumer means breaking ranks. Don't.
- `noImplicitOverride: true` — must say `override` when overriding.
- `forceConsistentCasingInFileNames: true`.
- `esModuleInterop: true`, `skipLibCheck: true`, `resolveJsonModule: true`,
  `isolatedModules: true`.
- `target: ES2022`, `lib: ["ES2022"]`, `module: ESNext`.
- `moduleResolution: "bundler"` — works for Next, Metro, tsup, Vite. Node
  packages override to `NodeNext` (see `node.json`).

## Usage

In a consumer package's `tsconfig.json`:

```json
{
  "extends": "@binderly/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

`extends`, `compilerOptions`, `references`, and `watchOptions` from a base
config inherit. **`files`, `include`, and `exclude` do _not_ inherit** — each
consumer sets its own. (That's why each preset in this package can keep its
own `include` pointing at `__test__/<preset>.example.ts` without polluting
downstream consumers.)

### Per-target consumer examples

```jsonc
// apps/web/tsconfig.json (Next.js)
{
  "extends": "@binderly/tsconfig/next.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

```jsonc
// apps/mobile/tsconfig.json (Expo / React Native)
{
  "extends": "@binderly/tsconfig/react-native.json",
  "include": ["app", "src", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".expo"]
}
```

```jsonc
// packages/<name>/tsconfig.json (shared library)
{
  "extends": "@binderly/tsconfig/library.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "**/*.test.ts"]
}
```

```jsonc
// data-pipeline/tsconfig.json (Node CLI)
{
  "extends": "@binderly/tsconfig/node.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

## Verification

This package self-checks via `pnpm test`:

- `pnpm test:base` / `:node` / `:next` / `:react-native` / `:library` each
  run `tsc --noEmit -p <preset.json>` against a tiny example file in
  `__test__/`. Every preset must compile its example.
- `pnpm test:unchecked-fail` compiles a contrived fixture that violates
  `noUncheckedIndexedAccess` and asserts `tsc` exits non-zero with TS2322.
  This proves the flag is actually applied by `base.json` (and, transitively,
  every preset that extends it).

## Pinned versions

- `typescript`: `5.9.3` (latest stable 5.x patch as of foundation phase).
- `@types/node`: `22.19.17` (matches the repo's pinned Node 22 LTS).

Both are pinned exactly — no `^`, no `~`. Foundation-stage rule.

## Adding a new preset

1. Create `packages/config/tsconfig/<name>.json` with `extends` pointing at
   the closest existing preset. Override only what differs.
2. Add a smoke fixture at `__test__/<name>.example.ts`.
3. Add `"include": ["__test__/<name>.example.ts"]` to the new preset.
4. Add `test:<name>` and chain it into the aggregate `test` script in
   `package.json`.
5. Document the preset in this README's table.
