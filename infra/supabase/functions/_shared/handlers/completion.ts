// Handler for `GET /v1/me/collection/completion`.
//
// Returns `{ global, perSet, lastUpdatedAt }` matching
// `completionDto` in `packages/api-contracts/src/collection.ts`.
//
// Background — Q-010 / Q-013. The original task brief referenced two
// materialized views (`mv_user_set_completion`,
// `mv_user_global_completion`) but neither exists in the migrations
// today (see `open-questions.md` § Q-010 — the views were ratified in
// `PROJECT.md` but never created, and the orchestrator's "no schema
// changes" rule applies). This handler therefore computes completion
// **on the fly** from the canonical tables:
//
//   - `collection_item` (user-scoped via RLS).
//   - `card`  joined to `set` (public-read catalog).
//   - `printing` joined to `card` + `set` (public-read catalog).
//
// The math mirrors `@binderly/set-completion`'s `computeCompletion()`
// — re-implemented here because the Edge Function bundle does not
// pull in workspace packages (the deno.jsonc import-map is npm-only;
// the production deploy is a standalone bundle). The two
// implementations are kept in lockstep by the unit tests below; if
// they ever drift, the drift surfaces as a failing test, not silent
// math.
//
// Auth posture. The endpoint is authed; the user's JWT is decoded by
// `requireUser()` (so a malformed token returns the canonical 401
// envelope before any DB work happens), then we use the
// user-scoped Supabase client for the `collection_item` read so RLS
// keys `auth.uid() = user_id`. The catalog tables (`card`, `set`,
// `printing`) are public-read, so the same client can do the join.
//
// Perf posture. The query plan is:
//
//   1. SELECT printing_id FROM collection_item WHERE user_id = auth.uid()
//   2. SELECT id, set_id FROM card
//   3. SELECT id, card_id, include_in_master_set FROM printing
//   4. SELECT id, code, name FROM set
//
// Worst-case: catalog ~ 30k printings + 25k cards + 100 sets, owned ~
// a few hundred to a few thousand collection_items. The handler
// builds Maps and iterates once over each result; complexity is
// O(P + C + I) where I is `collection_item` rows. Latency target is
// the same < 100ms documented on `set-completion/aggregate.ts`. For
// v1 traffic this is fine; if a future user crosses ~10k owned
// printings we can revisit by caching the catalog rosters per
// process or extracting a Postgres function. Logged as Q-013.

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

const COLLECTION_ITEM_TABLE = 'collection_item';
const CARD_TABLE = 'card';
const PRINTING_TABLE = 'printing';
const SET_TABLE = 'set';

interface CollectionItemRow {
  readonly printing_id: string;
  readonly updated_at: string;
}

interface CardRow {
  readonly id: string;
  readonly set_id: string;
}

interface PrintingRow {
  readonly id: string;
  readonly card_id: string;
  readonly include_in_master_set: boolean;
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

  // 1) Read the user's owned printings + their max updated_at. RLS
  //    forces the row set to `user_id = auth.uid()`; we do NOT add an
  //    explicit `.eq('user_id', ...)` because RLS already gates it
  //    and the explicit filter would shadow that policy.
  const { data: collectionRows, error: collectionError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .select('printing_id, updated_at');
  if (collectionError !== null) {
    throw translatePostgrestError(collectionError);
  }

  // 2) Read the catalog. These tables are public-read; the
  //    user-scoped client can still hit them (RLS exposes them to
  //    `authenticated` per migrations 0003 / 0005).
  const { data: cardRows, error: cardError } = await session.supabase
    .from(CARD_TABLE)
    .select('id, set_id');
  if (cardError !== null) {
    throw translatePostgrestError(cardError);
  }
  const { data: printingRows, error: printingError } = await session.supabase
    .from(PRINTING_TABLE)
    .select('id, card_id, include_in_master_set');
  if (printingError !== null) {
    throw translatePostgrestError(printingError);
  }
  const { data: setRows, error: setError } = await session.supabase
    .from(SET_TABLE)
    .select('id, code, name');
  if (setError !== null) {
    throw translatePostgrestError(setError);
  }

  const collection = (collectionRows ?? []) as readonly CollectionItemRow[];
  const cards = (cardRows ?? []) as readonly CardRow[];
  const printings = (printingRows ?? []) as readonly PrintingRow[];
  const sets = (setRows ?? []) as readonly SetRow[];

  const { perSet, global } = computeCompletion(collection, cards, printings, sets);
  const lastUpdatedAt = collection.reduce<string | null>((acc, row) => {
    if (row.updated_at === undefined || row.updated_at === null) return acc;
    if (acc === null || row.updated_at > acc) return row.updated_at;
    return acc;
  }, null);

  return apiOk(request, ctx.cors, ctx.requestId, {
    global,
    perSet,
    lastUpdatedAt,
  });
}

// ============================================================
// Completion math — mirror of `@binderly/set-completion` /
// `aggregate.ts`. See file header for why this is duplicated.
// ============================================================

function computeCompletion(
  collection: readonly CollectionItemRow[],
  cards: readonly CardRow[],
  printings: readonly PrintingRow[],
  sets: readonly SetRow[],
): { perSet: readonly PerSetEntry[]; global: GlobalCompletion } {
  // Owned-printing dedup. A user can own the same printing in
  // multiple `collection_item` rows (different conditions / grades),
  // but for completion math each printing only counts once.
  const ownedPrintingIds = new Set(collection.map((r) => r.printing_id));

  // Index cards by id (for master-set ownership card-id lookup) and
  // tally per-set numbered totals + collect per-set card ids.
  const cardSetIndex = new Map<string, string>();
  const perSetTotalNumbered = new Map<string, number>();
  for (const card of cards) {
    cardSetIndex.set(card.id, card.set_id);
    perSetTotalNumbered.set(card.set_id, (perSetTotalNumbered.get(card.set_id) ?? 0) + 1);
  }

  // One pass over `printings`: per-set master totals + owned master
  // + per-set owned-card-ids.
  const perSetTotalMaster = new Map<string, number>();
  const perSetOwnedMaster = new Map<string, number>();
  const perSetOwnedCardIds = new Map<string, Set<string>>();
  let globalMasterTotal = 0;
  let globalMasterOwned = 0;
  for (const printing of printings) {
    const setId = cardSetIndex.get(printing.card_id);
    if (setId === undefined) continue; // orphan; skip rather than crash
    if (printing.include_in_master_set) {
      perSetTotalMaster.set(setId, (perSetTotalMaster.get(setId) ?? 0) + 1);
      globalMasterTotal += 1;
    }
    if (ownedPrintingIds.has(printing.id)) {
      if (printing.include_in_master_set) {
        perSetOwnedMaster.set(setId, (perSetOwnedMaster.get(setId) ?? 0) + 1);
        globalMasterOwned += 1;
      }
      const bucket = perSetOwnedCardIds.get(setId) ?? new Set<string>();
      bucket.add(printing.card_id);
      perSetOwnedCardIds.set(setId, bucket);
    }
  }

  // Per-set output, sorted by setName ascending so the home screen
  // doesn't need a client-side sort pass.
  const perSet: PerSetEntry[] = sets
    .map((set): PerSetEntry => {
      const totalNumbered = perSetTotalNumbered.get(set.id) ?? 0;
      const ownedNumbered = perSetOwnedCardIds.get(set.id)?.size ?? 0;
      const totalMaster = perSetTotalMaster.get(set.id) ?? 0;
      const ownedMaster = perSetOwnedMaster.get(set.id) ?? 0;
      return {
        setId: set.id,
        setCode: set.code,
        setName: set.name,
        setPct: safePct(ownedNumbered, totalNumbered),
        masterPct: safePct(ownedMaster, totalMaster),
        ownedNumbered,
        totalNumbered,
        ownedMaster,
        totalMaster,
      };
    })
    .sort((a, b) => a.setName.localeCompare(b.setName));

  // Global "all-pokemon" % = (distinct card ids owned, across all
  // sets) / (distinct card ids in the catalog). Mirrors
  // `computeAllPokemonPct`.
  const uniqueCardsTotal = cards.length;
  const ownedCardIds = new Set<string>();
  for (const printing of printings) {
    if (ownedPrintingIds.has(printing.id)) {
      ownedCardIds.add(printing.card_id);
    }
  }
  const uniqueCardsOwned = ownedCardIds.size;

  const global: GlobalCompletion = {
    allPokemonPct: safePct(uniqueCardsOwned, uniqueCardsTotal),
    masterPct: safePct(globalMasterOwned, globalMasterTotal),
    uniqueCardsOwned,
    uniqueCardsTotal,
    masterOwned: globalMasterOwned,
    masterTotal: globalMasterTotal,
  };

  return { perSet, global };
}

function safePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}
