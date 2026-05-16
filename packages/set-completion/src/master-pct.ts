// Per-set Master Set % — "do I own every printing the master-set
// rules engine flagged for this set?".
//
// Per `PROJECT.md § 8`:
//
// > **Master Set %** — owns every printing where
// > `include_in_master_set = true`.
//
// The boolean is a property of the `printing` row (see
// `packages/db/src/schema/printings.ts` and
// `data-pipeline/src/master-set/`); this package READS it and never
// re-derives it. Owning a printing whose `includeInMasterSet ===
// false` (e.g. a STAFF-stamped promo, a known ERROR printing)
// contributes neither to the numerator NOR the denominator — it is
// simply outside the master set.
//
// Algorithm:
//
//   1. Build `ownedSet = Set(ownedPrintingIds)` for O(1) membership.
//   2. Walk the `printings` roster once. For each printing whose
//      `setId` matches the target AND `includeInMasterSet === true`:
//        - increment `totalMaster`
//        - if `printingId` ∈ `ownedSet`, increment `ownedMaster`
//   3. `pct = (ownedMaster / totalMaster) * 100`, with the
//      0-denominator → 0 fallback in `safePct`.
//
// Master Set %, unlike Set %, is per-PRINTING. Owning the holo
// Charizard does not credit the user with the reverse holo
// Charizard.

import { safePct, uniqueIds } from './internal-utils.js';

import type { MasterSetPctResult, OwnedPrintingIds, RosterPrinting } from './types.js';

export interface ComputeMasterSetPctInput {
  readonly setId: string;
  readonly printings: ReadonlyArray<RosterPrinting>;
  readonly ownedPrintingIds: OwnedPrintingIds;
}

/**
 * Compute Master Set % for a single set.
 *
 * Pure. Same input ⇒ same output.
 *
 * Edge cases (verified by tests):
 *   - Empty printings (or no printings in `setId` flagged
 *     `includeInMasterSet = true`) ⇒ `pct: 0`, `totalMaster: 0`,
 *     `ownedMaster: 0`.
 *   - Empty ownedPrintingIds ⇒ `pct: 0`, `ownedMaster: 0`,
 *     `totalMaster` reflects the in-master count.
 *   - Owning a non-master printing of `setId` does NOT contribute.
 *   - Stale references (an owned `printingId` not in `printings`)
 *     are silently ignored.
 *   - Duplicate `printingId`s in `ownedPrintingIds` collapse via
 *     the Set dedup.
 */
export function computeMasterSetPct(input: ComputeMasterSetPctInput): MasterSetPctResult {
  const owned = uniqueIds(input.ownedPrintingIds);

  let totalMaster = 0;
  let ownedMaster = 0;

  for (const printing of input.printings) {
    if (printing.setId !== input.setId) continue;
    if (!printing.includeInMasterSet) continue;
    totalMaster += 1;
    if (owned.has(printing.printingId)) {
      ownedMaster += 1;
    }
  }

  return {
    setId: input.setId,
    pct: safePct(ownedMaster, totalMaster),
    ownedMaster,
    totalMaster,
  };
}
