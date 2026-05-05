# T-DL-DATA-CONFLICT-TABLE — data_conflict table + resolver write path (admin debug surface)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** S
**Status:** in_progress

---

## Hard dependencies

- **T-DL-RLS-POLICIES** (merged at `3c448db`) — defines the
  service-role-only RLS posture template (`grading_training_sample`,
  `price_observation`) and the `verify-rls` structural asserter this
  task extends.
- **T-DL-SOURCE-INTERFACES** (merged via the resolver chain) —
  defines the in-memory `DataConflict` shape
  (`data-pipeline/src/types.ts`) and the resolver
  (`data-pipeline/src/resolver/resolver.ts`) that already emits
  conflicts; this task adds persistence, never changes the in-memory
  contract.

Transitive (already merged):

- **T-DL-SCHEMA-PRICING** (merged at `1cc7a40` / earlier) — closest
  precedent for a service-role-only Drizzle schema
  (`packages/db/src/schema/prices.ts` § price_observation) + repo
  pattern (`PriceAggregateRepo` in
  `data-pipeline/src/jobs/pricing-rollup.ts`).
- **T-DL-IMAGE-PIPELINE** (merged at `9be37c0`) — closest precedent
  for the pgTable + RLS-companion-migration pair
  (`packages/db/src/schema/printing_image.ts` +
  `0010_image_provenance.sql` + `0011_image_provenance_rls.sql`).
- **T-DL-SEED-INGEST** (merged at `34264a3`) — defines the seed
  pipeline
  (`data-pipeline/src/jobs/seed.ts`,
  `data-pipeline/src/jobs/seed/resolve-and-classify.ts`) where
  conflicts are observed today; this task threads a repo through the
  same wiring without changing the run-shape.

## Soft dependencies

- **T-DL-ADMIN-DEBUG-SURFACES** (stub; iter-11 candidate) — the next
  task that exposes `data_conflict` to humans via an admin view. This
  task ships the table the views read from. No coordination needed
  during this PR; the stub already exists and is `parallel_safe_with`
  this one.

## Required reading

- `PROJECT.md` § 6 (Data Model — "data_conflicts table"), § 7
  (Sources — "surface a conflict for human review").
- `rules/01-data-layer.md` (specifically the **"Conflicts are
  surfaced, not silenced"** hard rule).
- `context/data-model.md` § `data_conflict (admin-only)` — the
  pre-existing data-model sketch this task implements (with column
  refinements explained below).
- `data-pipeline/src/resolver/resolver.ts` — current in-memory
  `DataConflict` emission (`onConflict` callback wired into the
  seed-run report's `recordResolverConflicts` per source).
- `data-pipeline/src/jobs/seed/resolve-and-classify.ts` — the
  per-set integration point: `resolveCanonicalCards` and
  `resolveCanonicalPrintings` get an `onConflict` callback that
  currently only bumps a counter; this task additionally pushes each
  conflict into a per-set buffer flushed via the repo.
- `packages/db/src/schema/prices.ts` (`price_observation` —
  service-role-only Drizzle pgTable shape).
- `packages/db/src/schema/printing_image.ts` (sidecar pattern, jsonb
  + UNIQUE constraint, `created_at`/`updated_at` posture).
- `packages/db/src/migrations/0008_pricing_tables.sql` and
  `0010_image_provenance.sql` (drizzle-generated table-DDL shape we
  hand-author 0014 against if `db:generate` fails).
- `packages/db/src/migrations/0011_image_provenance_rls.sql` and
  `0009_pricing_rls.sql` (canonical RLS posture for service-role-only
  tables; the 0015 RLS migration mirrors this exactly).
- `packages/db/scripts/verify-rls.ts` and
  `packages/db/scripts/verify-rls/inventory.ts` — the structural RLS
  asserter; this task adds `data_conflict` to
  `EXPECTED_TABLES` + `NO_PERMISSIVE_POLICY_TABLES` and the
  behavioral block adds the standard "anon/authenticated denied;
  service_role allowed" assertions.
- `data-pipeline/src/jobs/pricing-rollup.ts` (`PriceAggregateRepo`
  interface + `InMemoryPriceAggregateRepo` shim) — the repo pattern
  this task copies for `ConflictLogRepo`.
- `data-pipeline/scripts/pricing-rollup.ts` (~lines 226–272, the
  Drizzle `onConflictDoUpdate` recipe) — the production wiring
  pattern.

## Goal

Persist the per-source resolver conflicts that the seed-run report
currently only counts. Today, when the resolver detects that a
validation source disagrees with the primary, it emits an in-memory
`DataConflict` and the seed reporter bumps a counter; the conflict
itself is lost the moment the run ends.

This task adds:

1. A `data_conflict` Postgres table (service-role-only, RLS-gated,
   defense-in-depth REVOKE/GRANT).
2. A `ConflictLogRepo` (Drizzle production impl + InMemory test
   shim) that upserts batches of `RawDataConflict` rows with
   `(entity_kind, entity_canonical_key, field_name)` as the conflict
   target — re-running seed bumps `dispute_count`, never duplicates.
3. Wiring through `processSet` so each conflict observed during a
   seed run is buffered and flushed to the repo at the end of the
   set (not per-row, to keep round-trips bounded).
4. A `verify-rls` extension that pins the new table's posture so
   future migrations can't silently weaken it.

This is the precondition for the iter-11 admin-debug-surfaces task
that will expose "top conflicts by dispute_count", the per-source
breakdown, and an eventual manual-override workflow. By itself this
PR ships zero user-visible behavior — it makes the resolver's
already-emitted conflicts queryable via psql by an operator.

## Scope — in

- `packages/db/src/schema/data_conflict.ts` — Drizzle pgTable.
- `packages/db/src/schema/index.ts` — append a new sectioned
  `=== T-DL-DATA-CONFLICT-TABLE ===` re-export.
- `packages/db/src/migrations/0014_data_conflict.sql` — table DDL
  (drizzle-kit-generated when possible; hand-authored otherwise per
  the precedent of every prior table-creation migration).
- `packages/db/src/migrations/0015_data_conflict_rls.sql` —
  hand-authored RLS + REVOKE/GRANT, mirroring
  `0009_pricing_rls.sql` § price_observation and
  `0011_image_provenance_rls.sql`.
- `packages/db/src/migrations/meta/_journal.json` — append entries
  for 0014 + 0015.
- `packages/db/src/migrations/meta/0014_snapshot.json` — generated
  snapshot (or hand-merged from 0010_snapshot.json — the previous
  snapshot — augmenting with the new table).
- `packages/db/scripts/verify-rls/inventory.ts` — append
  `data_conflict` to `EXPECTED_TABLES` and
  `NO_PERMISSIVE_POLICY_TABLES`.
- `packages/db/scripts/verify-rls/assertions.ts` — extend the
  behavioral matrix with `data_conflict` denied for
  anon/authenticated, allowed for service_role.
- `data-pipeline/src/resolver/conflict-log.ts` — `ConflictLogRepo`
  interface, `RawDataConflict` row type, `InMemoryConflictLogRepo`
  shim, `DrizzleConflictLogRepo` production impl, plus helper
  `dataConflictFromResolverConflict(...)` that adapts the in-memory
  `DataConflict` (`entity` / `entityKey` / `field` / `sources` /
  `chosenValue` / `chosenSource`) to the row shape.
- `data-pipeline/src/resolver/conflict-log.test.ts` — unit tests
  driven against the in-memory shim (idempotency, batching, helper
  shape, repo no-op on empty input).
- `data-pipeline/src/jobs/seed/resolve-and-classify.ts` — buffer
  conflicts emitted by the resolver and flush via the repo at the
  end of each set's processing. Backwards-compatible: the in-memory
  `DataConflict` array continues to feed the report's per-source
  counter.
- `data-pipeline/src/jobs/seed.ts` — accept an optional
  `conflictLog?: ConflictLogRepo` on `SeedOptions`; pass through
  to `processSet`. When undefined, the resolver still tallies
  conflicts in the report but skips the persistence write (preserves
  every existing test as-is).
- `data-pipeline/src/jobs/seed/resolve-and-classify.test.ts` (or a
  sibling test next to it; if no test file exists today, add one) —
  cover the new flush behavior end-to-end against the in-memory
  shim.
- `data-pipeline/scripts/seed.ts` — wire a `DrizzleConflictLogRepo`
  in `buildProductionWiring()` and pass it into `runSeedIngest`.
- `data-pipeline/src/index.ts` — re-export the new module via the
  existing `resolver/resolver.js` pattern (add a sibling
  `export * from './resolver/conflict-log.js';`).
- `data-pipeline/README.md` — append a `## Data conflict log`
  section explaining the persistence + paste-able psql smoke test.
- `dependencies.yaml` — flip `T-DL-DATA-CONFLICT-TABLE` from
  `in_progress` → `review`.
- This task file — flip `Status` header to `review` after CI green.

## Scope — out

- **Manual-override CLI / admin UI.** The `notes` and `resolution`
  columns exist for future writers; this PR persists rows but does
  not ship a writer that updates them. T-DL-ADMIN-DEBUG-SURFACES (or
  a dedicated future task) owns the manual-override workflow.
- **Conflict-driven resolver behavior changes.** The resolver still
  picks the primary and surfaces. This PR does NOT add a
  "consult prior `data_conflict` rows to flip the chosen value"
  feature.
- **Image-pipeline conflicts.** This task only persists resolver
  conflicts (`set` / `card` / `printing` field disagreement). Image
  transcode failures live in `printing_image` (or as a future
  surface). Out of scope.
- **Pricing-resolver conflicts.** Pricing aggregates don't run
  through `resolveCanonical*`; they have no `DataConflict` emission
  path today and don't need persistence here.
- **Drizzle-side `db:migrate` smoke test from sandbox.** As with
  every prior migration, the live `db:migrate` is Pablo-side
  post-merge (T-DL-DB-TEST-INFRA tracks the sandbox EPERM fix). The
  PR body ships a paste-able smoke test.

## Approach

### Table shape

The merged in-memory `DataConflict`
(`data-pipeline/src/types.ts` ~line 344) carries:

```ts
{
  entity: 'set' | 'card' | 'printing',
  entityKey: string,                 // canonical key
  field: string,                     // 'name' | 'hp' | 'rarityRaw' | '__presence' | …
  sources: Record<string, unknown>,  // { tcgdex: 'X', ptcgio: 'Y', reason?: '…' }
  chosenValue: unknown,
  chosenSource: string,              // primary's `source` value
}
```

The persisted shape adds the audit columns the data-model sketch
specifies (`context/data-model.md` § data_conflict) plus the
idempotency columns the dispatch's spec calls out:

```sql
data_conflict (
  id                      uuid pk default gen_random_uuid(),
  entity_kind             text not null,        -- 'set' | 'card' | 'printing' (CHECK-constrained)
  entity_canonical_key    text not null,        -- canonicalKey or variant_key; NOT a FK (sources can flag conflicts before the entity exists)
  field_name              text not null,        -- 'name' | 'hp' | 'rarityRaw' | '__presence' | …
  sources                 jsonb not null,       -- direct echo of resolver's `sources` map
  resolution              text,                 -- 'kept_<source>' | 'unresolved' | 'manual_override'
  kept_value              jsonb,                -- normalized as jsonb so strings/numbers/null all round-trip
  dispute_count           int not null default 1,
  last_seen_at            timestamptz not null default now(),
  notes                   text,                 -- nullable; manual-override audit trail (writer is future work)
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  CONSTRAINT data_conflict_entity_kind_check
    CHECK (entity_kind IN ('set', 'card', 'printing')),
  CONSTRAINT data_conflict_canonical_unique
    UNIQUE (entity_kind, entity_canonical_key, field_name)
);
```

Indices:

- The composite UNIQUE on `(entity_kind, entity_canonical_key,
  field_name)` doubles as the natural lookup index for the future
  admin views.
- `data_conflict_dispute_count_idx` on `dispute_count` DESC for the
  "top conflicts by recurrence" query the admin views will run.
- `data_conflict_last_seen_at_idx` on `last_seen_at` DESC for "what
  changed in the most recent run" queries.

Naming choices vs the data-model sketch:

- **`entity_kind`** instead of `entity`: avoids shadowing the
  generic SQL keyword and matches the zod enum the in-memory type
  uses.
- **`entity_canonical_key`** instead of `entity_key`: the field is
  the canonical key — being explicit removes ambiguity for callers
  reading `\d+ data_conflict`.
- **`field_name`** instead of `field`: same reasoning — `field` is
  reserved-ish in some Postgres tooling.
- **`kept_value`** instead of `resolution`-as-the-value: the sketch
  conflated "what we kept" with "how we resolved it"; this PR
  splits them so `resolution` carries an audit verb (`kept_*` /
  `unresolved` / `manual_override`) and `kept_value` carries the
  payload the resolver decided on.

### `RawDataConflict` row type

```ts
export interface RawDataConflict {
  readonly entityKind: 'set' | 'card' | 'printing';
  readonly entityCanonicalKey: string;
  readonly fieldName: string;
  readonly sources: Record<string, unknown>;
  readonly keptValue: unknown;
  readonly resolution: string; // e.g. `kept_tcgdex-en`, `unresolved`
  readonly lastSeenAt: Date;
}
```

Helper:

```ts
export function dataConflictFromResolverConflict(
  c: DataConflict,
  now: () => Date = () => new Date(),
): RawDataConflict;
```

Maps the in-memory `DataConflict` to a `RawDataConflict` with
`resolution = `kept_${c.chosenSource}`` for the standard "primary
won" path, or `'unresolved'` when `chosenValue` is null AND
`chosenSource` is `'primary'` (the `__presence` conflict shape from
`resolver.ts` ~line 297 + ~line 591).

### `ConflictLogRepo` interface

```ts
export interface ConflictLogRepo {
  /**
   * Upsert a batch of conflicts. Idempotent: re-runs against the
   * same `(entityKind, entityCanonicalKey, fieldName)` triple bump
   * `dispute_count` instead of inserting.
   *
   * Returns the number of input rows processed (for run-report
   * accounting).
   */
  upsertMany(rows: ReadonlyArray<RawDataConflict>): Promise<number>;
}
```

In-memory shim keys on the same triple, increments
`dispute_count`, and updates `last_seen_at`/`sources`/`keptValue`
to the latest. Drizzle production impl issues the canonical
`onConflictDoUpdate`:

```ts
.onConflictDoUpdate({
  target: [
    dataConflictTable.entityKind,
    dataConflictTable.entityCanonicalKey,
    dataConflictTable.fieldName,
  ],
  set: {
    sources: sql`excluded.sources`,
    keptValue: sql`excluded.kept_value`,
    resolution: sql`excluded.resolution`,
    lastSeenAt: sql`excluded.last_seen_at`,
    disputeCount: sql`${dataConflictTable.disputeCount} + 1`,
    updatedAt: sql`now()`,
  },
})
```

### Resolver / seed integration

`processSet` in `resolve-and-classify.ts` already passes an
`onConflict` callback into `resolveCanonicalCards` and
`resolveCanonicalPrintings`. Today the callback bumps a counter on
the reporter:

```ts
onConflict: (c) => reporter.recordResolverConflicts('card', c.chosenSource, 1),
```

Augment so the callback also pushes into a per-set buffer:

```ts
const conflictBuffer: DataConflict[] = [];
const onConflict = (entity: 'card' | 'printing', c: DataConflict) => {
  reporter.recordResolverConflicts(entity, c.chosenSource, 1);
  conflictBuffer.push(c);
};
```

At the end of `processSet`, if `conflictLog` is provided, flush:

```ts
if (conflictLog && conflictBuffer.length > 0) {
  const now = clock();
  await conflictLog.upsertMany(
    conflictBuffer.map((c) => dataConflictFromResolverConflict(c, () => now)),
  );
}
```

The buffer is per-set so a failed flush only loses one set's
worth of conflicts (and the underlying counter on the report
still reflects them). A flush failure is a `recordError` + log;
it does NOT abort the set's catalog writes. (The conflict log is
debug data; losing a write must never block ingestion.)

`runSeedIngest` accepts an optional
`conflictLog?: ConflictLogRepo` and forwards it to `processSet`.
When `undefined`, every existing test's behavior is preserved.

### Per-set buffering rationale

- Per-row writes would balloon round-trips: a single resolver run
  on `en-swsh9` emits ~341 conflict candidates across 216 cards.
  At 200ms p95 per round trip that's ~70s pure DB latency —
  unacceptable for a seed run.
- Per-run buffering would bound memory in the worst case (every
  card disagrees on every field), but a per-set bound (≤ a few
  hundred conflicts) is more ergonomic and matches the
  pricing-rollup repo's per-day batching shape.
- A future optimization can swap to a single per-run flush at the
  cost of memory; the repo interface accepts an arbitrary batch.

### Sandbox `db:generate` fallback

`pnpm --filter @binderly/db db:generate` fails under the sandbox's
tsx-IPC-pipe limitation (the same issue tracked by
T-DL-DB-TEST-INFRA). Two fallbacks:

1. `pnpm exec drizzle-kit generate` directly — sometimes works
   when the wrapper script doesn't.
2. Hand-author both `0014_data_conflict.sql` and
   `meta/0014_snapshot.json` by inspecting how `0008_pricing_tables.sql`
   translates `prices.ts` and how `0010_snapshot.json` adds the
   `printing_image` table.

The PR will document which path was taken in "Notes from execution".

### RLS posture

Service-role-only — mirrors `price_observation` posture exactly:

```sql
ALTER TABLE "data_conflict" ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated. service_role bypasses RLS via
-- BYPASSRLS. The defense-in-depth REVOKE/GRANT below makes the
-- privilege snapshot match the policy posture.

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "data_conflict" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "data_conflict" TO service_role;
```

There is **no** `admin` role in local Supabase today (verified at
elaboration time against the `pg_roles` snapshot embedded in
T-DL-RLS-POLICIES). The data-model sketch's "admin role only" intent
is captured by service_role + the future T-DL-ADMIN-DEBUG-SURFACES
task that may grant a dedicated `admin` role. This PR ships
service-role-only and the future task adds the `admin` GRANT
incrementally.

### `verify-rls` extension

- Add `data_conflict` to `EXPECTED_TABLES` (note:
  "pipeline-internal — service_role only").
- Add `data_conflict` to `NO_PERMISSIVE_POLICY_TABLES`.
- The behavioral matrix in `assertions.ts` already loops over
  `NO_PERMISSIVE_POLICY_TABLES` for anon + authenticated denials
  and over `service_role` for the BYPASSRLS path. Adding
  `data_conflict` to the same loop covers both verbs.

## Acceptance criteria

- [ ] Migration `0014_data_conflict.sql` exists, creates the table
      with the columns + types listed under "Approach > Table shape".
- [ ] Migration `0015_data_conflict_rls.sql` exists, mirrors
      `0011_image_provenance_rls.sql` + `0009_pricing_rls.sql`
      (price_observation block) for the RLS + REVOKE/GRANT.
- [ ] Both migrations are idempotent and re-runnable.
- [ ] `_journal.json` carries new entries at `idx: 14` and `idx: 15`
      with tags `0014_data_conflict` / `0015_data_conflict_rls`,
      version `7`, breakpoints `true`, and a monotonically-increasing
      `when` field.
- [ ] `meta/0014_snapshot.json` exists (drizzle-generated or
      hand-merged from 0010_snapshot.json + the new table).
- [ ] `packages/db/src/schema/data_conflict.ts` exports a
      `dataConflictTable` pgTable + `DataConflict` /
      `NewDataConflict` row types.
- [ ] `packages/db/src/schema/index.ts` re-exports the new module
      under a new `=== T-DL-DATA-CONFLICT-TABLE ===` section.
- [ ] `data-pipeline/src/resolver/conflict-log.ts` exports
      `ConflictLogRepo` interface, `RawDataConflict` row type,
      `InMemoryConflictLogRepo` shim, `DrizzleConflictLogRepo`
      production impl, and `dataConflictFromResolverConflict()` helper.
- [ ] `InMemoryConflictLogRepo.upsertMany([])` is a no-op (returns 0).
- [ ] Re-running `upsertMany` against the same triple bumps
      `disputeCount` instead of inserting (verified in unit test).
- [ ] `dataConflictFromResolverConflict` maps a "primary won" conflict
      to `resolution = 'kept_<chosenSource>'` and a `__presence`
      conflict (chosenValue null + chosenSource 'primary') to
      `resolution = 'unresolved'`.
- [ ] `runSeedIngest` accepts an optional `conflictLog?:
      ConflictLogRepo` on `SeedOptions`; when undefined, behavior is
      unchanged (every existing test still passes); when provided,
      conflicts are flushed per-set via the repo.
- [ ] `verify-rls.ts` adds `data_conflict` to `EXPECTED_TABLES` and
      `NO_PERMISSIVE_POLICY_TABLES`; the structural + behavioral
      assertions automatically pick it up.
- [ ] `data-pipeline/scripts/seed.ts` (production CLI) wires
      `DrizzleConflictLogRepo(db)` and passes it to `runSeedIngest`.
- [ ] `data-pipeline/README.md` carries a new `## Data conflict log`
      section with paste-able psql smoke commands.
- [ ] All five `@binderly/data-pipeline` package gates pass clean:
      `format:check`, `lint`, `typecheck`, `test`, `build`.
- [ ] All three `@binderly/db` package gates pass clean:
      `format:check`, `lint`, `typecheck`.
- [ ] Tests strictly grow (data-pipeline current: 1087; target ≥ 1093
      with 6+ new tests covering the repo + the seed integration).
- [ ] Branch `agent/T-DL-DATA-CONFLICT-TABLE` pushes; GitHub Actions
      checks pass green before the PR opens.

## Owns_paths

The `dependencies.yaml` entry lists:
- `packages/db/src/schema/data_conflict.ts`
- `data-pipeline/src/resolver/conflict-log.ts`

## Files outside `owns_paths` pre-authorized

The dispatch authorized the following set:

- `packages/db/src/schema/index.ts` — append a new sectioned
  re-export.
- `packages/db/src/migrations/0014_data_conflict.sql` (new).
- `packages/db/src/migrations/0015_data_conflict_rls.sql` (new).
- `packages/db/src/migrations/meta/_journal.json` — append two
  entries.
- `packages/db/src/migrations/meta/0014_snapshot.json` — generated
  or hand-merged.
- `packages/db/scripts/verify-rls/inventory.ts` — add the new table
  to two arrays.
- `packages/db/scripts/verify-rls/assertions.ts` — only if the
  per-NO_PERMISSIVE_POLICY_TABLES loop doesn't already cover it
  automatically (preferred: don't touch).
- `data-pipeline/src/jobs/seed.ts` — add the optional
  `conflictLog?` field on `SeedOptions` and forward it.
- `data-pipeline/src/jobs/seed/resolve-and-classify.ts` — buffer +
  flush conflicts via the repo.
- `data-pipeline/src/jobs/seed/resolve-and-classify.test.ts` (new)
  — cover the new behavior.
- `data-pipeline/scripts/seed.ts` — wire
  `DrizzleConflictLogRepo`.
- `data-pipeline/src/index.ts` — re-export the new module.
- `data-pipeline/README.md` — append a new section.
- `dependencies.yaml` — flip status `in_progress` → `review`.
- This task file — flip `Status` header to `review`.

## Migrations

Adds `0014_data_conflict.sql` (drizzle-generated when possible;
hand-authored otherwise) and `0015_data_conflict_rls.sql`
(hand-authored). Journal append at idx 14 + 15. Snapshot append at
`0014_snapshot.json`.

## Test plan

Unit tests in `data-pipeline/src/resolver/conflict-log.test.ts`
(new), all driven against `InMemoryConflictLogRepo`:

1. **No-op on empty**: `upsertMany([])` returns 0; no rows added.
2. **First insert**: a single row goes in with
   `dispute_count === 1`.
3. **Re-insert idempotency**: running the same row twice ends with
   one entry, `dispute_count === 2`, `lastSeenAt` updated.
4. **Distinct triples**: `(card, ck-1, name)` and `(card, ck-2,
   name)` are distinct rows.
5. **Helper — primary-won mapping**:
   `dataConflictFromResolverConflict({chosenSource: 'tcgdex-en',
   chosenValue: 'X', …})` → `resolution === 'kept_tcgdex-en'`,
   `keptValue === 'X'`.
6. **Helper — presence conflict mapping**:
   `dataConflictFromResolverConflict({chosenSource: 'primary',
   chosenValue: null, …})` → `resolution === 'unresolved'`.

Integration tests touching `processSet` (extending the existing
test surface or adding `resolve-and-classify.test.ts` if absent):

7. **Conflict flush wired**: with a fixture that produces ≥ 1
   resolver conflict, the in-memory repo records the row(s) with
   the expected triple.
8. **No-op when repo undefined**: legacy callers that don't pass
   `conflictLog` see unchanged behavior (the report's
   `resolverConflicts` counter still bumps).

Total: 6+ new tests. Strictly grows the package count (current
1087 → target ≥ 1093).

CLI / live smoke (paste-able for Pablo, in PR body):

```sh
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @binderly/db db:migrate

# Run seed against any set; the resolver's conflicts now persist:
pnpm --filter @binderly/data-pipeline seed --source tcgdex-en --set en-swsh9

# Inspect:
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT entity_kind, count(*) FROM data_conflict GROUP BY entity_kind;"

psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT entity_kind, entity_canonical_key, field_name,
             dispute_count, resolution, last_seen_at
        FROM data_conflict ORDER BY dispute_count DESC LIMIT 10;"
```

## Branch & PR

- Branch: `agent/T-DL-DATA-CONFLICT-TABLE`
- PR title: `T-DL-DATA-CONFLICT-TABLE: persist resolver conflicts for admin debugging (+author ADMIN-DEBUG-SURFACES stub)`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and escalate (append to `open-questions.md`) if:

- The resolver's emitted `DataConflict` shape (in
  `data-pipeline/src/types.ts` ~line 344) turns out to differ
  materially from what the dispatch described — re-design the
  helper's mapping rather than guess.
- An `admin` Postgres role exists in local Supabase that should be
  GRANT'd alongside `service_role` (it doesn't today; surface if
  found).
- Drizzle's `db:generate` fails AND the hand-authored snapshot
  approach can't faithfully reproduce the table shape against the
  prior snapshot — that signals a real schema-tooling regression.
- `verify-rls` no longer auto-loops over the
  `NO_PERMISSIVE_POLICY_TABLES` list (the `assertions.ts` shape has
  drifted) — surface before extending.

## Notes from execution

(Sub-agent appends here at end. Empty until then.)
