# T-SP-SET-COMPLETION — Set completion math package (Set %, Master %, All Pokémon %)

**Stage:** 03-shared-packages
**Agent role:** backend
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-BE-API-CONTRACTS (merged) — DTO shapes for cards / printings / collection
- T-DL-MASTER-SET-RULES (merged) — `printing.include_in_master_set` is the
  materialized boolean we read; the per-set rules engine is the upstream
  source of truth (see `data-pipeline/src/master-set/`)

## Soft dependencies

- T-SP-SMART-DSL, T-SP-UI-TOKENS — parallel-safe; no shared paths

## Required reading

- `PROJECT.md` § 8 (Master Set Definition) — the canonical metric definitions
- `context/tcg-domain.md` § 2 (Master Set rules), § 5 (canonical keys)
- `context/data-model.md` § "completion" (the materialized-view shapes the
  edge-functions worker recomputes; our output mirrors them)
- `context/glossary.md` § "Collection completion terms"
- `rules/03-shared-packages.md`
- `data-pipeline/src/master-set/README.md`

## Goal

Pure-logic shared package that computes Binderly's four completion
percentages from a printing roster + a user's collection. The package is
runtime-agnostic (Node, browser, React Native, edge) and has no I/O — the
edge-functions recompute worker (T-BE-EDGE-FUNCTIONS) feeds it data from
the catalog tables and writes the result to materialized views, while the
clients call the same functions for optimistic local recompute after a
mutation.

## Deliverables

- `packages/set-completion/package.json` — workspace package mirroring the
  `@binderly/api-contracts` layout (main / types / exports / scripts).
- `packages/set-completion/tsconfig.json` — extends `@binderly/tsconfig/library.json`.
- `packages/set-completion/eslint.config.js` — node preset, dist/coverage ignored.
- `packages/set-completion/vitest.config.ts` — node env, src/\*\*/\*.test.ts.
- `packages/set-completion/README.md` — package overview + usage.
- `packages/set-completion/src/types.ts` — input DTOs (printing roster +
  collection) and output DTOs (`SetCompletionStats`, `GlobalCompletionStats`,
  `CompletionResult`), reusing `@binderly/api-contracts` primitives.
- `packages/set-completion/src/set-pct.ts` — per-set `computeSetCompletion`:
  variant-agnostic count of distinct cards owned in the set divided by
  total cards in the set (per PROJECT.md § 8).
- `packages/set-completion/src/master-pct.ts` — per-set
  `computeMasterCompletion`: count of distinct master-included printings
  owned divided by total master-included printings.
- `packages/set-completion/src/all-pokemon-pct.ts` —
  `computeAllPokemonCompletion`: distinct cards owned (catalog or scoped)
  divided by total cards in scope, plus the global Master %.
- `packages/set-completion/src/aggregate.ts` — top-level `computeCompletion`
  that orchestrates per-set + global metrics in a single pass and returns
  the unified result.
- `packages/set-completion/src/index.ts` — public barrel.
- Tests live next to each module as `*.test.ts`.
- `pnpm-lock.yaml` — refreshed by `pnpm install`.
- `dependencies.yaml` — status flip pending → review, stub: false.

## Acceptance criteria

- [ ] Package builds, lints, typechecks, tests under
      `pnpm --filter @binderly/set-completion <task>` and the workspace
      `pnpm -w <task>` aggregations.
- [ ] `computeSetCompletion` is variant-agnostic per PROJECT.md § 8
      ("a reverse holo Charizard alone counts as having Charizard").
- [ ] `computeMasterCompletion` only counts printings whose
      `includeInMasterSet === true`, matching the materialized boolean
      written by the master-set rules engine.
- [ ] `computeAllPokemonCompletion` counts unique cards (per
      `card.canonical_key`) globally; Charizard from Base + Charizard from
      Hidden Fates count as 2 (per glossary § "All Pokémon %").
- [ ] `computeAllPokemonCompletion` accepts an optional scope filter
      (set ids / languages / series) that restricts BOTH numerator and
      denominator.
- [ ] All functions are pure: no `Date.now()`, no randomness, no async, no
      I/O. Same input → identical output (idempotency test asserts
      structural equality across two runs).
- [ ] Empty collection → every percentage is `0`. Empty roster →
      percentage is `0` (denominator-zero guard). 100% ownership → every
      percentage is `100`.
- [ ] Master Set % ≥ Set % is NOT a universal invariant (master counts
      printings, set counts cards) — but a property test asserts that
      when the user owns only base printings, master % ≤ set % numerically
      because master adds variants that aren't owned. Asserted as the
      narrower property: `setOwned ≥ ceil(masterOwned / printingsPerCard)`
      doesn't hold either; the spec really only constrains both into
      `[0, 100]` independently.
- [ ] Performance: `computeCompletion` for a 5,000-item collection over a
      30,000-printing / 15,000-card / 200-set roster completes in
      < 100ms wall-clock on the CI runner (asserted in a vitest test).
- [ ] Output shape integrates cleanly with the
      `recompute-set-completion` edge-function worker stub
      (T-BE-EDGE-FUNCTIONS); the package surface is documented in the
      README and the result type is exported from `index.ts`.
- [ ] No edits outside `owns_paths` except the pre-authorized list
      (`pnpm-lock.yaml`, `dependencies.yaml`, this task file).

## Out of scope

- DB reads, HTTP, edge-function wiring (owned by T-BE-EDGE-FUNCTIONS).
- The `mv_user_set_completion` / `mv_user_global_completion` materialized
  views themselves (DDL is owned by an earlier data-layer task; this
  package returns shapes the worker can write into them).
- Per-user master-set overrides ("I want errors in my master") — deferred
  per `tcg-domain.md` § 3.
- Pricing / portfolio value math — separate package family.
- Adding a new completion-result schema to `@binderly/api-contracts` — if
  needed, escalate via `open-questions.md`. The package re-exports its
  own types for now.

## Branch & PR

- Branch: `agent/T-SP-SET-COMPLETION`
- PR title: `T-SP-SET-COMPLETION: Set completion math package (Set %, Master %, All Pokémon %)`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- A required completion DTO needs to live in `@binderly/api-contracts`
  rather than this package (composition over the existing types isn't
  enough).
- Performance budget is unmeetable without a sub-quadratic algorithm
  change that needs ratification.
- The per-set "Set %" definition turns out to need to count secret rares
  separately (PROJECT.md § 8 currently says "every numbered card", which
  this task interprets as every `card` row — secret rares are cards too).
- The master-set engine's `includeInMasterSet` boolean turns out not to
  fully enumerate the variant categories (e.g., per-user overrides leak
  into v1).

## Notes from execution

_(Sub-agent appends here at end. Empty until then.)_
