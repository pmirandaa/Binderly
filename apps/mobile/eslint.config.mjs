// ESLint flat config for @binderly/mobile.
//
// Extends the shared react-native preset (which itself extends the
// react preset). The mobile app may import platform-specific
// modules (`react-native`, `expo-*`, etc.) — that's the entire
// point of this workspace — so we do NOT add the platform-import
// guards that `@binderly/ui` carries.

import reactNativeConfig from '@binderly/eslint-config/react-native';

export default [
  ...reactNativeConfig,
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'build/**', 'coverage/**'],
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      // expo-router requires default exports for route files.
      'import/no-default-export': 'off',
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test-utils/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'react/display-name': 'off',
    },
  },
  {
    files: ['*.js', '*.cjs', 'metro.config.js', 'babel.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
