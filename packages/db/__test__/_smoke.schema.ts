// Throwaway schema used only by the AC-1 smoke check during
// T-FN-DB-MIGRATIONS verification. NOT re-exported from
// `src/schema/index.ts`; never reaches production.
//
// Re-run the smoke check at any time with:
//   pnpm exec drizzle-kit generate --config drizzle.smoke.config.ts
//
// Then DELETE the generated SQL file under src/migrations/ before
// committing — the canonical schema barrel must remain empty until
// Phase 1 lands.

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const _smoke = pgTable('_smoke', {
  id: uuid('id').primaryKey().defaultRandom(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
