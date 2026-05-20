// Handler for `POST /v1/smart-collections/preview`.
//
// Accepts a Smart Collection DSL expression + pagination
// (`{ expression, limit?, offset? }`) and returns matching printings
// (the projection mirrors `smartPreviewItemDto` in
// `packages/api-contracts/src/collection.ts`) plus a `totalCount`
// and `nextOffset` for the UI.
//
// Compilation strategy (T-BE-Q013-CLEANUP / Surface 2 / #FU-27).
//
// Iter 21 of this handler evaluated the AST in-JS by loading the
// full catalog (~30k printings) into the Edge Function memory and
// walking each candidate. That worked but it (a) blocked the
// surface from accepting `collection.*` predicates (we didn't
// project the user's `collection_item` rows into memory), and
// (b) scaled linearly with catalog size, which is fine at v1 but
// not what the brief asked for.
//
// We now delegate evaluation to a Postgres RPC:
//
//   client.rpc('smart_collection_preview', {
//     ast:       <AST jsonb>,
//     p_user_id: session.user.id,
//     p_limit:   limit,
//     p_offset:  offset,
//   })
//
// The RPC (defined in `0019_smart_preview_rpc.sql`) ports the TS
// `expressionToSql()` compiler to PL/pgSQL, joins
// `printing JOIN card JOIN set LEFT JOIN collection_item` (the
// LEFT JOIN is what makes `collection.*` predicates resolve —
// filtered by `p_user_id` so the predicates see the caller's
// rows only), and returns one row per match + a
// `COUNT(*) OVER ()` total_count window so the page + the count
// come back in one round-trip.
//
// Wire shape (`smartPreviewResponse`) is identical to the iter-21
// shape — the swap is implementation-only.
//
// The optional in-JS evaluator from iter 21 is parked at
// `_shared/handlers/evaluator-legacy.ts` for one iteration with a
// TODO marker, so a fast revert is possible if the RPC has
// problems in production (Decision D5 in the task brief).

import { parseJsonBody } from '../validate.ts';
import { smartPreviewRequest } from '../contracts.ts';
import { ApiError, apiOk } from '../errors.ts';
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

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const PREVIEW_RPC = 'smart_collection_preview';

// ============================================================
// RPC row shape — mirrors the RETURNS TABLE shape of
// `public.smart_collection_preview(...)` declared in migration
// `0019_smart_preview_rpc.sql`. Every row carries the same
// `total_count` value (window function semantics); the handler
// reads it once off the first row or defaults to 0 when the
// result set is empty.
// ============================================================

interface PreviewRpcRow {
  readonly printing_id: string;
  readonly card_id: string;
  readonly set_id: string;
  readonly card_name: string;
  readonly card_number: string;
  readonly set_name: string;
  readonly set_code: string;
  readonly variant_class: string;
  readonly variant_flags: readonly string[];
  readonly image_small_url: string | null;
  readonly total_count: number | string;
}

// ============================================================
// Handler entry point
// ============================================================

export async function handleSmartCollectionsPreview(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const payload = await parseJsonBody(request, smartPreviewRequest);
  const limit = Math.min(payload.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = payload.offset ?? 0;

  // The AST passes through `smartPreviewRequest` (mirror of the
  // canonical schema) before we hit the database — structurally
  // valid by the time it reaches the RPC. The RPC raises
  // `P0001` on unknown fields / malformed nodes (defence in
  // depth); `translatePostgrestError` maps that to a clean
  // `VALIDATION` envelope.
  const { data, error } = await session.supabase.rpc(PREVIEW_RPC, {
    ast: payload.expression,
    p_user_id: session.user.id,
    p_limit: limit,
    p_offset: offset,
  });

  if (error !== null && error !== undefined) {
    throw translatePostgrestError(error);
  }

  // PostgREST returns the RPC result as `data` — for a
  // `RETURNS TABLE` function, that's an array of rows. Treat a
  // `null` data as the empty-result case (the RPC always returns
  // an array, but defence in depth).
  const rows = Array.isArray(data) ? (data as readonly PreviewRpcRow[]) : [];
  const totalCount = rows.length > 0 ? coerceCount(rows[0]!.total_count) : 0;

  const items = rows.map((row) => ({
    printingId: row.printing_id,
    cardId: row.card_id,
    setId: row.set_id,
    cardName: row.card_name,
    cardNumber: row.card_number,
    setName: row.set_name,
    setCode: row.set_code,
    variantLabel: variantLabel(row.variant_class, row.variant_flags),
    imageSmallUrl: row.image_small_url,
  }));

  // `nextOffset` is the next page boundary if more rows exist.
  // The RPC already paginated server-side, so `items.length` is
  // the page size we received; compare against the total.
  const pageEnd = offset + items.length;
  const nextOffset = pageEnd < totalCount ? pageEnd : null;

  return apiOk(request, ctx.cors, ctx.requestId, {
    items,
    totalCount,
    nextOffset,
  });
}

// ============================================================
// Helpers
// ============================================================

function variantLabel(variantClass: string, variantFlags: readonly string[]): string {
  if (variantClass === 'BASE' && variantFlags.length === 0) {
    return '';
  }
  const flags = variantFlags.length > 0 ? ` (${variantFlags.join(', ')})` : '';
  return `${variantClass}${flags}`;
}

/**
 * Postgres `bigint` columns serialize over PostgREST as either a
 * JavaScript `number` (when the value fits in `Number.MAX_SAFE_INTEGER`,
 * which is always the case for catalog counts at v1 scale) or as a
 * string (rare). Defensively coerce both shapes.
 */
function coerceCount(raw: number | string): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new ApiError('INTERNAL', `smart_collection_preview returned non-finite count: ${raw}.`);
    }
    return raw;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(
      'INTERNAL',
      `smart_collection_preview returned non-numeric count: ${String(raw)}.`,
    );
  }
  return parsed;
}
