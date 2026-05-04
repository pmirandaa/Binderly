// Drizzle Kit configuration for the canonical Binderly schema.
//
// The schema entry point is `src/schema/index.ts`, which re-exports every
// table defined under `src/schema/`. Generated migrations land in
// `src/migrations/` as plain `.sql` files and are committed to git — no
// `drizzle-kit push` runs in production.
//
// The DB credentials come from env so the same config works for local
// Supabase (port 54322) and any deployed target. The precedence here
// (`DATABASE_URL` -> `SUPABASE_DB_URL`) matches `scripts/migrate.ts`.

import { defineConfig } from 'drizzle-kit';

const url = process.env['DATABASE_URL'] ?? process.env['SUPABASE_DB_URL'] ?? '';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url,
  },
});
