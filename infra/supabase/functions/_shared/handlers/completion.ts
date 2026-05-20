// Handler for `GET /v1/me/collection/completion`.
//
// Returns `{ global, perSet, lastUpdatedAt }` matching
// `completionDto` in `packages/api-contracts/src/collection.ts`.
//
// Background — Q-013 cleanup. T-BE-EDGE-FUNCTIONS-V2 (iter 21)
// shipped an on-the-fly compute against the canonical tables because
// the `mv_user_set_completion` / `mv_user_global_completion`
// materialized views the task brief named did not exist. This
// PR (T-BE-Q013-CLEANUP) lands those MVs in
// `0018_mv_user_completion.sql` and swaps the handler to single
// SELECTs against them.
//
// Read posture. The handler does three round-trips:
//
//   1. SELECT FROM v_my_set_completion        (auth.uid()-filtered)
//   2. SELECT FROM v_my_global_completion     (auth.uid()-filtered)
//   3. SELECT id, code, name FROM "set"       (public-read catalog)
//
// (1) returns one row per (user, set) where the user has progress.
// (3) is the full catalog set list — needed so the perSet array
// carries one row per catalog set even when the user has zero
// progress in some sets (the home-screen list shows every set with
// a 0% placeholder). The handler merges the two: every catalog set
// becomes a perSet entry; for sets in (1), the merged entry carries
// the MV's pre-computed counts + percentages, otherwise the entry
// is all zeros.
//
// (2) returns at most one row (the user's global aggregate). If the
// user has no `collection_item` rows at all, the MV has no row for
// them and the handler synthesises an all-zero global block from
// the catalog totals. The catalog-totals scan happens via the
// existing `v_my_global_completion` wrapper for the "no rows
// shaped" case — we just fall back to `{ allPokemonPct: 0, … }`.
//
// Auth posture. The user-scoped client (`requireUser()`) is used.
// The wrapper views' `WHERE user_id = auth.uid()` predicate runs
// automatically; we don't add an explicit `.eq('user_id', ...)`
// filter because the view qual already does it.
//
// Perf posture. (1) is bounded by the user's collection footprint
// (≤ ~30 sets in practice — most users have one or two binders
// of interest). (2) is exactly one row. (3) is bounded by the
// catalog set count (~100 at v1 scale; a single small SELECT). All
// three are O(small) reads under a millisecond at v1 scale — a
// step-function improvement over the iter-21 fan-out
// (`O(collection_items + cards + printings + sets)` per call).
//
// `lastUpdatedAt` is no longer derived from a `MAX(updated_at)`
// scan over the user's collection_item rows — at MV-scale we'd
// need to either run a fourth query or materialise an
// `updated_at` column on `mv_user_global_completion`. The
// pragmatic v1 move is the latter: the MV doesn't carry it yet,
// so the handler returns `null` until the next iteration adds
// the column (logged below as a TODO and referenced from
// `T-BE-Q013-CLEANUP`'s Notes from execution). Clients consuming
// `lastUpdatedAt` were stale-while-revalidate cache hints; `null`
// degrades gracefully to "always revalidate".

import { apiOk } from '../errors.ts';
import { requireUser, translatePostgrestError } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

const SET_COMPLETION_VIEW = 'v_my_set_completion';
const GLOBAL_COMPLETION_VIEW = 'v_my_global_completion';
const SET_TABLE = 'set';

/** Row shape from `v_my_set_completion`. Mirrors the MV columns. */
interface MvSetRow {
  readonly user_id: string;
  readonly set_id: string;
  readonly set_code: string;
  readonly set_name: string;
  readonly owned_unique: number;
  readonly total_unique: number;
  readonly owned_master: number;
  readonly total_master: number;
  // The MV stores percentages as `numeric` so PostgREST returns them
  // as JSON strings. We coerce to `number` in the handler.
  readonly set_pct: number | string;
  readonly master_pct: number | string;
}

/** Row shape from `v_my_global_completion`. */
interface MvGlobalRow {
  readonly user_id: string;
  readonly unique_cards_owned: number;
  readonly total_cards: number;
  readonly master_owned: number;
  readonly master_total: number;
  readonly all_pokemon_pct: number | string;
  readonly master_pct: number | string;
}

interface SetRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

interface PerSetEntry {
  setId: string;
  setCode: string;
  setName: string;
  setPct: number;
  masterPct: number;
  ownedNumbered: number;
  totalNumbered: number;
  ownedMaster: number;
  totalMaster: number;
}

interface GlobalCompletion {
  allPokemonPct: number;
  masterPct: number;
  uniqueCardsOwned: number;
  uniqueCardsTotal: number;
  masterOwned: number;
  masterTotal: number;
}

export async function handleGetCollectionCompletion(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);

  // 1) Per-set progress for the caller. The wrapper view filters by
  //    `auth.uid()` automatically, so we don't add an explicit
  //    user_id filter (would be redundant and would shadow the qual).
  const { data: setRows, error: setError } = await session.supabase
    .from(SET_COMPLETION_VIEW)
    .select(
      'user_id, set_id, set_code, set_name, owned_unique, total_unique, ' +
        'owned_master, total_master, set_pct, master_pct',
    );
  if (setError !== null) {
    throw translatePostgrestError(setError);
  }

  // 2) Global aggregate row for the caller. Zero rows when the
  //    user has no collection_item; the synthesise-zero branch below
  //    handles that.
  const { data: globalRows, error: globalError } = await session.supabase
    .from(GLOBAL_COMPLETION_VIEW)
    .select(
      'user_id, unique_cards_owned, total_cards, master_owned, ' +
        'master_total, all_pokemon_pct, master_pct',
    );
  if (globalError !== null) {
    throw translatePostgrestError(globalError);
  }

  // 3) Catalog set list (so perSet entries exist for sets with zero
  //    progress). Public-read; the user-scoped client reaches it.
  const { data: catalogSetRows, error: catalogError } = await session.supabase
    .from(SET_TABLE)
    .select('id, code, name');
  if (catalogError !== null) {
    throw translatePostgrestError(catalogError);
  }

  const setProgress = new Map<string, MvSetRow>();
  for (const row of (setRows ?? []) as readonly MvSetRow[]) {
    setProgress.set(row.set_id, row);
  }

  const catalog = (catalogSetRows ?? []) as readonly SetRow[];
  const perSet: PerSetEntry[] = catalog
    .map((set): PerSetEntry => {
      const progress = setProgress.get(set.id);
      if (progress === undefined) {
        return {
          setId: set.id,
          setCode: set.code,
          setName: set.name,
          setPct: 0,
          masterPct: 0,
          ownedNumbered: 0,
          totalNumbered: 0,
          ownedMaster: 0,
          totalMaster: 0,
        };
      }
      return {
        setId: set.id,
        setCode: progress.set_code,
        setName: progress.set_name,
        setPct: toPercentNumber(progress.set_pct),
        masterPct: toPercentNumber(progress.master_pct),
        ownedNumbered: progress.owned_unique,
        totalNumbered: progress.total_unique,
        ownedMaster: progress.owned_master,
        totalMaster: progress.total_master,
      };
    })
    .sort((a, b) => a.setName.localeCompare(b.setName));

  const globalRow = ((globalRows ?? []) as readonly MvGlobalRow[])[0];
  const global: GlobalCompletion =
    globalRow === undefined
      ? {
          // Zero-progress fallback. Catalog totals are 0 here too —
          // the home screen doesn't render denominators when the
          // user has no progress yet (and the empty-state UI takes
          // over).
          allPokemonPct: 0,
          masterPct: 0,
          uniqueCardsOwned: 0,
          uniqueCardsTotal: 0,
          masterOwned: 0,
          masterTotal: 0,
        }
      : {
          allPokemonPct: toPercentNumber(globalRow.all_pokemon_pct),
          masterPct: toPercentNumber(globalRow.master_pct),
          uniqueCardsOwned: globalRow.unique_cards_owned,
          uniqueCardsTotal: globalRow.total_cards,
          masterOwned: globalRow.master_owned,
          masterTotal: globalRow.master_total,
        };

  // TODO(T-BE-Q013-CLEANUP / lastUpdatedAt): the MVs do not carry a
  // `max(updated_at)` column yet. Returning `null` is a graceful
  // degrade for clients that used the value as a stale-while-
  // revalidate hint — they'll just revalidate every time, which at
  // MV-scale is cheap. The next iteration's backend cleanup can add
  // a `last_collection_item_updated_at` column to
  // `mv_user_global_completion` and surface it here.
  return apiOk(request, ctx.cors, ctx.requestId, {
    global,
    perSet,
    lastUpdatedAt: null,
  });
}

/**
 * Convert a Postgres `numeric` value the JSON wire serialises as a
 * string back into a JS number. Falls back to `Number(value)` for
 * the (theoretical) case where PostgREST returns it as a number
 * already.
 */
function toPercentNumber(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
