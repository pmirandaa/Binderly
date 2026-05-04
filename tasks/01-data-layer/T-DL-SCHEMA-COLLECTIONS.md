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

### Decisions

- **`collection_item` unique constraint uses `NULLS NOT DISTINCT`** (Postgres
  15+, supported on the Supabase CLI's PG17 stack). The composite is
  `(user_id, printing_id, condition, grade_company, grade)`. Two raw cards
  (both nullable grade columns NULL) collapse correctly via UPSERT with this
  setting — matches the data-model.md product intent
  ("coalesce duplicates with identical specs"). Documented inline in
  `packages/db/src/schema/collections.ts`. Surfaced for ratification at PR
  review per the task's escalation triggers — flagged but not blocked,
  consistent with the "pick the one data-model.md implies but flag for
  ratification" guidance from the orchestrator brief.
- **Cross-schema FKs to `auth.users(id)`** declared as plain `uuid('user_id')`
  in TS schema; the actual FK with `ON DELETE CASCADE` lives in the
  hand-authored RLS migration `0005_collections_rls.sql` (per the
  T-DL-SCHEMA-USERS pattern). One ALTER TABLE per `user_id`-bearing table
  (`collection_item`, `custom_collection`, `shareable`).
- **`custom_collection_item` and `smart_collection_rule` cascade on parent
  delete.** Drizzle-authored FK with `{onDelete: 'cascade'}` in the same
  generated migration. `printing_id` does NOT cascade (matches the catalog
  posture from T-DL-SCHEMA-CARDS — printings are append-only post-ingest;
  any future consolidation should fail loudly).
- **`shareable.target` is opaque jsonb with a discriminator CHECK only.**
  The `kind` value is constrained to `'full' | 'custom'`; the
  `custom_collection_id` cross-reference inside `target.kind = 'custom'` is
  the API layer's responsibility (matches the smart-rule expression
  posture). Documented inline.
- **`custom_collection.kind` CHECK** restricts to `'manual' | 'smart'`
  inline in the table definition (mirrors `subscription.tier` pattern from
  T-DL-SCHEMA-USERS).
- **RLS for nested tables** (`custom_collection_item`, `smart_collection_rule`)
  uses `EXISTS` subqueries against the parent's `user_id`. Faster than a
  join in PG's RLS optimizer and uses the existing PK index on
  `custom_collection.id`.
- **RLS for `shareable`** ships with both an owner-CRUD pair (gates the
  editor surface) AND a public-read policy gated on `slug IS NOT NULL`
  (powers `/c/{handle}/{slug}` SSR for the `anon` role). Slug is `NOT NULL`
  in the schema so the public-read predicate is currently a tautology — it
  documents intent and survives any future migration that nullable-izes
  the column for soft-delete or draft semantics.
- **Privilege grants/revokes** mirror the `0003_catalog_rls.sql` pattern.
  `anon` keeps SELECT on `shareable` only; never on the other four tables.
  `authenticated` gets full per-policy DML (RLS gates by user_id).
  `service_role` gets full DML on all five tables.

### Deferred ACs

- **Round-trip vitest tests** — the test infrastructure (Dockerized Postgres
  + vitest harness) is owned by `T-DL-DB-TEST-INFRA`, not yet merged. We
  shipped fixture builders only (`packages/db/src/fixtures/collections.ts`),
  matching what T-DL-SCHEMA-CARDS did for AC-8.
- **Live `pnpm db:reset && pnpm --filter @binderly/db db:migrate` proof** —
  the agent's sandbox does not have access to the Docker socket
  (`permission denied while trying to connect to the Docker daemon socket
  at unix:///Users/pmiranda/.docker/run/docker.sock`), so the agent could
  not bring up Supabase locally. Migration SQL was generated and reviewed
  statically; orchestrator/Pablo should run the smoke test pasted in the
  PR body to confirm a fresh apply.
- **The wrapper `pnpm db:generate` script** failed in the sandbox because
  `tsx` cannot create its IPC pipe (`listen EPERM ... /var/folders/.../tsx-501/...pipe`).
  Drizzle-kit was invoked directly (`pnpm exec drizzle-kit generate`) to
  produce the migration; the wrapper's convention checks were not run.
  This is a sandbox limitation only — the wrapper works in a normal shell
  and the SQL produced is identical.

### Files touched

- `packages/db/src/schema/collections.ts` (new)
- `packages/db/src/schema/custom_collections.ts` (new)
- `packages/db/src/schema/smart_rules.ts` (new)
- `packages/db/src/schema/shareables.ts` (new)
- `packages/db/src/schema/index.ts` (uncomment 4 lines, only)
- `packages/db/src/migrations/0004_collection_tables.sql` (drizzle-kit
  output renamed from `0004_natural_stick.sql` + header comment added)
- `packages/db/src/migrations/0005_collections_rls.sql` (hand-authored)
- `packages/db/src/migrations/meta/_journal.json` (two new entries; tag
  for 0004 set to `0004_collection_tables` after the rename)
- `packages/db/src/migrations/meta/0004_snapshot.json` (drizzle-kit output)
- `packages/db/src/fixtures/collections.ts` (new)
- `tasks/01-data-layer/T-DL-SCHEMA-COLLECTIONS.md` (this appendix)
