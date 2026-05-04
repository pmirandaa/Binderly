// `smart_collection_rule` — the rule expression for a smart custom
// collection. One row per smart collection; the row is keyed by
// `custom_collection_id` (1:1).
//
// Mirrors `context/data-model.md` § "User tables → smart_collection_rule"
// and PROJECT.md § 9 ("Smart collections (rule-based)"). The DSL is
// owned by `packages/smart-collection-dsl/src/schema.ts` (a stage-3
// task) and validated via zod at the API layer; this file enforces
// only the column type and the parent-FK relationship.
//
// Notes for downstream readers:
// - The PK is `custom_collection_id` (1:1 with the parent
//   `custom_collection` row). `kind = 'smart'` collections always have
//   exactly one rule; `kind = 'manual'` collections have zero rules.
//   The CHECK constraint that ties `custom_collection.kind = 'smart'`
//   to the existence of a `smart_collection_rule` row is enforced at
//   the application layer (the create-collection edge function in
//   stage 2); doing it as a partial FK constraint would require a
//   trigger and isn't worth the complexity for MVP.
// - `expression` is `jsonb` storing the DSL AST. We deliberately do
//   NOT enforce a JSON schema CHECK at the column level — the DSL is
//   evolving (see PROJECT § 9 examples) and the smart-collection-dsl
//   package owns validation via zod. Keeping the column "opaque" jsonb
//   here matches the task's escalation guidance ("if expression
//   schema grows in scope mid-task — defer the DSL details and just
//   store as opaque `jsonb`; stage 3 owns validation").
// - `last_evaluated_at` is null until the first evaluation. Smart
//   collections never persist their members; this column is a
//   timestamp the cache layer reads to decide whether to recompute
//   the result set.
// - The FK to `custom_collection` cascades on delete: removing a
//   custom collection cleans up its rule atomically.

import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { customCollection } from './custom_collections.js';

export const smartCollectionRule = pgTable('smart_collection_rule', {
  customCollectionId: uuid('custom_collection_id')
    .primaryKey()
    .references(() => customCollection.id, { onDelete: 'cascade' }),
  expression: jsonb('expression').notNull(),
  lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
});

export type SmartCollectionRule = typeof smartCollectionRule.$inferSelect;
export type NewSmartCollectionRule = typeof smartCollectionRule.$inferInsert;
