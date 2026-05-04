# T-DL-SEED-INGEST — Initial bulk ingest job: adapters → resolver → DB → R2

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** L
**Status:** review

---

## Hard dependencies

- T-DL-SOURCE-TCGDEX-EN (merged)
- T-DL-SOURCE-PTCGIO (merged)
- T-DL-SOURCE-BULBAPEDIA (merged)
- T-DL-SOURCE-TCGDEX-JP (merged) — also brought `pokemoncard-jp`
- T-DL-MASTER-SET-RULES (merged)
- T-DL-IMAGE-PIPELINE (merged) — `data-pipeline/src/images/`,
  `printing_image` table at migration `0010` + RLS at `0011`
- T-DL-RLS-POLICIES (merged)

## Soft dependencies

- T-DL-PROFILE-GRANTS-FIX (Q-003 follow-up; lands as migration `0012`).
  Does NOT touch catalog / printing / printing_image. SEED-INGEST writes
  via the service-role / direct `DATABASE_URL` and bypasses RLS, so
  Q-003 has no effect on this task. **Do not add a new migration here.**

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources & Standardization), § 8
  (Master Set), § 17 (Build Phases).
- `rules/01-data-layer.md` — esp. "Idempotent ingestion", "No image
  hotlinking", "Variant classification goes through the central decision
  tree", "Rate limits are mandatory".
- `context/tcg-domain.md` — variant taxonomy, canonical-key shape,
  master-set rules.
- `context/conventions.md` — TS rules, file layout, error handling,
  logging.
- `data-pipeline/README.md` — pipeline composition diagram.
- Phase-1 module sources:
  - `data-pipeline/src/adapters/index.ts` + each adapter's `adapter.ts`
    (constructor signatures + the `SourceAdapter` shape).
  - `data-pipeline/src/resolver/resolver.ts` — `resolveCanonicalSets`,
    `resolveCanonicalCards`, `resolveCanonicalPrintings`, `pullAndResolveSets`,
    `TieredRecords<T>`.
  - `data-pipeline/src/variant-classify.ts` — `classifyVariant(printing,
    card, set)` → `{ variant_class, variant_flags, variant_code,
    include_in_master_set_default }`.
  - `data-pipeline/src/master-set/index.ts` + `decide.ts` —
    `decideMasterSetMembership({ set, printings })` → `{ decisions,
    overridesApplied }`.
  - `data-pipeline/src/images/index.ts` + `processor.ts` + `dedup.ts` +
    `storage.ts` + `types.ts` — `processImage`, `EXCLUDED_IMAGE_SOURCES`,
    `S3ImageStorage`, `createLocalMinioClient`, `ImageDedupResolver`,
    `SOURCE_LICENSE_MAP`, `IMAGE_SOURCES`, `PrintingImageRow`.
  - `data-pipeline/src/canonical-keys.ts` + `data-pipeline/src/normalize/*`.
  - `packages/db/src/client.ts` — `createDbClient`.
  - `packages/db/src/schema/{sets,cards,printings,printing_image}.ts` —
    column shapes, `canonical_key` / `variant_key` UNIQUE indices, the
    `(source, original_sha256)` UNIQUE on `printing_image`.
- `infra/docker-compose.yml` + `.env.example` — Postgres on port 5433,
  MinIO on 9000/9001, `DATABASE_URL`, `S3_ENDPOINT_URL`,
  `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`.

## Goal

Wire the Phase-1 catalog modules into a single end-to-end bulk ingest
job. The job runs every primary adapter (`tcgdex-en`, `tcgdex-jp`),
optionally consults validation/filler tier adapters (`ptcgio`,
`bulbapedia-en`, `pokemoncard-jp`) through the resolver, classifies
variants, decides master-set membership, transcodes images via the
image pipeline (writing to R2/MinIO), and idempotently upserts into the
`set` / `card` / `printing` / `printing_image` tables. Re-running the
job is a no-op at the row + image level (canonical-key UNIQUE indices
on the catalog tables, `(source, original_sha256)` dedup on
`printing_image`).

This is the **integration crown jewel of Phase 1**: the first end-to-end
exercise of every Phase-1 module together. Bugs across modules are
expected; the orchestrator is on standby for fixup.

## Run shape

```
                         runSeedIngest(opts)
                                 │
                                 ▼
                    ┌─────── enumerate-sets ───────┐
                    │  pullAndResolveSets(adapters)│
                    │   → CanonicalSet[]           │
                    │   + DataConflict[] (recorded │
                    │     in the run report; never │
                    │     persisted in this PR)    │
                    └──────────────┬───────────────┘
                                   │
                  per-set, bounded concurrency
                                   │
                                   ▼
                    ┌──── upsert-set (DB) ─────────┐
                    │ INSERT … ON CONFLICT          │
                    │ (canonical_key) DO UPDATE     │
                    │ → row.id                      │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                ┌──── fetch-cards (per source) ────┐
                │ adapter.listCardsForSet(setKey)  │
                │ resolveCanonicalCards(...)       │
                │ → CanonicalCard[]                │
                └──────────────┬───────────────────┘
                               │
                               ▼
            ┌──── for each canonical card ─────────┐
            │  upsert card (FK = set.id, on        │
            │  conflict canonical_key)             │
            │  fetch printings per source          │
            │  classifyVariant(...) on primary     │
            │  resolveCanonicalPrintings(...)      │
            │  decideMasterSetMembership({set,…})  │
            │  upsert printing (on conflict        │
            │  variant_key); FK = card.id          │
            │  processImage(...) (RateLimitedClient│
            │  + S3ImageStorage + DrizzleDedup)    │
            │  if ok: write image_*_url back to    │
            │  printing                            │
            └──────────────┬───────────────────────┘
                           │
                           ▼
              accumulate per-stage metrics + errors
                           │
                           ▼
                     emit SeedRunReport
                  (printed + JSON file)
```

### Adapter dispatch

- **Primary tier (drives enumeration):** `tcgdex-en` (EN) and
  `tcgdex-jp` (JP). `pullAndResolveSets` already partitions by
  `adapter.tier`; we simply pass the full adapter list.
- **Validation tier (cross-checks the primary):** `ptcgio` (EN). The
  resolver records `DataConflict`s; SEED-INGEST aggregates them in the
  end-of-run report. **A `data_conflict` table is out of scope for this
  PR** (T-DL-DATA-CONFLICT-TABLE territory) — we keep them in memory
  for reporting only.
- **Filler tier (fills nullable fields, image fallback URLs):**
  `bulbapedia-en` (EN), `pokemoncard-jp` (JP). Both adapters'
  `listSets()` return `[]` by design — they only contribute at the
  card / printing tier. SEED-INGEST does **not** call
  `listCardsForSet` on them in v1: they require the per-set / per-card
  ID to be known upstream (Bulbapedia category title; Pokemon-Card.com
  pcjpSetId). Wiring those is left for follow-ups
  (T-DL-FILLER-WIRING-EN, T-DL-FILLER-WIRING-JP — added as stubs to
  `dependencies.yaml` if not already present).
- **Bulbapedia images** are auto-skipped by the image pipeline via
  `EXCLUDED_IMAGE_SOURCES`. Defence-in-depth: SEED-INGEST never even
  *attempts* to process Bulbapedia images (would always early-return).
  Counters in the report still expose what was excluded.

### Concurrency model

| Stage                                    | Pool          | Sizing                                | Why                                                                          |
| ---------------------------------------- | ------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Per-adapter HTTP                         | Bottleneck    | Owned by each adapter's `RateLimitedClient` | Already enforced upstream — TCGdex 5 req/s / burst 10, PTCGIO 5/10, Bulbapedia 1/2, pokemoncard-jp 1/1. SEED-INGEST does NOT override. |
| Per-set processing                       | inline pool   | `--set-concurrency` (default `2`)     | Sets touch the same `set` row only; cards/printings under different sets are independent. Keep low to avoid pile-on against the rate limiter. |
| Card-level loop within a set             | sequential    | 1                                     | Card-level work is gated on the per-adapter HTTP rate limiter; an inner pool would just queue behind the limiter. Sequential keeps logging coherent and respects `noUncheckedIndexedAccess`. |
| Image transcode (CPU)                    | inline pool   | `--image-concurrency` (default `4`)   | sharp transcodes are CPU-bound. We provide a tiny built-in `concurrencyPool(limit)` helper (≤ 30 lines, no new dep) — no need for `p-limit`. |
| DB writes                                | sequential per-printing | 1                           | Writes are tiny and ordered (set → card → printing → printing_image). Postgres handles the throughput trivially. |

The two pools are implemented inline in
`data-pipeline/src/jobs/seed/concurrency.ts` to avoid adding a
runtime dep (`p-limit` is **not** in `data-pipeline/package.json` —
the image-pipeline elaboration mentioned it but the implementation
ended up not needing it; we keep the same posture).

### Idempotency / resume strategy

**Strategy: Pure-DB-state-driven (option (b) in the task brief).**

- **No new migration.** The orchestrator's brief is explicit:
  T-DL-PROFILE-GRANTS-FIX owns the `0012` slot. We do not add an
  `ingest_run_log` table.
- Re-running the seed re-fetches from the upstream sources and re-runs
  every upsert. Idempotency is enforced at the row level by the UNIQUE
  indices already on the catalog tables:
  - `set.canonical_key` UNIQUE → `setTable.canonicalKey`
  - `card.canonical_key` UNIQUE → `cardTable.canonicalKey`
  - `printing.variant_key` UNIQUE → `printingTable.variantKey`
  - `printing_image (source, original_sha256)` UNIQUE → the dedup
    contract owned by the image pipeline.
- Image transcoding is skipped on a re-run by the image pipeline's own
  dedup probe: `DrizzleImageDedupResolver.findExisting({source,
  originalSha256})` returns the existing row → `processImage` returns
  `status: 'cached'` without re-fetching, transcoding, or uploading.
- **Trade-off accepted:** re-running the seed against an unchanged
  catalog still re-pulls every set / card / printing from the upstream
  sources (cost = O(catalog) HTTP calls). The bound is set by the
  rate limiters; for a full English+Japanese run this is bounded but
  not cheap. A future T-DL-INGEST-CHECKPOINT can layer a state table
  (or a content-hash skip) on top once we have one full real-world
  baseline.

### Failure handling

- Any adapter throw on a single (set | card) MUST NOT abort the run.
  We wrap `adapter.listCardsForSet`, `adapter.listPrintingsForCard`,
  the per-printing image-pipeline call, and the per-printing DB upsert
  in `try/catch`, log the failure with full context (`set_id`,
  `source`, `card_id`, `variant_key`), append a `SeedRunError` to the
  report's error list, and continue.
- A throw at the **set enumeration** stage (`adapter.listSets()`)
  for a primary adapter aborts the run for that primary only —
  enumerate is the contract that says "what is the universe of work?";
  losing it for one primary loses that adapter's leg of the run, but
  the other primary continues.
- The resolver itself never throws on conflict (it surfaces
  `DataConflict[]`). We collect those into the report.
- `SeedRunError` is a small discriminated union:
  ```ts
  type SeedRunError =
    | { kind: 'enumerate_sets'; source: string; cause: unknown }
    | { kind: 'fetch_cards'; source: string; setKey: string; cause: unknown }
    | { kind: 'fetch_printings'; source: string; cardKey: string; cause: unknown }
    | { kind: 'image_pipeline'; source: ImageSource; variantKey: string; error: ImagePipelineError }
    | { kind: 'db_upsert'; entity: 'set' | 'card' | 'printing' | 'printing_image'; key: string; cause: unknown };
  ```

### Reporting

End-of-run report (`SeedRunReport`):

```ts
interface SeedRunReport {
  startedAt: string;                  // ISO timestamp
  finishedAt: string;
  durationMs: number;
  options: SeedOptions;               // echoed back so the JSON file is self-describing
  perSource: Record<string, {
    tier: AdapterTier;
    setsEnumerated: number;
    cardsFetched: number;
    printingsFetched: number;
    resolverConflicts: number;
  }>;
  resolver: {
    setConflicts: number;
    cardConflicts: number;
    printingConflicts: number;
    /** Conflicts grouped by `validating_source → field → count`. */
    agreementsBySource: Record<string, Record<string, number>>;
  };
  variantClassDistribution: Record<VariantClass, number>;
  masterSet: {
    decided: number;
    included: number;
    excluded: number;
    overridesApplied: number;
  };
  imagePipeline: {
    transcoded: number;
    cached: number;
    skippedNoUrl: number;
    skippedExcludedSource: number;
    errors: number;
  };
  db: {
    setsUpserted: number;
    cardsUpserted: number;
    printingsUpserted: number;
  };
  timings: {
    /** p50/p95/p99 per stage, in ms. */
    [stage in 'enumerate_sets'|'fetch_cards'|'resolve_classify'|'image_pipeline'|'db_upsert']: { p50: number; p95: number; p99: number; count: number };
  };
  errors: SeedRunError[];
  /** Top-N error log entries (by recency) for the printed summary. */
  errorsTopN: SeedRunError[];
}
```

The CLI prints a one-page summary and writes the full JSON to
`data-pipeline/scripts/output/seed-run-{ISO_TIMESTAMP}.json`. The
output directory is git-tracked via `.gitkeep` and excluded from git
otherwise (`data-pipeline/scripts/output/.gitignore` keeping only the
`.gitkeep`).

### CLI ergonomics

`pnpm --filter @binderly/data-pipeline seed [--source <name>] [--set <key>]
[--limit-sets <n>] [--limit-cards <n>] [--dry-run] [--no-images]
[--set-concurrency <n>] [--image-concurrency <n>] [--report-dir <path>]`

- `--source <name>` — restrict primary enumeration to this adapter
  (`tcgdex-en` | `tcgdex-jp`). Validation/filler tiers still attach
  unless `--no-validation` / `--no-filler` are passed.
- `--set <key>` — restrict to one set. The key is the **adapter's own**
  set id (e.g. `swsh9` for tcgdex-en's "Brilliant Stars"). Multiple
  `--set` flags compose into an allow-list.
- `--limit-sets <n>` / `--limit-cards <n>` — bounds for fast smoke
  tests; the run stops enumerating new sets/cards once the bound is
  hit (still finishes the current set so DB state stays consistent).
- `--dry-run` — does everything except DB writes and image-pipeline
  uploads. Useful for "is the resolver behaving sanely?" without
  touching infra.
- `--no-images` — skip the image-pipeline call. Adapters still emit
  `imageSourceUrl` and the report counts what *would* have been
  processed; useful for quick catalog-only runs.
- `--set-concurrency <n>` / `--image-concurrency <n>` — pool sizes
  documented above.
- `--report-dir <path>` — override the output directory. Defaults to
  `data-pipeline/scripts/output`.

### Test strategy

The full live integration is not unit-testable in the sandbox
(requires Postgres + MinIO). We split the test surface:

1. **Per-stage unit tests** (`data-pipeline/src/jobs/seed/*.test.ts`):
   - `enumerate-sets.test.ts` — feeds a `MockAdapter` returning
     synthetic `RawSet[]` and asserts `pullAndResolveSets` produces the
     expected canonical merge.
   - `resolve-and-classify.test.ts` — feeds a `MockAdapter` with a
     hand-crafted card → printings tree and asserts the classifier +
     resolver wire produces the expected `CanonicalPrinting[]` with
     correct `variantClass`, `variantCode`, `includeInMasterSet`.
   - `db-upsert.test.ts` — uses an in-memory **fake DB layer** (a
     thin `CatalogWriter` interface that the production code talks to;
     prod impl is Drizzle-backed, test impl is a `Map`-backed fake)
     and asserts upserts are idempotent across two consecutive runs.
   - `image-pipeline-runner.test.ts` — feeds the runner an
     `InMemoryDedupResolver`, an in-memory `ImageStorage` fake, a
     `RateLimitedClient` with a `fetchImpl` shim returning a tiny PNG,
     and asserts (a) Bulbapedia is excluded by counter, (b) re-runs hit
     the cache.
   - `reporter.test.ts` — feeds a populated metrics struct into the
     reporter and asserts the printed summary + JSON shape is stable
     (snapshot test).
2. **Top-level orchestration test** (`data-pipeline/src/jobs/seed.test.ts`)
   wires three `MockAdapter`s (one primary, one validation, one filler)
   into `runSeedIngest`, runs against the in-memory DB + storage +
   dedup, and asserts the report counters match expectations:
   - `report.perSource['tcgdex-en'].setsEnumerated > 0`
   - `report.imagePipeline.skippedExcludedSource > 0` (Bulbapedia
     fixture)
   - Re-running with the same fakes yields zero new transcodes
     (`report.imagePipeline.cached === total`).
   - `report.masterSet.included > 0`.
3. **Live integration smoke test** — documented as a paste-able
   script in the PR body (Pablo runs it against the local Docker
   stack). The sandbox cannot run Docker.

### Migration constraint

**No new migrations in this PR.** All schema we need exists at
migration `0011`. If during implementation we discover a missing
column / index / constraint, we **stop and append to
`open-questions.md`** with a Q-NNN entry rather than adding `0012`
(which T-DL-PROFILE-GRANTS-FIX owns).

### Q-003 awareness

Q-003 (verify-rls failures on `profile` / `subscription` grants) is
unrelated to this task. SEED-INGEST writes via `DATABASE_URL` (direct
service-role / superuser) and never touches profile/subscription rows.
We document this in the PR body and move on.

## Deliverables

Owns paths (per `dependencies.yaml`):

- `data-pipeline/src/jobs/seed.ts` — main module: re-exports +
  `runSeedIngest(options): Promise<SeedRunReport>`.
- `data-pipeline/scripts/` — folder. Contains the CLI script + output
  directory.

Pre-authorized additional files (per the task brief):

- `data-pipeline/src/jobs/index.ts` — barrel re-exporting the
  `seed.ts` public surface.
- `data-pipeline/src/index.ts` — append `export * from
  './jobs/index.js';` at the bottom (single line).
- `data-pipeline/package.json` — add `"seed": "tsx scripts/seed.ts"`
  to `scripts`. **One new devDep**: `tsx@4.21.0` (already in the
  monorepo via `packages/db`; no version drift).
- `data-pipeline/src/jobs/seed.test.ts` — top-level orchestration test.
- `data-pipeline/src/jobs/seed/` — sub-folder for per-stage modules:
  - `concurrency.ts` — tiny in-memory `concurrencyPool(limit)` helper.
  - `errors.ts` — `SeedRunError` union, `formatSeedRunError`.
  - `report.ts` — `SeedRunReport` type, `Reporter` class
    (timings, counters, JSON serialization, printed summary).
  - `enumerate-sets.ts` — wraps `pullAndResolveSets`; per-source
    metrics; per-source try/catch.
  - `fetch-cards.ts` — pulls cards per source for a given setKey, with
    per-source try/catch.
  - `resolve-and-classify.ts` — composes the resolver + variant
    classifier + master-set engine into a single `processSet` step.
  - `image-pipeline-runner.ts` — instantiates per-source
    `RateLimitedClient`s pinned to the image hosts, fans out via the
    image pool.
  - `db-upsert.ts` — `CatalogWriter` interface + `DrizzleCatalogWriter`
    impl. Reads via `eq(setTable.canonicalKey, key)` after each
    `INSERT … ON CONFLICT … DO UPDATE … RETURNING id`.
  - `image-dedup.ts` — `DrizzleImageDedupResolver` implementing
    `ImageDedupResolver` against `printingImageTable`.
  - Tests colocated as `*.test.ts`.
- `data-pipeline/src/jobs/seed.fixtures.ts` — `MockAdapter` class +
  synthetic catalog fixtures (1 EN set with 2 cards × 3 printings; 1
  JP set with 1 card × 1 printing; 1 Bulbapedia validation set).
- `data-pipeline/scripts/seed.ts` — CLI entry. Parses args (no new
  dep — uses Node's built-in `util.parseArgs`), wires env-driven
  config (`DATABASE_URL`, `S3_ENDPOINT_URL`, `MINIO_ROOT_*`,
  `BINDERLY_DATA_PIPELINE_UA`, `BINDERLY_PTCGIO_API_KEY`), calls
  `runSeedIngest`, prints the summary, exits non-zero on any
  unrecoverable error.
- `data-pipeline/scripts/output/.gitkeep` — keeps the dir tracked.
- `data-pipeline/scripts/output/.gitignore` — `*` then `!.gitkeep`
  to keep generated reports out of git.
- `data-pipeline/README.md` — append a `## How to seed` section with
  the CLI invocation and the human smoke-test steps.

## Acceptance criteria

- [ ] `runSeedIngest(opts: SeedOptions): Promise<SeedRunReport>` is
      the documented public entry point and is re-exported from
      `@binderly/data-pipeline`.
- [ ] `--source` / `--set` filters honored at runtime: a single-source
      single-set unit test against `MockAdapter` fixtures populates the
      synthetic in-memory DB with the expected canonical-key rows and
      the image-pipeline call records the right inputs.
- [ ] Multi-source multi-set unit test passes (synthetic primary +
      validation + filler `MockAdapter`s); resolver-agreement
      statistics in the report are non-zero where validation matches
      and conflicts are recorded where it doesn't; `report.masterSet.
      included > 0`.
- [ ] Bulbapedia images are auto-skipped:
      `report.imagePipeline.skippedExcludedSource > 0` in any test
      that includes `bulbapedia-en` in the adapter list.
- [ ] Re-running the seed against the same in-memory state yields
      zero new transcodes:
      `report.imagePipeline.cached === report.imagePipeline.transcoded
      + report.imagePipeline.cached` from the first run, AND
      `report.imagePipeline.transcoded === 0` on the second.
- [ ] DB upsert is idempotent: a unit test runs `runSeedIngest` twice
      against the in-memory `CatalogWriter` fake and asserts row
      counts unchanged after the second run.
- [ ] Failure isolation: a unit test injects a thrown
      `TransientError` from one adapter on one card and asserts (a)
      the run completes, (b) the error is in `report.errors`, (c)
      other cards/sets in the run still upsert.
- [ ] No new DB migration. Migration count remains 12 files
      (`0000`–`0011`). If a column or constraint is missing, the
      sub-agent escalates via `open-questions.md` instead of adding
      `0012`.
- [ ] No file modified outside `owns_paths` + the documented
      pre-authorized exceptions above.
- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint
      format:check test` is clean (zero warnings, zero errors).
- [ ] `data-pipeline/scripts/seed.ts` runs without crashing under
      `tsx`. The CLI prints the parsed options and exits non-zero
      cleanly when `DATABASE_URL` is unset (sandbox-safe smoke test).
- [ ] PR body contains a paste-able human smoke test for Pablo to run
      against the local Docker stack.

## Out of scope

- Adding an `ingest_run_log` / `data_conflict` / similar table — those
  are own-task territory (T-DL-DATA-CONFLICT-TABLE if/when raised).
- Persisting `DataConflict[]` to the database (the report holds them
  in memory only).
- Wiring filler adapters end-to-end at the card level (Bulbapedia
  category enumeration, Pokemon-Card.com pcjpSetId mapping). They
  remain available to the resolver if a caller hand-feeds inputs.
- `eBay listing parser` — shipped but out of scope for catalog
  ingestion (pricing-pipeline territory).
- Any change to adapter rate limits — they were elaborated by the
  source-task authors and we honor them as-is.
- Any change to the variant classifier or master-set engine logic.
- Real R2 wiring — only MinIO via `createLocalMinioClient`. Production
  R2 is plugged in via env vars (`S3_ENDPOINT_URL`, etc.) at run time;
  no new code path needed.
- Concurrency tuning for production scale — defaults are conservative;
  follow-up T-DL-INGEST-PERF can revisit once we've measured.

## Branch & PR

- Branch: `agent/T-DL-SEED-INGEST`
- PR title: `T-DL-SEED-INGEST: Initial bulk ingest job — adapters →
  resolver → DB → R2`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and append to `open-questions.md` (then continue with another
task or wait) if:

- A schema column we need to write to doesn't exist (e.g.
  `printing.include_in_master_set` was supposed to land but didn't).
- A canonical-key UNIQUE index is missing on a table we need to
  upsert to.
- The resolver's tier-merge logic produces unexpected output for a
  specific source pair (real bug; orchestrator-and-sub-agent loop
  required).
- The image pipeline's `printing_image` upsert pattern conflicts with
  the SEED-INGEST upsert pattern (e.g. SEED-INGEST writes `printing`
  THEN `printing_image`, but the FK requires the reverse).
- A `data_conflict` event needs to be persisted (T-DL-DATA-CONFLICT-TABLE
  territory; defer + log).
- We discover a need for a new migration of any kind.

## Notes from execution

_(empty until the sub-agent runs)_
