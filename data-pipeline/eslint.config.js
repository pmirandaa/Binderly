// ESLint flat config for @binderly/data-pipeline. The package is Node-only
// (HTTP adapters, normalizers, resolver, CLI ingest scripts), so the
// `node` preset is the right base — same shape as packages/db.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**', '__test__/**'],
  },
  {
    // Test files use Vitest globals via explicit imports; relax rules
    // that fight the test ergonomics (e.g. `any` in mock fixtures, long
    // describe blocks).
    files: ['src/**/*.test.ts', '__test__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
