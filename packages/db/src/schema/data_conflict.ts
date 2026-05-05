// `data_conflict` — pipeline-internal admin-debug log of resolver
// disagreements.
//
// Why this table exists:
//   - The data-pipeline resolver
//     (`data-pipeline/src/resolver/resolver.ts`) merges primary /
//     validation / filler tier sources into one canonical record per
//     `set` / `card` / `printing`. When a validation source disagrees
//     with the primary on a field beyond a configured tolerance, the
//     resolver emits an in-memory `DataConflict` and KEEPS the
//     primary's value (per `rules/01-data-layer.md` "conflicts are
//     surfaced, not silenced").
//   - Today the seed reporter only counts those conflicts. The
//     conflict itself — which sources, which field, which value lost —
//     is lost the moment the run ends.
//   - This table persists every emitted conflict so an operator can
//     query the audit trail (top recurring conflicts, per-source
//     disagreement rate, manual-override workflow). T-DL-ADMIN-DEBUG-
//     SURFACES (iter-11) builds the read-only views over this table.
//
// Notes for downstream readers:
//   - `(entity_kind, entity_canonical_key, field_name)` is UNIQUE and
//     IS the idempotency key. Re-running the seed against the same
//     set bumps `dispute_count` and refreshes `last_seen_at` /
//     `sources` / `kept_value` rather than inserting duplicate rows.
//     See `data-pipeline/src/resolver/conflict-log.ts` for the
//     `onConflictDoUpdate` recipe.
//   - `entity_canonical_key` is intentionally NOT a foreign key into
//     `set` / `card` / `printing`. The resolver can flag a conflict
//     on data from a source that doesn't yet exist in the catalog
//     (for example a new validation-tier set the primary doesn't know
//     about — the `__presence` conflict shape from
//     `resolver.ts`). Persisting requires no FK constraint.
//   - `entity_kind` is CHECK-constrained to the three values the
//     resolver emits (`'set' | 'card' | 'printing'`). Same posture as
//     `printing_image.license`'s CHECK in `printing_image.ts`.
//   - `sources` is jsonb echoing the resolver's in-memory map, e.g.
//     `{ 'tcgdex-en': 'Charizard VSTAR', 'ptcgio': 'Charizard
//     V-STAR', 'reason': 'string mismatch ("Charizard VSTAR" vs
//     "Charizard V-STAR")' }`.
//   - `kept_value` is jsonb so strings, numbers, arrays, and null
//     all round-trip without per-type plumbing.
//   - `resolution` carries the audit verb: `kept_<source>` for the
//     standard primary-won path, `'unresolved'` for the
//     `__presence` flavor (no value won; one source had it, the
//     primary did not), and `'manual_override'` for the future
//     human-driven workflow that updates `kept_value` + `notes`.
//   - RLS posture mirrors `price_observation` from
//     `0009_pricing_rls.sql`: service_role only, no permissive
//     policies for anon / authenticated. The companion migration
//     `0015_data_conflict_rls.sql` enforces this; the structural
//     verifier (`packages/db/scripts/verify-rls/inventory.ts`)
//     pins the posture.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const dataConflictTable = pgTable(
  'data_conflict',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    entityKind: text('entity_kind').notNull(),
    entityCanonicalKey: text('entity_canonical_key').notNull(),
    fieldName: text('field_name').notNull(),
    sources: jsonb('sources').notNull(),
    resolution: text('resolution'),
    keptValue: jsonb('kept_value'),
    disputeCount: integer('dispute_count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      'data_conflict_entity_kind_check',
      sql`${table.entityKind} IN ('set', 'card', 'printing')`,
    ),
    // Idempotency key. Re-running the resolver against the same
    // (entity, key, field) bumps `dispute_count` instead of writing
    // a duplicate row. Doubles as the natural lookup index for the
    // future admin views (`v_data_conflict_top` etc.).
    unique('data_conflict_entity_field_unique').on(
      table.entityKind,
      table.entityCanonicalKey,
      table.fieldName,
    ),
    // Hot path for "top recurring conflicts" admin view.
    index('data_conflict_dispute_count_idx').on(table.disputeCount.desc()),
    // Hot path for "what changed in the most recent run" admin view.
    index('data_conflict_last_seen_at_idx').on(table.lastSeenAt.desc()),
  ],
);

export type DataConflictRow = typeof dataConflictTable.$inferSelect;
export type NewDataConflictRow = typeof dataConflictTable.$inferInsert;
