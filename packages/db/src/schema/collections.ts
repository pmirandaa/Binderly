// `collection_item` — user-side table for the *physical instances* a
// collector owns. One row per (user, printing, condition, grade)
// combination. The unique-constraint composition is intentionally
// narrow so a single user can hold multiple "instances" of the same
// printing in different states (raw NM + PSA 9 + PSA 10 + a beat-up
// LP), but identical states coalesce via UPSERT instead of accruing
// duplicate rows.
//
// Mirrors `context/data-model.md` § "User tables → collection_item"
// and § 6 of PROJECT.md ("collection_item — user's instance of a
// printing").
//
// Notes for downstream readers:
// - `user_id` is a plain `uuid` here (no Drizzle `references()`)
//   because Drizzle cannot author cross-schema foreign keys to
//   Supabase's managed `auth.users(id)`. The
//   `collection_item_user_id_auth_users_fk` constraint with
//   `ON DELETE CASCADE` is added by hand in the companion RLS
//   migration (`<NNNN+1>_collections_rls.sql`). This is the same
//   pattern used by `profile` and `subscription` in T-DL-SCHEMA-USERS.
// - `printing_id` is an in-schema FK to `printing.id`. We deliberately
//   do NOT cascade deletes from `printing`: the catalog is effectively
//   append-only post-ingest, and on the rare day we need to consolidate
//   a printing row we want the migration to surface dependent
//   collection rows so a human can decide. Drizzle's default action
//   ("no action") is what we want.
// - `condition` defaults to `'NEAR_MINT'` per spec. The set of allowed
//   string values is documented in PROJECT.md but enforcement happens
//   at the API layer (zod) rather than as a CHECK constraint — we
//   expect the vocabulary to grow (e.g. add MINT/POOR variants) and
//   prefer to evolve that without schema migrations. If/when the
//   product locks the enum we can promote it to a CHECK constraint.
// - `grade_company` and `grade` are nullable: a "raw" card has no
//   grading-company assignment and no numeric grade. The unique
//   constraint includes both nullable columns; see the `grade` /
//   `gradeCompany` notes immediately below for the NULLS-NOT-DISTINCT
//   rationale.
// - **NULLS NOT DISTINCT on the unique constraint.** Postgres treats
//   NULLs as distinct in UNIQUE indexes by default, which would mean
//   "two raw NM Charizards" (both with `grade_company` and `grade`
//   NULL) could be inserted as two rows. The product intent
//   (`context/data-model.md` § "collection_item": "coalesce duplicates
//   with identical specs") is that they *are* duplicates and should
//   merge into a single row whose `quantity` increments. We therefore
//   declare the constraint with `NULLS NOT DISTINCT` (Postgres 15+),
//   which the local Supabase Postgres (PG17) supports. Surfaced for
//   ratification at PR review per the task's escalation triggers.
// - `quantity` defaults to 1 with a CHECK ≥ 1; "I sold my last copy"
//   is expressed by deleting the row, not by setting quantity to 0.
// - `acquired_currency` is free-form `text` rather than an enum because
//   the FX rate table (`fx_rate.quote_currency`) is the canonical list
//   of recognized currencies and validating against it is a runtime
//   concern (the user can store an acquisition price in any currency
//   they like; pricing display converts at render time per
//   `rules/01-data-layer.md`).
// - `photo_urls` is `text[]` of R2 URLs (user uploads — slabs, the back
//   of a card, condition evidence). Defaults to an empty array so the
//   array is always non-null and downstream code can `.length` without
//   guarding for undefined.
// - `source` defaults to `'manual'` and accepts `'manual' | 'scan' |
//   'import'`. As with `condition`, validation lives at the API layer.

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { printingTable } from './printings.js';

export const collectionItem = pgTable(
  'collection_item',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Cross-schema FK to `auth.users(id)` ON DELETE CASCADE is emitted
    // in the companion RLS migration; Drizzle cannot author it here.
    userId: uuid('user_id').notNull(),
    printingId: uuid('printing_id')
      .notNull()
      .references(() => printingTable.id),
    quantity: integer('quantity').notNull().default(1),
    condition: text('condition').notNull().default('NEAR_MINT'),
    gradeCompany: text('grade_company'),
    grade: numeric('grade', { precision: 3, scale: 1 }),
    acquiredAt: date('acquired_at'),
    acquiredPrice: numeric('acquired_price', { precision: 10, scale: 2 }),
    acquiredCurrency: text('acquired_currency'),
    notes: text('notes'),
    photoUrls: text('photo_urls')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // "I own this card" hot path: look up a user's row(s) for a given
    // printing. Set / Master Set completion math joins through this
    // index; the scanner deduplicates against (user_id, printing_id)
    // before deciding insert-vs-update.
    index('collection_item_user_id_printing_id_idx').on(table.userId, table.printingId),
    // Recent-additions feed on the collection home screen.
    index('collection_item_user_id_created_at_idx').on(table.userId, table.createdAt.desc()),
    // Narrow uniqueness — a single user cannot have two rows that
    // describe the same physical instance (same printing, same
    // condition, same grade). NULLS NOT DISTINCT means raw cards
    // (`grade_company` IS NULL, `grade` IS NULL) collapse correctly:
    // two "raw NM" rows for the same printing would conflict, which is
    // what we want — quantity captures multiplicity. Postgres 15+
    // feature; supported on the local Supabase PG17 stack.
    unique('collection_item_owner_state_unique')
      .on(table.userId, table.printingId, table.condition, table.gradeCompany, table.grade)
      .nullsNotDistinct(),
    check('collection_item_quantity_check', sql`${table.quantity} >= 1`),
  ],
);

export type CollectionItem = typeof collectionItem.$inferSelect;
export type NewCollectionItem = typeof collectionItem.$inferInsert;
