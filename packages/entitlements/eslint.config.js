// ESLint flat config for @binderly/entitlements. The package is pure
// TypeScript model + helpers plus one small `fetch`-based REST client
// (the only I/O), so the `node` preset is the right base — same shape
// as `@binderly/set-completion` / `@binderly/api-contracts`.

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
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
