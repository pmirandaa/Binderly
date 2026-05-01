// Base ESLint flat config for the Binderly monorepo.
//
// Targets:
//   - TypeScript and JavaScript (ESM by default).
//   - Import order: external -> @binderly/* -> parent/sibling/index, blank
//     line between groups, alphabetised within each group.
//   - Unused imports flagged automatically.
//   - console.* discouraged except for warn/error.
//
// Consumers extend this preset by spreading the default export into their
// own `eslint.config.js`:
//
//   import baseConfig from '@binderly/eslint-config';
//   export default [...baseConfig, /* package overrides */];

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/.expo/**',
    '**/coverage/**',
    '**/*.tsbuildinfo',
  ],
};

const importOrderRule = [
  'error',
  {
    groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'object', 'type'],
    pathGroups: [{ pattern: '@binderly/**', group: 'internal', position: 'before' }],
    pathGroupsExcludedImportTypes: ['builtin'],
    'newlines-between': 'always',
    alphabetize: { order: 'asc', caseInsensitive: true },
  },
];

const baseRules = {
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'unused-imports/no-unused-imports': 'error',
  'unused-imports/no-unused-vars': [
    'warn',
    {
      vars: 'all',
      varsIgnorePattern: '^_',
      args: 'after-used',
      argsIgnorePattern: '^_',
    },
  ],
  // unused-imports owns this rule; defer to it everywhere.
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  'import/order': importOrderRule,
  'import/no-duplicates': 'error',
  'import/newline-after-import': 'error',
};

const baseConfig = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.es2024,
      },
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.d.ts'] },
      },
    },
    rules: baseRules,
  },
  {
    // The import plugin can't statically resolve TS-only files reliably
    // without a TS resolver. Disable resolution-only rules on TS files;
    // ordering still works because it operates on the source tokens.
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      'import/no-unresolved': 'off',
      'import/named': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
    },
  },
];

export default baseConfig;
