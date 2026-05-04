// Throwaway drizzle-kit config used by the AC-1 smoke check during
// T-FN-DB-MIGRATIONS verification. Targets the fixture schema at
// `__test__/_smoke.schema.ts`. NOT used by app code.
//
// Run with:
//   pnpm exec drizzle-kit generate --config drizzle.smoke.config.ts

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './__test__/_smoke.schema.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
});
