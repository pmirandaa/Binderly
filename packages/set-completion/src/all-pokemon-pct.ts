// Global All Pokémon % — "of all the numbered cards in the catalog,
// how many do I own ≥1 printing of?".
//
// Per `PROJECT.md § 8`:
//
// > **All Pokémon %** — counts unique numbered cards across all sets
// > the user has ≥1 printing of, divided by total numbered cards in
// > the database. (Pablo's spec: "if I have only the normal one of a
// > card in one set, count like ok, you have that card.")
//
// "Numbered cards" here means every row in the `card` table —
// Pokémon, Trainers, and Energies. Every card has a `number` per the
// schema (`card.number text NOT NULL`); none are excluded by
// definition. The metric's name ("All Pokémon") is colloquial — the
// canonical computation in `mv_user_global_completion` uses
// `unique_cards_owned` / `unique_cards_total`, which are card-level
// not species-level. Open question Q-008 raises the dispatch's
// "species" framing for ratification; this implementation matches
// PROJECT.md.
//
// Generation / set / subtype scoping is the caller's concern: the
// math operates on whatever `cards` and `printings` arrays are
// passed in. To compute "All Pokémon % for Sword & Shield-era cards
// only", filter `cards` and `printings` to that set list before
// calling. The denominator and numerator both contract together
// when the caller pre-filters, so the metric stays well-defined.
//
// Algorithm (O(P + C + I)):
//
//   1. Build `ownedSet = Set(ownedPrintingIds)`.
//   2. Walk `printings` once; for each owned printing, mark its
//      `cardId` in an `ownedCardIds` Set.
//   3. Count distinct `cardId`s in the `cards` array. We use a Set
//      here too in case the caller passes duplicate card rows
//      (defensive — the catalog has a unique constraint on
//      `card.canonical_key`, but the math should not crash if the
//      caller hands us a denormalized projection).

import { safePct, uniqueIds } from './internal-utils.js';

import type { AllPokemonPctResult, OwnedPrintingIds, RosterCard, RosterPrinting } from './types.js';

export interface ComputeAllPokemonPctInput {
  readonly cards: ReadonlyArray<RosterCard>;
  readonly printings: ReadonlyArray<RosterPrinting>;
  readonly ownedPrintingIds: OwnedPrintingIds;
}

/**
 * Compute All Pokémon %.
 *
 * Pure. Same input ⇒ same output.
 *
 * Edge cases:
 *   - Empty `cards` ⇒ `pct: 0`, `uniqueCardsTotal: 0`.
 *   - Empty `ownedPrintingIds` ⇒ `pct: 0`, `uniqueCardsOwned: 0`.
 *   - Owning multiple printings of the same card credits the card
 *     once.
 *   - Owning a card that is NOT in `cards` (e.g. user owned a
 *     printing whose card row was filtered out by the caller's
 *     scope) credits NOTHING — the numerator is `(owned card ids)
 *     ∩ (cards in scope)` so the metric stays well-defined under
 *     pre-filtering.
 *   - Duplicate `cardId`s in `cards` collapse via the Set.
 */
export function computeAllPokemonPct(input: ComputeAllPokemonPctInput): AllPokemonPctResult {
  const owned = uniqueIds(input.ownedPrintingIds);

  // Cards in scope (denominator universe).
  const inScopeCardIds = new Set<string>();
  for (const card of input.cards) {
    inScopeCardIds.add(card.cardId);
  }

  // Cards the user owns ≥1 printing of, intersected with the
  // in-scope set so the numerator can never exceed the denominator.
  const ownedCardIds = new Set<string>();
  for (const printing of input.printings) {
    if (!owned.has(printing.printingId)) continue;
    if (!inScopeCardIds.has(printing.cardId)) continue;
    ownedCardIds.add(printing.cardId);
  }

  const uniqueCardsTotal = inScopeCardIds.size;
  const uniqueCardsOwned = ownedCardIds.size;

  return {
    pct: safePct(uniqueCardsOwned, uniqueCardsTotal),
    uniqueCardsOwned,
    uniqueCardsTotal,
  };
}
