// React preset: extends the base preset with react + react-hooks rules,
// JSX parsing, and browser globals. Suitable for any React surface that
// isn't Next.js or React Native specifically (those have their own presets
// that build on top of this one).
//
// Usage:
//   import reactConfig from '@binderly/eslint-config/react';
//   export default [...reactConfig, /* overrides */];

import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

import baseConfig from './index.js';

const reactConfig = [
  ...baseConfig,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // Modern JSX transform: importing React explicitly is no longer
      // required.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // We rely on TypeScript for prop typing.
      'react/prop-types': 'off',
      'react/no-unknown-property': 'error',
      'react/self-closing-comp': 'warn',
    },
  },
];

export default reactConfig;
