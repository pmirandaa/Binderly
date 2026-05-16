// Per-set Set % — the "do I have one printing of every numbered card
// in this set?" metric, variant-agnostic per `PROJECT.md § 8`.
//
// > **Set %** — owns ≥1 printing of each numbered card.
// > Variant-agnostic; a reverse holo Charizard alone counts as having
// > Charizard.
//
// Algorithm (all O(P + C + I) where P = printings, C = cards in the
// set, I = ownedPrintingIds):
//
//   1. Build `ownedSet = Set(ownedPrintingIds)` for O(1) membership.
//   2. Walk the `printings` roster once. For each printing whose
//      `setId` matches the target set, if its `printingId` is in
//      `ownedSet`, mark its `cardId` as "owned in this set".
//   3. Count distinct `cardId`s in the target set (denominator) and
//      the size of the "owned card ids" set (numerator).
//
// We deliberately do NOT scan the full `cards` array twice — the
// printings roster carries `setId`, so the printings scan does
// double duty. The `cards` array is iterated only to count the
// per-set total. (For the aggregate path that computes many sets at
// once, we share a precomputed per-set card count Map; see
// `aggregate.ts`.)

import { safePct, uniqueIds } from './internal-utils.js';

import type { OwnedPrintingIds, RosterCard, RosterPrinting, SetPctResult } from './types.js';

export interface ComputeSetPctInput {
  /**
   * The set whose Set % to compute. The function filters the input
   * arrays internally — callers can pass the full catalog or a
   * pre-narrowed slice; the result is the same.
   */
  readonly setId: string;
  readonly cards: ReadonlyArray<RosterCard>;
  readonly printings: ReadonlyArray<RosterPrinting>;
  readonly ownedPrintingIds: OwnedPrintingIds;
}

/**
 * Compute Set % for a single set.
 *
 * Pure function. No IO, no globals, no `Date.now()`. Same input ⇒
 * same output, always.
 *
 * Edge cases (verified by tests):
 *   - Empty `cards` (or no cards in `setId`) ⇒ `pct: 0`,
 *     `totalNumbered: 0`, `ownedNumbered: 0`.
 *   - Empty `ownedPrintingIds` ⇒ `pct: 0`, `ownedNumbered: 0`,
 *     `totalNumbered` reflects the set's card count.
 *   - Owned printings whose `printingId` is NOT in `printings`
 *     (stale references) are silently ignored.
 *   - Duplicates in `ownedPrintingIds` collapse — owning two copies
 *     of the same printing does not double-count.
 */
export function computeSetPct(input: ComputeSetPctInput): SetPctResult {
  const owned = uniqueIds(input.ownedPrintingIds);

  // Numerator: distinct card ids (in `setId`) the user owns ≥1
  // printing of. Denominator: total cards in `setId`.
  const ownedCardIds = new Set<string>();
  for (const printing of input.printings) {
    if (printing.setId !== input.setId) continue;
    if (owned.has(printing.printingId)) {
      ownedCardIds.add(printing.cardId);
    }
  }

  let totalNumbered = 0;
  for (const card of input.cards) {
    if (card.setId === input.setId) totalNumbered += 1;
  }

  const ownedNumbered = ownedCardIds.size;
  return {
    setId: input.setId,
    pct: safePct(ownedNumbered, totalNumbered),
    ownedNumbered,
    totalNumbered,
  };
}
