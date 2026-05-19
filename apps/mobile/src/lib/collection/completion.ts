// Completion-math orchestration for the mobile collection surface.
//
// Two computation modes, both wired to `@binderly/set-completion`:
//
//   1. Per-set Set % for the home list. Cheap — only the user's
//      owned-printing context (printingId → cardId, setId,
//      includeInMasterSet) plus the top-level sets list. Master %
//      and Set % both fall back to a "needs full roster" zero
//      result when we don't have the per-set card / printing
//      universe loaded.
//
//   2. Full per-set completion for the drill-down — when we *do*
//      load every card + every printing in one set we hand a
//      complete `ComputeCompletionInput` to the package and trust
//      its output verbatim.
//
// The materialized-view endpoint that PROJECT.md § 8 promises
// (`mv_user_set_completion`) does not yet exist on the backend
// (T-BE-EDGE-FUNCTIONS is still a stub). When that endpoint lands
// the home screen should switch to reading it directly; per-set
// computation can keep using `computeCompletion` for the
// "what's missing right now" side panel. See
// `open-questions.md` Q-010.

import type {
  CardDto,
  GlobalCompletionDto,
  PerSetCompletionEntryDto,
  PrintingDto,
  SetDto,
} from '@binderly/api-contracts';
import {
  computeCompletion,
  type ComputeCompletionResult,
  type RosterCard,
  type RosterPrinting,
  type SetCompletionResult,
} from '@binderly/set-completion';


// ============================================================
// Cheap home-screen computation (partial roster only)
// ============================================================

/**
 * Minimal printing context the home list needs per owned printing:
 * the printingId itself, the card it backs, the set it belongs to,
 * and whether it counts for master-set tallies. The shape is the
 * `PrintingWithContextDto` projection — we narrow here so the
 * helpers below stay decoupled from the full DTO.
 */
export interface OwnedPrintingContext {
  readonly printingId: string;
  readonly cardId: string;
  readonly setId: string;
  readonly includeInMasterSet: boolean;
}

/**
 * Per-set completion summary for the home list. `setPct` is the
 * "Set %" metric (variant-agnostic — every numbered card the user
 * owns ≥1 printing of). `masterPct` is best-effort: when we don't
 * have the per-set printing roster loaded it falls back to the
 * fraction of owned-master printings *we know about* over the same
 * (so the bar at least reflects the user's progress against the
 * cards they've already touched).
 */
export interface CollectionSetSummary {
  readonly set: SetDto;
  readonly setPct: number;
  readonly ownedNumbered: number;
  readonly totalNumbered: number;
  readonly masterPct: number;
  readonly ownedMaster: number;
  readonly totalMaster: number;
  /** True when this set has at least one owned printing. */
  readonly hasAnyOwned: boolean;
}

/**
 * Aggregate global completion for the home-screen badge. Same
 * caveat as {@link CollectionSetSummary} for the master metric —
 * `masterPct` is best-effort against the printings we've fetched.
 */
export interface CollectionGlobalSummary {
  readonly allPokemonPct: number;
  readonly uniqueCardsOwned: number;
  readonly uniqueCardsTotal: number;
  readonly setsStarted: number;
  readonly setsMastered: number;
  readonly masterPct: number;
  readonly masterOwned: number;
  readonly masterTotal: number;
}

export interface CollectionSummary {
  readonly perSet: ReadonlyArray<CollectionSetSummary>;
  readonly global: CollectionGlobalSummary;
}

/**
 * Compute per-set + global summaries for the home screen. Uses the
 * `set.total` column as the per-set numbered denominator (it's the
 * same value the recompute job's materialized view computes from
 * the cards table). The numerator is the count of distinct cards in
 * the set the user owns ≥1 printing of, derived from the supplied
 * `OwnedPrintingContext[]`.
 *
 * Order of `perSet` matches the input `sets` order — call sites
 * (the home screen) sort it themselves so the same summary can
 * back both the "by completion" and "by release date" views without
 * re-running the math.
 */
export function summarizeCollection(input: {
  readonly sets: ReadonlyArray<SetDto>;
  readonly owned: ReadonlyArray<OwnedPrintingContext>;
}): CollectionSummary {
  const ownedBySet = new Map<string, OwnedPrintingContext[]>();
  for (const ctx of input.owned) {
    const bucket = ownedBySet.get(ctx.setId);
    if (bucket === undefined) {
      ownedBySet.set(ctx.setId, [ctx]);
    } else {
      bucket.push(ctx);
    }
  }

  const perSet: CollectionSetSummary[] = input.sets.map((set) => {
    const ownedHere = ownedBySet.get(set.id) ?? [];
    const totalNumbered = effectiveSetTotal(set);
    const ownedCardIds = new Set<string>();
    let ownedMaster = 0;
    for (const printing of ownedHere) {
      ownedCardIds.add(printing.cardId);
      if (printing.includeInMasterSet) ownedMaster += 1;
    }
    const ownedNumbered = ownedCardIds.size;
    return {
      set,
      setPct: safePct(ownedNumbered, totalNumbered),
      ownedNumbered,
      totalNumbered,
      // Without the full per-set printing roster we don't have a
      // stable denominator for Master %, so the home row leaves the
      // bar at 0. The drill-down screen has the full roster and
      // shows the precise number.
      masterPct: 0,
      ownedMaster,
      totalMaster: 0,
      hasAnyOwned: ownedHere.length > 0,
    };
  });

  // Global tallies.
  const allOwnedCardIds = new Set<string>();
  let allOwnedMaster = 0;
  for (const printing of input.owned) {
    allOwnedCardIds.add(printing.cardId);
    if (printing.includeInMasterSet) allOwnedMaster += 1;
  }
  const uniqueCardsTotal = perSet.reduce((acc, row) => acc + row.totalNumbered, 0);
  const setsStarted = perSet.filter((row) => row.hasAnyOwned).length;
  const setsMastered = perSet.filter(
    (row) => row.totalNumbered > 0 && row.ownedNumbered === row.totalNumbered,
  ).length;

  return {
    perSet,
    global: {
      allPokemonPct: safePct(allOwnedCardIds.size, uniqueCardsTotal),
      uniqueCardsOwned: allOwnedCardIds.size,
      uniqueCardsTotal,
      setsStarted,
      setsMastered,
      masterOwned: allOwnedMaster,
      masterTotal: 0,
      masterPct: 0,
    },
  };
}

/**
 * Sort comparator for the home-screen list:
 *   1. Completion % desc (mastered sets first).
 *   2. Release date desc (newest first within a tier).
 *   3. Stable name asc tiebreak so the order is deterministic
 *      across renders.
 */
export function compareSummariesForHome(
  a: CollectionSetSummary,
  b: CollectionSetSummary,
): number {
  if (a.setPct !== b.setPct) return b.setPct - a.setPct;
  if (a.set.releaseDate !== b.set.releaseDate) {
    return a.set.releaseDate < b.set.releaseDate ? 1 : -1;
  }
  return a.set.name.localeCompare(b.set.name);
}

// ============================================================
// Full per-set computation (drill-down)
// ============================================================

export interface PerSetCompletionInput {
  readonly setId: string;
  readonly cards: ReadonlyArray<CardDto>;
  readonly printings: ReadonlyArray<PrintingDto>;
  readonly ownedPrintingIds: ReadonlyArray<string>;
}

/**
 * Run `computeCompletion` against a single set's full roster. The
 * caller has loaded every card + every printing for the set so
 * both Set % and Master % are accurate.
 *
 * Returns the raw `ComputeCompletionResult` — convenient for tests
 * that already program against the package's shape. The screen
 * picks the per-set entry it cares about.
 */
export function computeCompletionForSet(
  input: PerSetCompletionInput,
): ComputeCompletionResult {
  const rosterCards: RosterCard[] = input.cards.map((card) => ({
    cardId: card.id,
    setId: input.setId,
  }));
  const rosterPrintings: RosterPrinting[] = input.printings.map((printing) => ({
    printingId: printing.id,
    cardId: printing.cardId,
    setId: input.setId,
    includeInMasterSet: printing.includeInMasterSet,
  }));
  return computeCompletion({
    cards: rosterCards,
    printings: rosterPrintings,
    ownedPrintingIds: input.ownedPrintingIds,
    sets: [input.setId],
  });
}

/**
 * Slice an `Array<PrintingDto>` into the owned + missing halves
 * for the per-set drill-down's segmented control. Owned is sorted
 * by `variantClass` then `variantKey` for a stable display; missing
 * mirrors that order so the two tabs feel like the same list.
 */
export function partitionPrintingsForDrillDown(
  printings: ReadonlyArray<PrintingDto>,
  ownedPrintingIds: ReadonlyArray<string>,
): { readonly owned: PrintingDto[]; readonly missing: PrintingDto[] } {
  const ownedSet = new Set(ownedPrintingIds);
  const owned: PrintingDto[] = [];
  const missing: PrintingDto[] = [];
  for (const printing of printings) {
    if (ownedSet.has(printing.id)) {
      owned.push(printing);
    } else {
      missing.push(printing);
    }
  }
  owned.sort(comparePrintings);
  missing.sort(comparePrintings);
  return { owned, missing };
}

/** Re-export the per-set completion result type for screen consumption. */
export type { SetCompletionResult } from '@binderly/set-completion';

// ============================================================
// Internals
// ============================================================

function comparePrintings(a: PrintingDto, b: PrintingDto): number {
  if (a.variantClass !== b.variantClass) {
    return a.variantClass.localeCompare(b.variantClass);
  }
  return a.variantKey.localeCompare(b.variantKey);
}

function effectiveSetTotal(set: SetDto): number {
  // `set.total` may be null on freshly-ingested catalog rows; fall
  // back to `printedTotal` (which only excludes secret rares /
  // promos) so the bar is still meaningful, then 0 as the
  // safe-divide-by-zero floor.
  if (typeof set.total === 'number' && set.total > 0) return set.total;
  if (typeof set.printedTotal === 'number' && set.printedTotal > 0) return set.printedTotal;
  return 0;
}

function safePct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

// ============================================================
// V2 completion-endpoint adapters
// ============================================================

/**
 * Adapt a `perSetCompletionEntryDto` row (from the V2 completion
 * endpoint) into the existing `CollectionSetSummary` shape that
 * `<CollectionSetRow>` consumes. Joins on `setId` against the
 * supplied `SetDto`. Returns `null` if the join fails (the
 * caller — `CollectionScreen` — filters those out before
 * rendering; the join is bidirectional in practice because the
 * server's perSet rows mirror the catalog).
 */
export function perSetEntryToSummary(
  entry: PerSetCompletionEntryDto,
  set: SetDto,
): CollectionSetSummary {
  return {
    set,
    setPct: entry.setPct,
    ownedNumbered: entry.ownedNumbered,
    totalNumbered: entry.totalNumbered,
    masterPct: entry.masterPct,
    ownedMaster: entry.ownedMaster,
    totalMaster: entry.totalMaster,
    hasAnyOwned: entry.ownedNumbered > 0 || entry.ownedMaster > 0,
  };
}

/**
 * Adapt the server's `global` block into the home-screen badge's
 * `CollectionGlobalSummary` shape. `setsStarted` / `setsMastered`
 * are derived from `perSet` because the server doesn't carry
 * those rolled-up counts (they're cheap to compute client-side
 * over `perSet.length`).
 */
export function globalDtoToSummary(input: {
  readonly global: GlobalCompletionDto;
  readonly perSet: ReadonlyArray<PerSetCompletionEntryDto>;
}): CollectionGlobalSummary {
  const setsStarted = input.perSet.filter(
    (row) => row.ownedNumbered > 0 || row.ownedMaster > 0,
  ).length;
  const setsMastered = input.perSet.filter(
    (row) => row.totalNumbered > 0 && row.ownedNumbered === row.totalNumbered,
  ).length;
  return {
    allPokemonPct: input.global.allPokemonPct,
    uniqueCardsOwned: input.global.uniqueCardsOwned,
    uniqueCardsTotal: input.global.uniqueCardsTotal,
    setsStarted,
    setsMastered,
    masterPct: input.global.masterPct,
    masterOwned: input.global.masterOwned,
    masterTotal: input.global.masterTotal,
  };
}

/**
 * Convenience for callers that hold the full `SetCompletionResult`
 * shape and want the picky math the home screen does (e.g. casting
 * a backend-supplied row to a {@link CollectionSetSummary}).
 */
export function summaryFromResult(
  set: SetDto,
  result: SetCompletionResult,
): CollectionSetSummary {
  return {
    set,
    setPct: result.setPct,
    ownedNumbered: result.ownedNumbered,
    totalNumbered: result.totalNumbered,
    masterPct: result.masterPct,
    ownedMaster: result.ownedMaster,
    totalMaster: result.totalMaster,
    hasAnyOwned: result.ownedNumbered > 0 || result.ownedMaster > 0,
  };
}
