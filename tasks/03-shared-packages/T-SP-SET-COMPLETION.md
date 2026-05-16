# T-SP-SET-COMPLETION — Set completion math package (Set %, Master %, All Pokémon %)

**Stage:** 03-shared-packages
**Agent role:** backend
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-BE-API-CONTRACTS (merged) — provides `printingDto` / `cardDto` /
  `setDto` / `collectionItemDto` and the variant-class enum.
- T-DL-MASTER-SET-RULES (merged) — materializes
  `printing.include_in_master_set`, the boolean this package sums.

## Soft dependencies

- T-BE-EDGE-FUNCTIONS (in flight, sibling) — the
  `recompute-set-completion` worker imports this package in a later
  iter; keep the public surface clean.

## Required reading

- `PROJECT.md` § 8 (Master Set Definition) — the canonical formulas:
  - **Set %** = "owns ≥1 printing of each numbered card. Variant-agnostic; a reverse holo Charizard alone counts as having Charizard." (per-card)
  - **Master Set %** = "owns every printing where `include_in_master_set = true`" (per-printing within a set)
  - **All Pokémon %** = "counts unique numbered cards across all sets the user has ≥1 printing of, divided by total numbered cards in the database" (per-card, global)
  - **Master %** (global) = "sum of all master-set-included printings owned divided by total master-set-included printings"
- `context/data-model.md` § Materialized views — pins the wire
  field names and ranges (`set_pct numeric(5,2)` 0..100,
  `master_pct numeric(5,2)`, `owned_numbered`, `total_numbered`,
  `owned_master`, `total_master`, `all_pokemon_pct`,
  `unique_cards_owned`, `unique_cards_total`, `master_owned`,
  `master_total`).
- `context/tcg-domain.md` § 2 (Master Set Edge Cases) — for
  rationale on which printings the master-set rules engine
  includes / excludes.
- `rules/03-shared-packages.md` — pure-logic constraints (no IO,
  no platform-specific imports, tree-shakable, ≥90% covered).
- `data-pipeline/src/master-set/` — for context on how
  `include_in_master_set` is derived. This package READS the
  materialized boolean; it does not re-run the engine.
- `packages/api-contracts/src/{cards.ts,collection.ts,common.ts}` —
  DTO shapes.
- `packages/db/src/schema/{cards.ts,printings.ts,sets.ts,collections.ts}` —
  table shapes feeding the math.

## Goal

A pure-logic shared package — `@binderly/set-completion` — that
turns a printing roster + a card roster + a user's owned-printing
list into the four canonical completion percentages used across
the product (per-set Set % / Master Set %, global All Pokémon % /
Master %). No IO, no DB, no HTTP — same input, same output, every
time. Safe to call from the edge-function recompute worker
(server-side) and from the web/mobile clients (optimistic local
recompute after a mutation) alike.

## Deliverables

- `packages/set-completion/package.json` — `@binderly/set-completion`
  workspace package, mirrors the layout of `@binderly/api-contracts` /
  `@binderly/auth` (`main` / `types` / `exports` pointing at
  `dist/src/index.{js,d.ts}`; vitest + eslint + tsconfig as devDeps;
  zero runtime deps).
- `packages/set-completion/tsconfig.json` — extends
  `@binderly/tsconfig/library.json`.
- `packages/set-completion/eslint.config.mjs` — extends
  `@binderly/eslint-config/node`.
- `packages/set-completion/vitest.config.ts` — node env, coverage
  via v8.
- `packages/set-completion/.prettierignore`.
- `packages/set-completion/README.md` — public usage doc + module
  map + decision log.
- `packages/set-completion/src/types.ts` — input DTOs
  (`RosterPrinting`, `RosterCard`, `OwnedPrintingId`) and result
  DTOs (`SetCompletionResult`, `AllPokemonCompletionResult`,
  `GlobalMasterCompletionResult`, `ComputeCompletionResult`). Field
  names mirror `mv_user_set_completion` / `mv_user_global_completion`
  per `context/data-model.md`.
- `packages/set-completion/src/set-pct.ts` — `computeSetPct(input)`.
  Per-set, per-card. Ratio of distinct cards in the set the user
  owns ≥1 printing of, over total cards in the set. Returns
  `{ pct, ownedNumbered, totalNumbered }`.
- `packages/set-completion/src/master-pct.ts` —
  `computeMasterSetPct(input)`. Per-set, per-printing, gated to
  `includeInMasterSet === true`. Returns `{ pct, ownedMaster,
  totalMaster }`.
- `packages/set-completion/src/all-pokemon-pct.ts` —
  `computeAllPokemonPct(input)`. Global, per-card. Distinct cards
  in the (caller-supplied, optionally pre-filtered) catalog the user
  owns ≥1 printing of, over total cards in the catalog. Generation
  / set / subtype scoping is the caller's concern — pre-filter the
  `cards` and `printings` arrays before passing them in. Returns
  `{ pct, uniqueCardsOwned, uniqueCardsTotal }`.
- `packages/set-completion/src/global-master-pct.ts` —
  `computeGlobalMasterPct(input)`. Global, per-printing, gated to
  `includeInMasterSet === true`. Returns `{ pct, masterOwned,
  masterTotal }`.
- `packages/set-completion/src/aggregate.ts` —
  `computeCompletion(input)`. Top-level orchestrator: indexes the
  roster once, computes Set % + Master Set % per set requested
  (`input.sets` may pin a subset, otherwise every set in the
  printing roster), and `computeAllPokemonPct` +
  `computeGlobalMasterPct` over the whole catalog. Returns a
  single result object the edge-function recompute worker can
  consume directly.
- `packages/set-completion/src/index.ts` — barrel.
- `packages/set-completion/src/*.test.ts` — vitest suites
  covering the acceptance criteria below.

## Acceptance criteria

- [ ] Package builds clean (`pnpm --filter @binderly/set-completion build`).
- [ ] Public API: `computeSetPct`, `computeMasterSetPct`,
      `computeAllPokemonPct`, `computeGlobalMasterPct`,
      `computeCompletion`, plus the input/output type exports.
- [ ] Empty collection ⇒ every percentage is `0` (NOT `NaN`); empty
      catalog ⇒ percentage is `0`, `total*` fields are `0`.
- [ ] Full collection (owns every printing in the roster) ⇒ every
      percentage is `100`.
- [ ] Set % is variant-agnostic per `PROJECT.md § 8`: owning ANY
      printing of a card credits that card. Reverse-holo-only
      ownership of a card credits the card toward Set %.
- [ ] Master Set % strictly counts only printings with
      `includeInMasterSet === true`. Owning a printing that is
      `false` does not contribute to Master Set % numerator OR
      denominator.
- [ ] When the user owns only base-set (`HOLO`/`NON_HOLO`)
      printings of every card and the set has additional
      master-set-included variants, `setPct === 100` while
      `masterPct < 100`. (Master ≥ Set never universally — the
      relationship depends on the variant mix; the test asserts
      the specific case from `PROJECT.md § 8`.)
- [ ] All Pokémon % is independent of variant ownership — owning
      any single printing of a card credits the card. Owning N
      printings of the same card does not double-count.
- [ ] All Pokémon % respects caller-supplied catalog filtering:
      passing only Pokémon-subtype cards (or only Sword & Shield
      sets) correctly scopes the denominator AND numerator.
- [ ] Global Master % aggregates across every set in the input
      printing roster — not per-set; ratio of distinct
      master-set-included printings owned over total
      master-set-included printings.
- [ ] Owned printings that don't appear in the roster are silently
      ignored (a stale `collection_item` row pointing at a deleted
      printing must not crash the math).
- [ ] Owned `printingId` duplicates collapse: the function takes
      a list of printing ids; duplicates are deduped before the
      math runs.
- [ ] Idempotency / determinism: calling any compute function
      twice on the same input returns deeply-equal results
      (verified via `expect(a).toEqual(b)`); no `Date.now()`,
      `Math.random()`, or globals used internally.
- [ ] Performance: a 5,000-item collection vs a 30,000-printing
      catalog completes `computeCompletion` in well under
      `< 500ms` wall-clock steady-state median on shared CI
      runners (and `< 100ms` on dev hardware). Measured with
      `performance.now()` and asserted at the CI-tolerant 500ms
      threshold per the precedent set by
      `data-pipeline/src/parsers/ebay-listing/passes/*.test.ts`;
      fail loud if regressed (catches accidental O(n²)).
- [ ] Algorithmic complexity: O(P + C + I) where P = printings,
      C = cards, I = collection items. No O(n²) scans.
- [ ] Tests live at `packages/set-completion/src/**/*.test.ts`
      and pass under `pnpm --filter @binderly/set-completion test`.
      Total test count between 80 and 150 inclusive.
- [ ] Lint clean (`pnpm --filter @binderly/set-completion lint`).
- [ ] Typecheck clean (`pnpm --filter @binderly/set-completion typecheck`).
- [ ] Format:check clean (`pnpm --filter @binderly/set-completion format:check`).
- [ ] No edits outside the authorized list (see "Branch & PR"
      below).

## Out of scope

- Materialized-view refresh / SQL — owned by T-BE-EDGE-FUNCTIONS.
- Master-set rules ENGINE (deciding which printings get
  `include_in_master_set === true`) — already shipped in
  `data-pipeline/src/master-set/`. This package READS the boolean;
  it does not re-derive it.
- Pricing-aware completion (e.g. "what % by value"). Non-goal v1.
- Adding a `setCompletionResult` zod schema to `@binderly/api-contracts`.
  The result types live here in v1 (see Notes from execution
  for the per-cycle handoff plan). If T-BE-EDGE-FUNCTIONS needs a
  zod parser at the wire boundary, that's an api-contracts edit
  in a later iter.
- Generation-as-an-enum: callers pre-filter the input arrays; this
  package doesn't ship a `generation` table.

## Branch & PR

- Branch: `agent/T-SP-SET-COMPLETION`
- PR title: `T-SP-SET-COMPLETION: Set completion math package (Set %, Master %, All Pokémon %)`
- Commit format: Conventional Commits.
- **Authorized out-of-`owns_paths` edits** (mention each in the PR body):
  - `pnpm-lock.yaml` (new workspace package).
  - `dependencies.yaml` (status flip pending → review, stub: false).
  - `tasks/03-shared-packages/T-SP-SET-COMPLETION.md` (this elaboration).
  - `open-questions.md` (escalation notes — append-only).

## Escalation triggers

Stop and surface to the orchestrator if:

- The "All Pokémon %" definition diverges between the dispatch
  brief and `PROJECT.md § 8` (dispatch says "Pokémon species",
  spec says "unique numbered cards"). Recommend per-card per
  spec; flag for ratification.
- The performance budget is unmeetable with a linear-scan
  algorithm at the documented scale (5,000 items × 30,000
  printings).
- A required result-shape addition to `@binderly/api-contracts`
  cannot be substituted with package-local types.
- The `printing.includeInMasterSet` boolean does not in fact
  match the seed pipeline output (would indicate a regression in
  T-DL-MASTER-SET-RULES, not this task).

## Notes from execution
_(Sub-agent appends here at end. Empty until then.)_
