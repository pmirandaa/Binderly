// ESLint flat config for @binderly/api-client. The package targets
// browser / RN / edge / node runtimes (no Node-specific APIs in
// production code), but the `node` preset is the right base because
// the test environment is vitest-on-node and the lint rules apply
// uniformly. Same shape as `@binderly/api-contracts` and
// `@binderly/auth`.

import nodeConfig from '@binderly/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    // Test files use vitest globals via explicit imports; relax rules
    // that fight test ergonomics (mock fixtures often want `any`,
    // long describe blocks, console use during failure debugging).
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
