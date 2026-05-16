// Public types for `@binderly/set-completion`.
//
// The package is a pure-logic boundary between two halves of the
// product:
//
//   1. The catalog roster (cards + printings — the universe of what
//      EXISTS) sourced from the `card`, `printing`, and `set` tables
//      via `@binderly/api-contracts` DTOs.
//   2. The user's collection (which printings they OWN) sourced
//      from `collection_item.printing_id` rows.
//
// Both halves flow in as plain arrays of structurally-narrow records.
// Callers can hand us `CardDto[]` / `PrintingDto[]` /
// `CollectionItemDto[]` directly (the structural shapes match), or
// pre-project to the narrower interfaces below — both compile.
//
// All result types mirror the column names in `mv_user_set_completion`
// and `mv_user_global_completion` per `context/data-model.md` §
// "Materialized views". Field naming therefore round-trips to the
// recompute job's INSERT shape with no rename layer.
//
// Percentages are returned in the **0..100 range** (matching the
// `numeric(5,2)` column shape) as plain `number`s. The package never
// rounds — that's the recompute job's concern (the column is
// `numeric(5,2)`; rounding happens at write time).

// ============================================================
// Input shapes — narrow projections of the api-contracts DTOs
// ============================================================

/**
 * One row in the printing roster — the "what variants of which card
 * exist" universe the math operates on.
 *
 * Structurally a strict subset of `printingDto` from
 * `@binderly/api-contracts` (`id` mapped to `printingId`, plus the
 * three other fields the math touches). Callers can pre-project, or
 * pass `printingDto[]` and let TypeScript widen at the boundary if
 * they ALSO project `id → printingId`.
 *
 * Why we re-declare instead of importing `PrintingDto` directly:
 * `set-completion` is a pure-logic shared package per
 * `rules/03-shared-packages.md` — the `zod` runtime (~70KB) of
 * `@binderly/api-contracts` would graph into every consumer (mobile
 * RN, web). Structurally compatible types let consumers pass DTOs
 * without forcing the dep.
 */
export interface RosterPrinting {
  /** `printing.id` — the upsert anchor. */
  readonly printingId: string;
  /** `printing.card_id` — the card this printing belongs to. */
  readonly cardId: string;
  /** `card.set_id` — the set this printing belongs to. Carried on
   * the printing entry (not derived) so the math doesn't need a
   * second join. */
  readonly setId: string;
  /** `printing.include_in_master_set` — set during ingest by the
   * master-set rules engine in `data-pipeline/src/master-set/`. The
   * math here READS this boolean; it does not re-derive it. */
  readonly includeInMasterSet: boolean;
}

/**
 * One row in the card roster — the "numbered cards" universe used
 * for Set % and All Pokémon % math (both of which are per-card,
 * variant-agnostic per `PROJECT.md § 8`).
 *
 * Structurally a strict subset of `cardDto`.
 */
export interface RosterCard {
  /** `card.id`. */
  readonly cardId: string;
  /** `card.set_id`. */
  readonly setId: string;
}

/**
 * What the user owns. Only `printingId` is consumed by the math
 * (Set % is variant-agnostic; Master Set % is presence/absence; All
 * Pokémon % is presence/absence at the card level). Quantity,
 * condition, grade, etc. are intentionally out of scope — the
 * collection-item DTO carries them but they don't affect completion.
 *
 * The argument is typed as a plain array of `string` (printing ids)
 * rather than `CollectionItemDto[]` so consumers can pass a
 * pre-projected list cheaply. The recompute job projects to ids
 * server-side; clients projecting from local DTO caches can pass
 * `items.map((it) => it.printingId)`.
 */
export type OwnedPrintingIds = ReadonlyArray<string>;

// ============================================================
// Per-set result shapes — mirror `mv_user_set_completion`
// ============================================================

/**
 * Result of `computeSetPct` for a single set. Field names mirror
 * `mv_user_set_completion` per `context/data-model.md`.
 *
 * `pct` is in the 0..100 range (matches the materialized view's
 * `numeric(5,2)` column). Empty / zero-denominator inputs return
 * `pct: 0` (not NaN) — see the README's "edge cases" section.
 */
export interface SetPctResult {
  readonly setId: string;
  /** 0..100. Distinct cards in `setId` the user owns ≥1 printing of,
   * over total cards in `setId`. */
  readonly pct: number;
  /** `mv_user_set_completion.owned_numbered`. */
  readonly ownedNumbered: number;
  /** `mv_user_set_completion.total_numbered`. */
  readonly totalNumbered: number;
}

/**
 * Result of `computeMasterSetPct` for a single set. Field names
 * mirror `mv_user_set_completion`.
 *
 * Master Set % counts only printings with
 * `includeInMasterSet === true` — the boolean materialized by the
 * master-set rules engine. Owning a printing whose flag is `false`
 * (e.g. a STAFF promo) does NOT contribute to numerator OR
 * denominator.
 */
export interface MasterSetPctResult {
  readonly setId: string;
  /** 0..100. Distinct master-set-included printings in `setId` the
   * user owns, over total master-set-included printings in `setId`. */
  readonly pct: number;
  /** `mv_user_set_completion.owned_master`. */
  readonly ownedMaster: number;
  /** `mv_user_set_completion.total_master`. */
  readonly totalMaster: number;
}

/**
 * Combined per-set completion — the row shape the recompute job
 * writes into `mv_user_set_completion` (minus `user_id` /
 * `last_updated`, which the recompute job knows but the math does
 * not).
 */
export interface SetCompletionResult {
  readonly setId: string;
  /** 0..100. */
  readonly setPct: number;
  /** 0..100. */
  readonly masterPct: number;
  readonly ownedNumbered: number;
  readonly totalNumbered: number;
  readonly ownedMaster: number;
  readonly totalMaster: number;
}

// ============================================================
// Global result shapes — mirror `mv_user_global_completion`
// ============================================================

/**
 * Result of `computeAllPokemonPct`. Per `PROJECT.md § 8`, this is
 * "unique numbered cards across all sets the user has ≥1 printing of,
 * divided by total numbered cards in the database."
 *
 * Caller-supplied catalog filtering (e.g. by generation, set, or
 * subtype) is done by pre-filtering `cards` and `printings` before
 * calling — this package does not own a generation enum.
 */
export interface AllPokemonPctResult {
  /** 0..100. */
  readonly pct: number;
  /** `mv_user_global_completion.unique_cards_owned`. */
  readonly uniqueCardsOwned: number;
  /** `mv_user_global_completion.unique_cards_total`. */
  readonly uniqueCardsTotal: number;
}

/**
 * Result of `computeGlobalMasterPct`. Sum of master-set-included
 * printings owned across the catalog over total master-set-included
 * printings. Distinct from per-set Master Set % — this is the global
 * `mv_user_global_completion.master_pct` column, not the per-set
 * column of the same name.
 */
export interface GlobalMasterPctResult {
  /** 0..100. */
  readonly pct: number;
  /** `mv_user_global_completion.master_owned`. */
  readonly masterOwned: number;
  /** `mv_user_global_completion.master_total`. */
  readonly masterTotal: number;
}

/**
 * Combined global completion — the row shape the recompute job
 * writes into `mv_user_global_completion` (minus `user_id` /
 * `last_updated`).
 */
export interface GlobalCompletionResult {
  /** 0..100. */
  readonly allPokemonPct: number;
  /** 0..100. Global master across all sets. */
  readonly masterPct: number;
  readonly uniqueCardsOwned: number;
  readonly uniqueCardsTotal: number;
  readonly masterOwned: number;
  readonly masterTotal: number;
}

// ============================================================
// Aggregate input + output
// ============================================================

/**
 * Input to `computeCompletion` — the orchestrator entry point. Hands
 * back per-set + global results in one pass.
 *
 * If `sets` is omitted or empty, the function computes per-set
 * results for every distinct `setId` present in the printing roster.
 * Pinning a subset is the optimization the recompute job uses when
 * only one set's collection items changed — the global tallies still
 * scan the whole roster (they have to, by definition), but the
 * per-set output is narrowed.
 */
export interface ComputeCompletionInput {
  readonly cards: ReadonlyArray<RosterCard>;
  readonly printings: ReadonlyArray<RosterPrinting>;
  readonly ownedPrintingIds: OwnedPrintingIds;
  /**
   * Optional list of set ids to compute per-set results for. If
   * omitted, every set in the printing roster gets a per-set entry.
   */
  readonly sets?: ReadonlyArray<string>;
}

/**
 * Output of `computeCompletion`. `perSet` is in the same order as
 * the `sets` argument (or, if `sets` was omitted, in first-seen
 * order from the printing roster — deterministic for a given
 * input). `global` is the cross-catalog tally.
 */
export interface ComputeCompletionResult {
  readonly perSet: ReadonlyArray<SetCompletionResult>;
  readonly global: GlobalCompletionResult;
}
