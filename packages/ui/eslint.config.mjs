// ESLint flat config for @binderly/ui. The package targets both web
// (Next.js / RSC) and mobile (Expo / React Native), so we extend the
// `react` preset for JSX + hooks rules but DO NOT pull in the
// `react-native` preset — that one registers RN-specific globals and
// rules that would hide cross-platform leaks. We keep that posture
// honest with a `no-restricted-imports` rule that bans
// platform-specific imports from `src/**/*` outside test files
// (`react-native`, `next/*`, `node:*`).

import reactConfig from '@binderly/eslint-config/react';

export default [
  ...reactConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              message:
                '@binderly/ui must stay platform-agnostic. Use @tamagui/core primitives so the same source compiles on web (Next.js) and native (Expo).',
            },
          ],
          patterns: [
            {
              group: ['next/*', 'next'],
              message:
                '@binderly/ui is shared with mobile; framework-specific imports break the native build.',
            },
            {
              group: ['node:*'],
              message: '@binderly/ui runs in browsers and React Native — no node: builtins.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-utils/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },
];
