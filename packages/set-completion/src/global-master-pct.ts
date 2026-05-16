// Global Master % — "of all the master-set-included printings in
// the entire catalog, how many do I own?".
//
// Per `PROJECT.md § 8`:
//
// > **Master %** — sum of all master-set-included printings owned
// > divided by total master-set-included printings.
//
// This is the global counterpart to per-set Master Set %. Field
// names mirror `mv_user_global_completion`: `master_owned`,
// `master_total`, `master_pct`.
//
// Algorithm (O(P + I)):
//
//   1. Build `ownedSet = Set(ownedPrintingIds)`.
//   2. Walk `printings` once; for each printing whose
//      `includeInMasterSet === true`:
//        - increment `masterTotal`
//        - if `printingId` ∈ `ownedSet`, increment `masterOwned`.
//
// Cards are NOT consumed here — Master % is a per-printing metric.
// The caller scopes the catalog by pre-filtering `printings` (e.g.
// "Master % across all SV-era sets" → pass only those sets'
// printings).

import { safePct, uniqueIds } from './internal-utils.js';

import type { GlobalMasterPctResult, OwnedPrintingIds, RosterPrinting } from './types.js';

export interface ComputeGlobalMasterPctInput {
  readonly printings: ReadonlyArray<RosterPrinting>;
  readonly ownedPrintingIds: OwnedPrintingIds;
}

/**
 * Compute global Master %.
 *
 * Pure. Same input ⇒ same output.
 *
 * Edge cases:
 *   - Empty `printings` (or none with `includeInMasterSet === true`)
 *     ⇒ `pct: 0`, `masterTotal: 0`, `masterOwned: 0`.
 *   - Empty `ownedPrintingIds` ⇒ `pct: 0`, `masterOwned: 0`.
 *   - Owning a printing whose `includeInMasterSet === false`
 *     contributes nothing (it is outside the master).
 *   - Stale references ignored.
 *   - Duplicates collapse via Set.
 */
export function computeGlobalMasterPct(input: ComputeGlobalMasterPctInput): GlobalMasterPctResult {
  const owned = uniqueIds(input.ownedPrintingIds);

  let masterTotal = 0;
  let masterOwned = 0;

  for (const printing of input.printings) {
    if (!printing.includeInMasterSet) continue;
    masterTotal += 1;
    if (owned.has(printing.printingId)) {
      masterOwned += 1;
    }
  }

  return {
    pct: safePct(masterOwned, masterTotal),
    masterOwned,
    masterTotal,
  };
}
