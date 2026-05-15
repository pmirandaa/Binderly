// ESLint flat config for @binderly/set-completion. The package is pure
// TypeScript (no IO, no runtime side effects — just functions over
// arrays + Maps), so the `node` preset is the right base, matching
// `@binderly/api-contracts` / `@binderly/auth` / `@binderly/db`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    // Test files use Vitest globals via explicit imports; relax rules
    // that fight test ergonomics (mock fixtures often want `any`,
    // long describe blocks, console use during failure debugging).
    files: ['src/**/*.test.ts', 'src/test-fixtures.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
