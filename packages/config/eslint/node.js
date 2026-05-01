// Node.js preset: extends the base preset with Node globals and the `n`
// plugin's recommended-script ruleset (suitable for CLI tools, server-side
// code, and the data-pipeline scripts).
//
// Usage:
//   import nodeConfig from '@binderly/eslint-config/node';
//   export default [...nodeConfig, /* overrides */];

import nodePlugin from 'eslint-plugin-n';
import globals from 'globals';

import baseConfig from './index.js';

const nodeConfig = [
  ...baseConfig,
  {
    files: ['**/*.{js,cjs,mjs,ts,cts,mts}'],
    plugins: { n: nodePlugin },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
    },
    rules: {
      'n/no-deprecated-api': 'error',
      'n/no-process-exit': 'warn',
      'n/handle-callback-err': ['error', '^(err|error)$'],
      'n/no-new-require': 'error',
      'n/no-path-concat': 'error',
      // The `n` plugin's import resolver is conservative; defer module
      // existence checks to TypeScript or the bundler.
      'n/no-missing-import': 'off',
      'n/no-missing-require': 'off',
      'n/no-extraneous-import': 'off',
      'n/no-extraneous-require': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unpublished-require': 'off',
    },
  },
];

export default nodeConfig;
