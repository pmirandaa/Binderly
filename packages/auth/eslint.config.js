// ESLint flat config for @binderly/auth. The package is Node-only
// (server-side helpers; the SDK still works in Edge runtimes too,
// but the helpers themselves are framework-agnostic Node code), so
// the `node` preset is the right base — same shape as `packages/db`
// and `data-pipeline`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**', '__test__/**'],
  },
  {
    // Test files use Vitest globals via explicit imports; relax rules
    // that fight the test ergonomics (e.g. `any` in mock fixtures,
    // long describe blocks, console use during failure debugging).
    files: ['src/**/*.test.ts', '__test__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
