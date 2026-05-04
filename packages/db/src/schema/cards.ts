// `card` — catalog table for individual cards (one row per
// {language, set, number} triple). The card row is the *abstract*
// printing identity — physical variants (holo/non-holo, 1st-edition,
// stamped, etc.) live in `printing` and reference this row.
//
// Notes for downstream readers:
// - `canonical_key` is the cross-source primary identifier
//   (`{language}-{set_code}-{number_padded}`, see `tcg-domain.md` §5).
//   Adapters upsert by this key; never by `id`.
// - `number` is `text` (NOT integer) so we preserve leading zeros,
//   `TG01`, `GG12`, `SWSH001`, alpha suffixes (`a`/`b`), promo
//   prefixes, etc. Stripping leading zeros breaks both display and
//   ANN keys downstream — see `rules/01-data-layer.md` "common
//   pitfalls".
// - `rarity` is the normalized enum from `tcg-domain.md` §6
//   (`COMMON`, `HOLO_RARE`, `ULTRA_RARE`, `SPECIAL_ILLUSTRATION_RARE`,
//   ...). Stored as `text` for forward flexibility (we expect to add
//   new rarity buckets as new SV/SCN sets ship); validation lives in
//   the adapter normalizer, not the column.
// - `attacks` / `weakness` / `resistance` are `jsonb` so the
//   normalized shape can evolve without schema migrations. Their
//   contracts are owned by the adapter normalizer in `data-pipeline/`.
// - The trigram (`pg_trgm`) GIN index on `name` powers the in-app
//   autocomplete and search; the `pg_trgm` extension is created in
//   the same migration (drizzle-kit does not auto-emit
//   `CREATE EXTENSION` statements).

import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { setTable } from './sets.js';

export const cardTable = pgTable(
  'card',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    canonicalKey: text('canonical_key').notNull().unique(),
    setId: uuid('set_id')
      .notNull()
      .references(() => setTable.id),
    language: text('language').notNull(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    nameLocalized: jsonb('name_localized'),
    type: text('type'),
    subtype: text('subtype'),
    hp: integer('hp'),
    illustrator: text('illustrator'),
    flavorText: text('flavor_text'),
    attacks: jsonb('attacks'),
    weakness: jsonb('weakness'),
    resistance: jsonb('resistance'),
    retreatCost: integer('retreat_cost'),
    rarity: text('rarity'),
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
    // Set-detail and master-set views: list cards in numeric order
    // within a set. `number` is text but the index still answers the
    // common `WHERE set_id = ? ORDER BY number` query path.
    index('card_set_id_number_idx').on(table.setId, table.number),
    // Trigram search on card name. Powers the autocomplete in
    // `apps/web` and the scanner OCR fallback. The `gin_trgm_ops`
    // operator class is provided by the `pg_trgm` extension which the
    // migration enables before this index is created.
    index('card_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
  ],
);

export type Card = typeof cardTable.$inferSelect;
export type NewCard = typeof cardTable.$inferInsert;
