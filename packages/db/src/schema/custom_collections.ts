// `custom_collection` and `custom_collection_item` — user-defined
// groupings of printings.
//
// Mirrors `context/data-model.md` § "User tables → custom_collection"
// and § "User tables → custom_collection_item", and PROJECT.md § 9
// (free tier: 3 manual collections; smart collections paid-only).
//
// `custom_collection` rows describe the collection itself (name, slug,
// kind, optional description and cover). `custom_collection_item` is
// the membership-list table for *manual* collections only — smart
// collections never persist their members; the result set is computed
// from the `smart_collection_rule.expression` against the catalog at
// read time (with caching).
//
// Notes for downstream readers:
// - `user_id` is plain `uuid` (no Drizzle `references()`); the
//   cross-schema FK to `auth.users(id)` ON DELETE CASCADE is added by
//   hand in the companion RLS migration. Same pattern as
//   `collection_item`.
// - `kind` is constrained to `'manual' | 'smart'` via a CHECK
//   constraint declared inline below so it ships in the generated
//   migration. Read paths can branch on this value without runtime
//   validation. Smart collections additionally have a row in
//   `smart_collection_rule` (see `smart_rules.ts`).
// - `slug` is unique *per user* (composite UNIQUE on `(user_id, slug)`).
//   The shareable URL surface is `/c/{profile.handle}/{slug}` (PROJECT
//   § 14), so two different users can each have a `gym-leaders` slug
//   without conflict; the path-prefix `handle` namespaces them.
// - `custom_collection_item.added_at` defaults to `now()` so insert
//   sites don't need to populate it. The composite primary key
//   `(custom_collection_id, printing_id)` enforces "a printing is
//   either in this collection or it isn't" — adding the same printing
//   twice is a no-op via `ON CONFLICT DO NOTHING`.
// - `custom_collection_item.custom_collection_id` cascades on delete:
//   deleting a custom collection removes its membership rows. We do
//   this at the FK level rather than via application logic so a
//   user-driven `DELETE FROM custom_collection WHERE id = ?` cleans up
//   atomically. Deleting a `printing` row is rare (catalog is
//   effectively append-only; see `collections.ts` for the rationale)
//   and intentionally NOT cascaded — we'd want the migration to fail
//   loudly if any user has the printing in a custom collection.

import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { printingTable } from './printings.js';

export const customCollection = pgTable(
  'custom_collection',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Cross-schema FK to `auth.users(id)` ON DELETE CASCADE is emitted
    // in the companion RLS migration; Drizzle cannot author it here.
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Slugs are user-scoped; the public URL `/c/{handle}/{slug}`
    // namespaces by `handle` so two different users can each own a
    // `binder-1` slug. Drizzle's default unique-name format
    // (`<table>_<col1>_<col2>_unique`) is fine here.
    unique('custom_collection_user_id_slug_unique').on(table.userId, table.slug),
    check('custom_collection_kind_check', sql`${table.kind} IN ('manual', 'smart')`),
  ],
);

export const customCollectionItem = pgTable(
  'custom_collection_item',
  {
    customCollectionId: uuid('custom_collection_id')
      .notNull()
      .references(() => customCollection.id, { onDelete: 'cascade' }),
    printingId: uuid('printing_id')
      .notNull()
      .references(() => printingTable.id),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // (custom_collection_id, printing_id) is the natural PK: a printing
    // is in the collection or it isn't. INSERT ON CONFLICT DO NOTHING
    // makes "add card" idempotent.
    primaryKey({
      name: 'custom_collection_item_pkey',
      columns: [table.customCollectionId, table.printingId],
    }),
  ],
);

export type CustomCollection = typeof customCollection.$inferSelect;
export type NewCustomCollection = typeof customCollection.$inferInsert;
export type CustomCollectionItem = typeof customCollectionItem.$inferSelect;
export type NewCustomCollectionItem = typeof customCollectionItem.$inferInsert;
