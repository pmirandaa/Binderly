# T-DL-SCHEMA-COLLECTIONS — DB schema for collection_items, custom_collections, smart rules, shareables

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** M
**Status:** pending

## Hard dependencies
- T-DL-SCHEMA-CARDS
- T-DL-SCHEMA-USERS

## Soft dependencies
- T-DL-SCHEMA-GRADING, T-DL-SCHEMA-PRICING (parallel-safe)

## Required reading
- PROJECT.md § 6, § 9 (Custom & Smart), § 14 (Shareables)
- rules/01-data-layer.md
- context/data-model.md (collection_item through shareable)
- context/tcg-domain.md
- context/conventions.md

## Goal
Implement `collection_item`, `custom_collection`, `custom_collection_item`,
`smart_collection_rule`, and `shareable` exactly as specified in
`context/data-model.md`.

## Deliverables

- `packages/db/src/schema/collections.ts` — `collection_item` table.
  - Narrow unique constraint per spec: `(user_id, printing_id,
    condition, grade_company, grade)` (note: NULL participates in
    UNIQUE per spec — see escalation triggers if Postgres semantics
    surprise).
- `packages/db/src/schema/custom_collections.ts` — `custom_collection`
  and `custom_collection_item`.
- `packages/db/src/schema/smart_rules.ts` — `smart_collection_rule`.
- `packages/db/src/schema/shareables.ts` — `shareable`.
- `packages/db/src/schema/index.ts` — re-exports.
- `packages/db/src/migrations/0003_collection_tables.sql` — generated
  SQL.
- `packages/db/src/fixtures/collections.ts` — fixture builders for each.
- Tests verifying:
  - The narrow unique constraint behaves as intended (two items with
    same printing but different `condition` coexist; same
    printing+condition+grade rejected).
  - Foreign keys cascade correctly when a user is deleted.
  - `custom_collection.kind` check constraint rejects bad values.
  - `shareable.target` JSON is well-formed.

## Acceptance criteria

- [ ] Migration applies cleanly.
- [ ] All FKs use `ON DELETE CASCADE` keyed to `auth.users(id)` for
      user-owned data.
- [ ] Narrow unique constraint on `collection_item` works in the
      tested cases. NULL handling for `grade_company`/`grade` is
      documented in the schema file (Postgres treats NULLs as distinct
      in UNIQUE by default; if we need NULLS NOT DISTINCT, use it
      explicitly — Postgres 15+ feature).
- [ ] `custom_collection.slug` unique per user.
- [ ] `shareable.slug` unique per user.
- [ ] Round-trip tests pass.
- [ ] No modifications outside listed paths.

## Out of scope

- RLS policies — T-DL-RLS-POLICIES.
- Smart rule evaluation logic — packages/smart-collection-dsl in stage 3.
- Materialized views — those land with the backend stage where the
  refresh trigger is decided.

## Branch & PR

- Branch: `agent/T-DL-SCHEMA-COLLECTIONS`
- PR title: `T-DL-SCHEMA-COLLECTIONS: Collection-related schemas`

## Escalation triggers

- The narrow unique constraint and NULL handling don't behave as the
  product intends — propose `NULLS NOT DISTINCT` or a partial unique
  index variant.
- The `expression` JSON for smart rules grows in scope mid-task — defer
  the DSL details and just store as opaque `jsonb`; stage 3 owns
  validation.

## Notes from execution
_(empty)_
