import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The migration-tooling unit tests live in `__test__/` (excluded from
    // the build tsconfig + eslint, same as the pre-existing smoke fixture).
    include: ['__test__/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
});
