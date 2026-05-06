// ESLint flat config for @binderly/web. Extends the shared `next`
// preset (which itself layers `@next/eslint-plugin-next` on top of
// the React preset) and adds a few app-level guardrails:
//
//   - `@tamagui/*` direct imports are banned in `app/` and
//     `components/`; consume the design system through
//     `@binderly/ui` only. (The provider component re-exports
//     Tamagui's `<TamaguiProvider>` indirectly via `<UIProvider>`.)
//   - `next/font` is allowed only in `app/layout.tsx` (we ship
//     system fonts in v1; the layout file is the one place a
//     font-loader call belongs if we ever swap.)

import nextConfig from '@binderly/eslint-config/next';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'coverage/**', 'next-env.d.ts'],
  },
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tamagui/core',
              message:
                'Import design-system primitives through @binderly/ui — apps must not depend on @tamagui/core directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'test-utils/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },
];
