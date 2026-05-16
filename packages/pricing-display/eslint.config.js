// ESLint flat config for @binderly/pricing-display. Pure-logic
// package (no I/O, no runtime side effects), so the `node` preset
// is the right base — same shape as `@binderly/set-completion` and
// `@binderly/api-contracts`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    // Test files use Vitest globals via explicit imports; relax
    // rules that fight test ergonomics (mock fixtures often want
    // `any`, long describe blocks, console use during failure
    // debugging).
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
