// ESLint flat config for @binderly/smart-collection-dsl. Pure
// TypeScript (zod schemas + AST transforms; no IO at any boundary)
// so the `node` preset is the right base — same shape as
// `@binderly/api-contracts` and `@binderly/auth`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    // Test files use Vitest globals via explicit imports; relax
    // rules that fight test ergonomics (mock fixtures often want
    // `any`, long describe blocks, console output during failure
    // debugging).
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
