// ESLint flat config for @binderly/feature-flags. The package is a pure
// TypeScript decision core (no I/O, no React) built on top of
// @binderly/entitlements, so the `node` preset is the right base — same
// shape as `@binderly/entitlements` / `@binderly/set-completion`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
