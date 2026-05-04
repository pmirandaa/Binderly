// `printing` — catalog table for the *physical* printing variants of a
// card. One `card` row maps to N `printing` rows (Base Set Charizard
// has Unlimited / Shadowless / 1st-Edition Shadowless / etc.). The
// `variant_class` + `variant_flags` + `variant_code` triplet is the
// canonical taxonomy from `context/tcg-domain.md` §1.
//
// Notes for downstream readers:
// - `variant_key` is the cross-source primary identifier
//   (`{card.canonical_key}-{variant_code}`). Adapters upsert by this
//   key; idempotent ingestion depends on it.
// - `variant_class` and `variant_flags` are stored separately (NOT
//   collapsed into a single string) because the master-set rules
//   engine (`data-pipeline/src/master-set/`) reads the structured
//   form. `variant_code` is the deterministic short-string assembled
//   from class + flags by the variant classifier — kept here so we
//   never have to re-derive it for joins or URL slugs.
// - `variant_flags` is `text[]` (NOT `jsonb`) per spec — flags are a
//   bounded, small enum that benefits from GIN-indexable array
//   semantics if we ever need a "show me printings with FIRST_EDITION
//   stamp" filter. Storing as jsonb would force `@>` checks on a
//   jsonb path; `text[]` gives `&&` and `@>` directly.
// - `include_in_master_set` is *materialized* (not derived at read
//   time). The master-set rules engine sets it during ingestion.
//   The partial index on `where include_in_master_set = true` is the
//   storage-layer fast path for "what do I still need?" queries.
// - All `*_url` fields point at R2 once the image pipeline runs.
//   `image_source_url` is the upstream provenance fallback — never
//   surfaced to clients.

import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { cardTable } from './cards.js';

export const printingTable = pgTable(
  'printing',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    variantKey: text('variant_key').notNull().unique(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cardTable.id),
    variantClass: text('variant_class').notNull(),
    variantFlags: text('variant_flags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    variantCode: text('variant_code').notNull(),
    includeInMasterSet: boolean('include_in_master_set').notNull(),
    imageSmallUrl: text('image_small_url'),
    imageLargeUrl: text('image_large_url'),
    imageSourceUrl: text('image_source_url'),
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
    // FK lookup path: "give me all printings of this card".
    index('printing_card_id_idx').on(table.cardId),
    // Partial index: hot path for master-set completion queries.
    // Most printings have `include_in_master_set = true`, but the
    // partial form keeps the index tight and skips errors / staff
    // promos that we never count toward master-set %.
    index('printing_master_set_idx')
      .on(table.cardId)
      .where(sql`include_in_master_set = true`),
  ],
);

export type Printing = typeof printingTable.$inferSelect;
export type NewPrinting = typeof printingTable.$inferInsert;
