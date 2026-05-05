// ESLint flat config for @binderly/api-contracts. The package is pure
// TypeScript (zod schemas + inferred types — no IO, no runtime
// behaviour) so the `node` preset is the right base, matching
// `@binderly/db` and `@binderly/data-pipeline`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    // Test files use vitest globals via explicit imports; relax rules
    // that fight test ergonomics (mock fixtures often want `any`,
    // long describe blocks).
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
