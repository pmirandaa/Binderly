// `computeCompletion` — the top-level orchestrator. Takes a single
// catalog roster + a single owned-printing list and returns
// per-set + global completion in one pass.
//
// Why this exists separately from the per-metric functions: the
// edge-function recompute worker (T-BE-EDGE-FUNCTIONS) wants ONE
// call that returns everything it needs to write
// `mv_user_set_completion` and `mv_user_global_completion` rows. The
// per-metric functions are kept individually exported for callers
// that need surgical recomputation (e.g. the web app's optimistic
// "I just added a card from set X — re-bump only that set's
// progress bar" flow).
//
// Performance posture: a naïve loop calling `computeSetPct` and
// `computeMasterSetPct` per set would re-scan `printings` and
// `cards` for every set — O(S × (P + C)) where S = number of sets.
// At catalog scale (~100 sets × ~30k printings), that's 3M ops per
// call; not catastrophic but wasteful. The aggregate path indexes
// the roster ONCE into per-set buckets, then applies the math
// per-bucket — O(P + C + I + S × bucket_size) which collapses to
// O(P + C + I).
//
// This routine is the perf-critical hot path; the < 100ms target at
// 5,000 items × 30,000 printings depends on it.

import { computeAllPokemonPct } from './all-pokemon-pct.js';
import { computeGlobalMasterPct } from './global-master-pct.js';
import { safePct, uniqueIds } from './internal-utils.js';

import type {
  ComputeCompletionInput,
  ComputeCompletionResult,
  RosterCard,
  RosterPrinting,
  SetCompletionResult,
} from './types.js';

interface SetBuckets {
  /** Distinct card ids in the set the user owns ≥1 printing of. */
  readonly ownedCardIds: Set<string>;
  /** Total cards in the set (denominator for Set %). */
  totalNumbered: number;
  /** Total master-set-included printings in the set. */
  totalMaster: number;
  /** Owned master-set-included printings in the set. */
  ownedMaster: number;
}

function makeEmptyBuckets(): SetBuckets {
  return {
    ownedCardIds: new Set<string>(),
    totalNumbered: 0,
    totalMaster: 0,
    ownedMaster: 0,
  };
}

/**
 * `computeCompletion` — orchestrator entry point.
 *
 * Pure. Same input ⇒ same output. No globals, no `Date.now()`, no
 * randomness.
 *
 * Behaviour:
 *   - If `input.sets` is omitted, the result has one `perSet` entry
 *     for each distinct `setId` present in `input.printings` (in
 *     first-seen order).
 *   - If `input.sets` is provided, the result has one `perSet`
 *     entry per supplied id, in the SAME order. Set ids that aren't
 *     in the roster yield a zero-result entry (`pct: 0`,
 *     `total*: 0`, `owned*: 0`) — the recompute job uses this to
 *     "explicitly zero this set" without reaching into the math.
 *
 * Complexity: O(P + C + I + S) where S = number of sets in
 * `perSet` output. No O(n²) scans.
 */
export function computeCompletion(input: ComputeCompletionInput): ComputeCompletionResult {
  const owned = uniqueIds(input.ownedPrintingIds);

  // Index: setId → bucket. Created lazily so we can also remember
  // the FIRST-SEEN order of sets for the default-when-`sets`-omitted
  // output ordering.
  const buckets = new Map<string, SetBuckets>();
  const firstSeenOrder: string[] = [];

  // Single-pass over `printings`: tally per-set master totals,
  // per-set master owned, AND build the per-set "owned card ids"
  // set used for Set %.
  for (const printing of input.printings) {
    const bucket = ensureBucket(buckets, firstSeenOrder, printing.setId);
    if (printing.includeInMasterSet) {
      bucket.totalMaster += 1;
    }
    const isOwned = owned.has(printing.printingId);
    if (isOwned) {
      bucket.ownedCardIds.add(printing.cardId);
      if (printing.includeInMasterSet) {
        bucket.ownedMaster += 1;
      }
    }
  }

  // Single-pass over `cards`: tally per-set total numbered.
  for (const card of input.cards) {
    const bucket = ensureBucket(buckets, firstSeenOrder, card.setId);
    bucket.totalNumbered += 1;
  }

  // Per-set output ordering rule:
  //   - explicit `sets` ⇒ that order, missing ⇒ zero-result.
  //   - omitted/empty `sets` ⇒ first-seen order from the printing
  //     roster.
  const orderedSetIds: ReadonlyArray<string> =
    input.sets && input.sets.length > 0 ? input.sets : firstSeenOrder;

  const perSet: SetCompletionResult[] = orderedSetIds.map((setId) => {
    const bucket = buckets.get(setId);
    if (!bucket) {
      return {
        setId,
        setPct: 0,
        masterPct: 0,
        ownedNumbered: 0,
        totalNumbered: 0,
        ownedMaster: 0,
        totalMaster: 0,
      };
    }
    const ownedNumbered = bucket.ownedCardIds.size;
    return {
      setId,
      setPct: safePct(ownedNumbered, bucket.totalNumbered),
      masterPct: safePct(bucket.ownedMaster, bucket.totalMaster),
      ownedNumbered,
      totalNumbered: bucket.totalNumbered,
      ownedMaster: bucket.ownedMaster,
      totalMaster: bucket.totalMaster,
    };
  });

  // Global tallies. We delegate to the dedicated functions to keep
  // a single source of truth for each metric — they re-walk the
  // input arrays (one extra pass each), but the whole thing still
  // collapses to O(P + C + I) overall and the wins from sharing
  // code outweigh the extra walks at our scale.
  const allPokemon = computeAllPokemonPct({
    cards: input.cards,
    printings: input.printings,
    ownedPrintingIds: input.ownedPrintingIds,
  });
  const globalMaster = computeGlobalMasterPct({
    printings: input.printings,
    ownedPrintingIds: input.ownedPrintingIds,
  });

  return {
    perSet,
    global: {
      allPokemonPct: allPokemon.pct,
      masterPct: globalMaster.pct,
      uniqueCardsOwned: allPokemon.uniqueCardsOwned,
      uniqueCardsTotal: allPokemon.uniqueCardsTotal,
      masterOwned: globalMaster.masterOwned,
      masterTotal: globalMaster.masterTotal,
    },
  };
}

function ensureBucket(
  buckets: Map<string, SetBuckets>,
  firstSeenOrder: string[],
  setId: string,
): SetBuckets {
  let bucket = buckets.get(setId);
  if (bucket === undefined) {
    bucket = makeEmptyBuckets();
    buckets.set(setId, bucket);
    firstSeenOrder.push(setId);
  }
  return bucket;
}

// Re-export the per-set / global narrow types from this module too
// so an importer that wants the full surface from one path can do
// `import { computeCompletion, RosterCard, ... } from '@binderly/set-completion';`
// without poking into per-file paths. Public barrel in `index.ts`
// is the canonical entry, but tests and aggregate consumers have a
// lighter graph this way.
export type { ComputeCompletionInput, ComputeCompletionResult, RosterCard, RosterPrinting };
