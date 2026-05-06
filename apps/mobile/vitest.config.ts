import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest runs in jsdom — the same posture `@binderly/ui` uses for
// its component tests. Tamagui's `@tamagui/core` forks at compile
// time; under jsdom it routes to its web-friendly variants. The
// shell's RN-specific dependencies (`expo-secure-store`,
// `expo-router`, `expo-linking`, `expo-image`, `expo-constants`,
// `react-native`, `@react-native-community/netinfo`) are mocked
// via `src/test-utils/setup.ts` so we test the shell **contract**
// without dragging the native-module graph into Node.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.tsx'],
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./src/test-utils/setup.ts'],
    server: {
      deps: {
        inline: [/@tamagui\/.*/, /@binderly\/ui/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'app/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-utils/**', 'app/**/*.test.tsx'],
    },
  },
});
