// React Native preset: extends the React preset with react-native-specific
// rules and globals. eslint-plugin-react-native v5 is a legacy-shaped
// plugin (no flat-config preset export), but it works fine when registered
// manually inside a flat-config block as below.
//
// Usage (from a React Native app's eslint.config.js):
//   import rnConfig from '@binderly/eslint-config/react-native';
//   export default [...rnConfig, /* app-specific overrides */];

import reactNativePlugin from 'eslint-plugin-react-native';
import globals from 'globals';

import reactConfig from './react.js';

const reactNativeConfig = [
  ...reactConfig,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-native': reactNativePlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...(globals['react-native'] ?? {}),
        __DEV__: 'readonly',
      },
    },
    rules: {
      'react-native/no-unused-styles': 'warn',
      'react-native/no-inline-styles': 'warn',
      'react-native/no-single-element-style-arrays': 'warn',
      'react-native/split-platform-components': 'off',
      'react-native/no-color-literals': 'off',
      'react-native/no-raw-text': 'off',
      // RN doesn't render to the DOM; allow components like <View> /
      // <Text> without DOM-property checks.
      'react/no-unknown-property': 'off',
    },
  },
];

export default reactNativeConfig;
