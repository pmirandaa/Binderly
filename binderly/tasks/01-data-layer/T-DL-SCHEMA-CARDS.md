# T-DL-SCHEMA-CARDS — DB schema for sets, cards, printings

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** M
**Status:** pending

## Hard dependencies
- T-FN-DB-MIGRATIONS

## Soft dependencies
- T-DL-SCHEMA-USERS, T-DL-SCHEMA-COLLECTIONS, T-DL-SCHEMA-GRADING,
  T-DL-SCHEMA-PRICING (parallel-safe)

## Required reading
- PROJECT.md § 6 (Data Model)
- rules/01-data-layer.md
- context/data-model.md (Catalog tables section)
- context/tcg-domain.md (entire file)
- context/conventions.md (DB section)

## Goal
Define the Drizzle schemas for `set`, `card`, and `printing` tables
exactly as specified in `context/data-model.md`. Generate the migration.
Add fixture builders for tests in subsequent tasks.

## Deliverables

- `packages/db/src/schema/sets.ts` — Drizzle table for `set` matching the
  spec column-for-column. Indexes per spec.
- `packages/db/src/schema/cards.ts` — Drizzle table for `card` matching
  the spec. FK to sets.
- `packages/db/src/schema/printings.ts` — Drizzle table for `printing`
  matching the spec. FK to cards. Partial index on
  `include_in_master_set`.
- `packages/db/src/schema/index.ts` — re-export the new tables.
- `packages/db/src/migrations/0001_catalog_tables.sql` — generated SQL
  for these three tables (via `pnpm db:generate`).
- `packages/db/src/fixtures/cards.ts` — typed fixture builders for tests:
  `makeSet({...overrides})`, `makeCard({...overrides})`,
  `makePrinting({...overrides})`. Defaults are deterministic and
  realistic (e.g., a Base Set Charizard with sensible values).
- `packages/db/src/fixtures/cards.test.ts` — verifies fixtures round-trip
  through the schema (insert + select equality).

## Acceptance criteria

- [ ] All three tables match `context/data-model.md` exactly.
- [ ] Migration applies cleanly to a fresh local DB.
- [ ] Indexes from spec exist (`set` release-date index, `card` set+number
      and trigram name index, `printing` card_id and partial
      master-set index).
- [ ] Fixture round-trip test passes against the local DB.
- [ ] Field types are correct: `release_date` is `date`, `number` is
      `text` (preserves leading zeros and `TG01`-style values),
      `variant_flags` is `text[]` not `jsonb`.
- [ ] `printing.variant_key` and `card.canonical_key` are unique
      constraints, not just unique indexes — they must reject inserts.
- [ ] No file modified outside `packages/db/src/schema/`,
      `packages/db/src/migrations/`, `packages/db/src/fixtures/`,
      `packages/db/src/index.ts`.
- [ ] No application code yet (no queries, no API), only schema +
      fixtures.

## Out of scope

- RLS policies (T-DL-RLS-POLICIES).
- Any user-table relations (T-DL-SCHEMA-COLLECTIONS).
- Source adapters that populate the tables (T-DL-SOURCE-*).

## Branch & PR

- Branch: `agent/T-DL-SCHEMA-CARDS`
- PR title: `T-DL-SCHEMA-CARDS: DB schema for sets, cards, printings`

## Escalation triggers

- A field type in the spec turns out impossible or expensive to support
  in Postgres 16 (e.g., a stricter constraint). Document and propose
  alternative.
- Citext extension not available in the Supabase image (it should be —
  enabled in T-FN-DOCKER's init.sql). If not, escalate.

## Notes from execution
_(empty)_
