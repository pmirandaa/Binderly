import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'dist/**', 'coverage/**'],
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./test-utils/setup.ts'],
    server: {
      deps: {
        inline: [/@tamagui\/.*/, /@binderly\/ui/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'test-utils/**',
        'app/**/loading.tsx',
        'app/**/not-found.tsx',
      ],
    },
  },
});
