# @binderly/eslint-config

Shared ESLint flat configurations for every Binderly app and package.

## Presets

| Entry point                            | Use case                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@binderly/eslint-config`              | Base — TypeScript / JavaScript, import sort, unused-imports, no-console (except warn/error). Extend this in pure-TS packages. |
| `@binderly/eslint-config/node`         | Base + Node globals + `eslint-plugin-n`. Use in `data-pipeline`, scripts, and any Node-only service.                          |
| `@binderly/eslint-config/react`        | Base + `eslint-plugin-react` + `eslint-plugin-react-hooks`. Use for React libraries that aren't Next.js or React Native.      |
| `@binderly/eslint-config/next`         | React preset + `@next/eslint-plugin-next` (recommended + core-web-vitals). Use in `apps/web`.                                 |
| `@binderly/eslint-config/react-native` | React preset + `eslint-plugin-react-native`. Use in `apps/mobile`.                                                            |

## Usage

In a consumer package's `eslint.config.js`:

```js
import baseConfig from '@binderly/eslint-config';

export default [
  ...baseConfig,
  {
    // package-specific overrides
  },
];
```

For the React Native app:

```js
import rnConfig from '@binderly/eslint-config/react-native';

export default [...rnConfig];
```

## Import order (enforced)

The base preset enforces the order from `context/conventions.md`:

1. Built-in modules (e.g. `node:fs`)
2. External packages (npm)
3. `@binderly/*` workspace packages
4. Relative imports (`../`, `./`)

A blank line is required between groups; entries within a group are
alphabetised case-insensitively.

## Flat config vs legacy

All five presets are flat config (`eslint.config.js`-style). All required
plugins were verified to work in flat config under ESLint 9.x:

- `typescript-eslint` v8 — first-class flat config (`tseslint.configs.*`).
- `eslint-plugin-react` v7.37 — `configs.recommended.rules` consumed
  directly.
- `eslint-plugin-react-hooks` v5.2 — `configs.recommended.rules` consumed
  directly.
- `@next/eslint-plugin-next` v16 — `configs.recommended` and
  `core-web-vitals` consumed directly.
- `eslint-plugin-react-native` v5 — legacy-shaped plugin; registered
  manually in a flat-config block. No legacy `.eslintrc` fallback was
  needed.
- `eslint-plugin-import` v2.32 — has experimental flat-config helpers but
  we register it manually for control. `import/order` works exactly as
  specified.
- `eslint-plugin-n` v17 — first-class flat config support.
- `eslint-plugin-unused-imports` v4 — first-class flat config support.
