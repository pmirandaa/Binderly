// `set` — catalog table for Pokémon TCG sets (e.g. Brilliant Stars,
// Base Set, Crown Zenith). One row per set per language. The shape is
// the canonical reference in `context/data-model.md` § "Catalog tables"
// and the master-set rules engine relies on `master_set_rules` exactly
// as documented in `context/tcg-domain.md` § 2.
//
// Notes for downstream readers:
// - `id` is a UUID (Postgres `gen_random_uuid()` via the built-in PG17
//   function). We do NOT regenerate UUIDs across data-source refreshes;
//   adapters upsert by `canonical_key`.
// - `canonical_key` is the cross-source primary identifier
//   (`{language}-{code}`, e.g. `en-swsh9`).
// - `release_date` is a `date` (not `timestamptz`) per spec — set release
//   has day-level precision and we never use the time component for
//   ordering or display.
// - The default ordering everywhere in Binderly is "newest first";
//   the `(release_date desc, language, code)` index backs that surface.
// - SQL keyword caveat: the table name `set` collides with the SQL
//   keyword `SET`. Postgres allows it as a quoted identifier, and
//   Drizzle quotes table identifiers automatically — this is why the
//   exported binding is `setTable` rather than `set` (so consumers can
//   `import { setTable } from '@binderly/db'` without colliding with
//   the `Set` global).

import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const setTable = pgTable(
  'set',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    canonicalKey: text('canonical_key').notNull().unique(),
    code: text('code').notNull(),
    language: text('language').notNull(),
    name: text('name').notNull(),
    series: text('series'),
    releaseDate: date('release_date').notNull(),
    printedTotal: integer('printed_total'),
    total: integer('total'),
    logoUrl: text('logo_url'),
    symbolUrl: text('symbol_url'),
    masterSetRules: jsonb('master_set_rules')
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceMetadata: jsonb('source_metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Default browse ordering: newest sets first, language as a
    // tiebreaker for simultaneous EN/JP launches, then `code` alpha.
    // Pablo's #1 grievance about Collectr was that "Latest" wasn't
    // actually latest — this index is the storage-layer guarantee.
    index('set_release_date_language_code_idx').on(
      table.releaseDate.desc(),
      table.language,
      table.code,
    ),
  ],
);

export type Set = typeof setTable.$inferSelect;
export type NewSet = typeof setTable.$inferInsert;
