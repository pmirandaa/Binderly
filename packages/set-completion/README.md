# `@binderly/set-completion`

Pure-logic set completion math for Binderly: **Set %**, **Master Set %**, **All Pokémon %**, and global **Master %**. No IO, no DB, no HTTP — same input, same output, every time. Safe to call from the edge-function recompute worker (server-side) and from the web/mobile clients (optimistic local recompute after a mutation) alike.

## What this package is

- **The single source of truth for the four canonical completion percentages.**
  Output field names mirror `mv_user_set_completion` and `mv_user_global_completion` per `context/data-model.md` § "Materialized views" — the recompute job's `INSERT` shape is a structural pass-through.
- **A pure-logic boundary** between the catalog roster (`card`, `printing`, `set` tables) and a user's collection (`collection_item.printing_id`). Both halves flow in as plain arrays of structurally-narrow records.
- **Tree-shakable.** Each metric exports its own function; the `computeCompletion` orchestrator is opt-in.

## What this package is NOT

- **Not the master-set rules engine.** Deciding which printings get `include_in_master_set === true` is owned by `data-pipeline/src/master-set/`. This package READS the materialized boolean.
- **Not a fetch/IO/DB layer.** Callers project from their existing DTO caches and pass arrays in.
- **Not a presentation layer.** Percentages are returned as plain `number` in the 0..100 range; rounding to `numeric(5,2)` happens at the recompute job's `INSERT` boundary.

## Module map

| File                       | Public surface                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`             | `RosterCard`, `RosterPrinting`, `OwnedPrintingIds`, `SetPctResult`, `MasterSetPctResult`, `SetCompletionResult`, `AllPokemonPctResult`, `GlobalMasterPctResult`, `GlobalCompletionResult`, `ComputeCompletionInput`, `ComputeCompletionResult`. |
| `src/set-pct.ts`           | `computeSetPct(input)` — per-set Set % (per-card, variant-agnostic).                                                                                                                                                                            |
| `src/master-pct.ts`        | `computeMasterSetPct(input)` — per-set Master Set % (per-printing, gated on `includeInMasterSet === true`).                                                                                                                                     |
| `src/all-pokemon-pct.ts`   | `computeAllPokemonPct(input)` — global per-card "you own ≥1 printing" tally. Caller pre-filters for generation/set/subtype scoping.                                                                                                             |
| `src/global-master-pct.ts` | `computeGlobalMasterPct(input)` — global per-printing master tally.                                                                                                                                                                             |
| `src/aggregate.ts`         | `computeCompletion(input)` — the orchestrator. Indexes the roster once and returns per-set + global in one pass.                                                                                                                                |
| `src/index.ts`             | Public barrel — every external import goes through here.                                                                                                                                                                                        |

## Usage

```ts
import { computeCompletion, type ComputeCompletionInput } from '@binderly/set-completion';

const input: ComputeCompletionInput = {
  cards: cardRoster, // RosterCard[]
  printings: printingRoster, // RosterPrinting[]
  ownedPrintingIds: collection.map((it) => it.printingId),
  // Optional: pin the per-set output to specific sets.
  // sets: ['set:brilliant-stars'],
};

const { perSet, global } = computeCompletion(input);

// Per-set result row matches `mv_user_set_completion` (minus
// user_id / last_updated):
//   { setId, setPct, masterPct, ownedNumbered, totalNumbered,
//     ownedMaster, totalMaster }

// Global result matches `mv_user_global_completion`:
//   { allPokemonPct, masterPct, uniqueCardsOwned,
//     uniqueCardsTotal, masterOwned, masterTotal }
```

For a single-set recompute (e.g. the optimistic-update path after the user adds one card), call the per-metric functions directly to skip the global tally:

```ts
import { computeSetPct, computeMasterSetPct } from '@binderly/set-completion';

const setPct = computeSetPct({ setId, cards, printings, ownedPrintingIds });
const masterPct = computeMasterSetPct({ setId, printings, ownedPrintingIds });
```

## The four metrics, defined

Per `PROJECT.md § 8 (Master Set Definition)`:

- **Set %** — _per-card, per-set._ Distinct cards in the set the user owns ≥1 printing of, over total cards in the set. Variant-agnostic: a reverse-holo-only Charizard credits Charizard.
- **Master Set %** — _per-printing, per-set, gated on `includeInMasterSet === true`._ Distinct master-set-included printings owned in the set, over total master-set-included printings in the set. Owning a non-master printing (e.g. STAFF promo) contributes to neither numerator nor denominator.
- **All Pokémon %** — _per-card, global._ Distinct cards in the (caller-supplied, optionally pre-filtered) catalog the user owns ≥1 printing of, over total cards in the catalog. Per Pablo's spec: "if I have only the normal one of a card in one set, count like ok, you have that card." Generation / set / subtype scoping is the caller's concern — pre-filter `cards` and `printings` before calling.
- **Master %** (global) — _per-printing, global._ Sum of master-set-included printings owned across the catalog over total master-set-included printings.

## Edge cases (contract)

- **Empty denominator ⇒ percentage is `0`** (NOT `NaN`). The materialized views the recompute job writes use `numeric(5,2)`; `INSERT … NaN` would fail. Same posture in both directions: 0 cards in scope, 0 master printings in set, 0 ownership entries — every metric returns 0.
- **Stale references** (an owned `printingId` that doesn't appear in the printing roster) are silently ignored. The math doesn't crash on a deleted printing.
- **Duplicate `printingId`s** in `ownedPrintingIds` collapse — owning two copies of the same printing does not double-count.
- **Output ordering** for `computeCompletion`:
  - If `input.sets` is provided, `perSet` is in the same order. Set ids not in the roster yield zero-result entries (the recompute job uses this to "explicitly zero this set" without reaching into the math).
  - If `input.sets` is omitted, `perSet` is in first-seen order from `printings` — deterministic for a given input.

## Performance

`computeCompletion` is O(P + C + I) where P = printings, C = cards, I = collection items. The aggregate path indexes the roster once and applies all four metrics off the same index — no O(n²) scans.

The acceptance-criterion benchmark (5,000-item collection vs 30,000-printing catalog) runs steady-state at ~10-15ms on dev hardware (Apple M1 / M2). The CI assertion is set at 500ms to absorb GitHub Actions runner variance; see the block comment atop `src/aggregate.test.ts` § "performance" for the full rationale.

## Decisions log

- **Result types live here, not in `@binderly/api-contracts`.** v1 of the recompute worker imports directly. If a wire-level zod schema is needed at the edge-function boundary, it's added to api-contracts in a later iter — this package keeps zero runtime deps in the meantime.
- **No internal `zod` validation.** The package trusts its inputs structurally — the wire-boundary validation is the caller's job (the edge function uses api-contracts schemas; the client uses the same shapes by inference).
- **All Pokémon % is per-card (not per-species).** Aligned with `PROJECT.md § 8` ("counts unique numbered cards … in the database") and the `mv_user_global_completion.unique_cards_owned` column. The dispatch brief's "Pokémon species" framing was raised in `open-questions.md` for ratification; this implementation matches the spec.
- **Generation filter is caller-supplied.** The package operates on whatever `cards` / `printings` are passed in; numerator and denominator both contract together when the caller pre-filters.
