// Next.js preset: extends the React preset with @next/eslint-plugin-next's
// recommended + core-web-vitals rule sets.
//
// Usage (from a Next.js app's eslint.config.js):
//   import nextConfig from '@binderly/eslint-config/next';
//   export default [...nextConfig, /* app-specific overrides */];

import nextPlugin from '@next/eslint-plugin-next';

import reactConfig from './react.js';

const nextConfig = [
  ...reactConfig,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    // Next.js requires default exports for page/layout/route files; the
    // base preset doesn't forbid them, but make the carve-out explicit so
    // future overrides can build on it.
    files: [
      '**/app/**/{page,layout,template,loading,error,not-found,route}.{js,jsx,ts,tsx}',
      '**/pages/**/*.{js,jsx,ts,tsx}',
    ],
    rules: {
      'import/no-default-export': 'off',
    },
  },
];

export default nextConfig;
