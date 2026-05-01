# T-DL-SOURCE-INTERFACES — Source adapter interfaces and resolver

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M
**Status:** pending

## Hard dependencies
- T-DL-SCHEMA-CARDS

## Soft dependencies
- T-DL-SCHEMA-COLLECTIONS, T-DL-SCHEMA-GRADING, T-DL-SCHEMA-PRICING
  (parallel-safe)

## Required reading
- PROJECT.md § 7 (Data Sources & Standardization)
- rules/01-data-layer.md
- context/tcg-domain.md (entire file)
- context/data-model.md (catalog tables)
- context/legal-and-brand.md (Data source ToS)

## Goal
Define the TypeScript interfaces every source adapter implements, build
the resolver that combines primary/validation/filler sources into a
single canonical record, and provide the rate-limited HTTP client all
adapters use. This task is the foundation that all subsequent source
adapter tasks depend on.

## Deliverables

- `data-pipeline/package.json` — name `@binderly/data-pipeline`,
  TypeScript, deps on `zod`, `@binderly/db`, `pino` for logs,
  `bottleneck` (or similar) for rate limiting.
- `data-pipeline/tsconfig.json` — extends `@binderly/tsconfig/node`.
- `data-pipeline/src/types.ts` — shared types:
  - `RawSet`, `RawCard`, `RawPrinting` — what adapters emit (lowest
    common denominator across sources).
  - `CanonicalSet`, `CanonicalCard`, `CanonicalPrinting` — fully
    normalized, ready to write to DB. Uses the enums from
    `context/tcg-domain.md`.
  - `SourceAdapter` interface:
    ```ts
    interface SourceAdapter {
      readonly name: string;
      readonly language: 'en' | 'jp';
      readonly tier: 'primary' | 'validation' | 'filler';
      listSets(): Promise<RawSet[]>;
      listCardsForSet(setKey: string): Promise<RawCard[]>;
      listPrintingsForCard(cardKey: string): Promise<RawPrinting[]>;
    }
    ```
- `data-pipeline/src/interfaces/adapter.ts` — the `SourceAdapter`
  interface and helper types.
- `data-pipeline/src/http/rate-limited-client.ts` — wrapper around
  `fetch` with per-host rate limits, retries with exponential backoff,
  contactable User-Agent (configurable per adapter), and a hook to
  bypass for tests.
- `data-pipeline/src/resolver/resolver.ts` — given an array of
  `SourceAdapter`s, produces the canonical merged data:
  - Pull primary first.
  - For each field that has a validation source, compare; on
    significant disagreement (defined per field — string equality for
    most, percentage diff for numerics), record a `data_conflict`.
  - Filler sources contribute only fields the primary lacks.
  - Output: `{ canonical: CanonicalSet/Card/Printing, conflicts:
    DataConflict[] }`.
- `data-pipeline/src/variant-classify.ts` — the variant decision tree
  from `context/tcg-domain.md` § 8. Pure function: takes a `RawPrinting`
  + parent `RawCard` + `RawSet` and returns `{ variant_class,
  variant_flags, variant_code, include_in_master_set_default }`.
- `data-pipeline/src/normalize/` — normalization utilities:
  - `rarity.ts` — per-source mapping registry; `normalizeRarity(source,
    rawRarity)`.
  - `type.ts` — Pokémon type normalization.
  - `language.ts`, `set-code.ts`.
- `data-pipeline/src/canonical-keys.ts` — pure functions for
  `canonicalSetKey`, `canonicalCardKey`, `printingVariantKey` per
  `context/tcg-domain.md` § 5.
- Tests for each module, especially `variant-classify.ts` (every edge
  case in tcg-domain § 3 covered).

## Acceptance criteria

- [ ] Interfaces compile and are documented with JSDoc.
- [ ] The rate-limited HTTP client is tested with msw or nock against
      a mock host, including 429 retry and User-Agent assertion.
- [ ] The resolver merges three mock adapters correctly, including
      conflict surfacing.
- [ ] `variant-classify.ts` correctly classifies every test case in
      `context/tcg-domain.md` § 3 (Base Set shadowless, Trainer
      Gallery, etc.).
- [ ] Canonical key helpers produce the documented output exactly.
- [ ] `pnpm test --filter @binderly/data-pipeline` passes.
- [ ] No file modified outside `data-pipeline/`.

## Out of scope

- Any concrete adapter — those are separate tasks
  (T-DL-SOURCE-TCGDEX-EN etc.).
- Image downloads — T-DL-IMAGE-PIPELINE.
- Master-set rules engine — T-DL-MASTER-SET-RULES (uses the variant
  classifier output as input).
- Writing to the DB — that lives in the seed ingest task
  (T-DL-SEED-INGEST).

## Branch & PR

- Branch: `agent/T-DL-SOURCE-INTERFACES`
- PR title: `T-DL-SOURCE-INTERFACES: Adapter interfaces and resolver`

## Escalation triggers

- The decision tree from `context/tcg-domain.md` § 8 is incomplete for
  a real edge case discovered during test writing. Update the context
  file in the same PR (it's allowed because the tree is owned here).
- A field merge strategy in the resolver doesn't have a clear
  primary-wins rule — flag and pick a default in the same PR.

## Notes from execution
_(empty)_
