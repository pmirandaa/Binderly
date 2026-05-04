// ESLint flat config for @binderly/db. The package is Node-only (driver,
// scripts, schema definitions), so the `node` preset is the right base.
//
// We also exclude generated SQL and the drizzle migration metadata folder
// from linting so that drizzle-kit's outputs never trigger style noise.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'src/migrations/**', '__test__/**'],
  },
  {
    // CLI scripts intentionally signal failure via `process.exit(<code>)`
    // so the parent shell sees a meaningful exit code; the n-plugin's
    // suggestion to throw doesn't apply to top-level entry points.
    files: ['scripts/**/*.ts'],
    rules: {
      'n/no-process-exit': 'off',
    },
  },
];
