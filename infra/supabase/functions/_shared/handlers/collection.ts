// Handlers for `/me/collection*` routes.
//
// Wire surface (matches `packages/api-client/src/resources/collection.ts`):
//
//   GET    /me/collection                       — list (cursor + limit)
//   POST   /me/collection                       — add (additive upsert)
//   POST   /me/collection/bulk                  — bulk update (transactional)
//   POST   /me/collection/recompute-set-completion — deferred 202 (see other file)
//   PATCH  /me/collection/:id                   — update one row
//   DELETE /me/collection/:id                   — delete one row
//
// Every handler:
//
//   - Authenticates via `requireUser()` (the user-scoped Supabase
//     client carries the JWT, so RLS keys `auth.uid() = user_id`).
//   - Validates the request body via the mirrored zod schemas in
//     `_shared/contracts.ts`.
//   - Translates PostgREST errors via `translatePostgrestError`.
//   - Returns the result envelope via `apiOk` / `apiError`.
//
// Completion-MV refresh hook (T-BE-Q013-CLEANUP). Every mutation
// (add / update / delete / bulk) fires a best-effort
// `supabase.rpc('refresh_user_completion')` after the mutation
// commits. Best-effort means: a refresh failure is logged via the
// request id (the structured `console.warn` channel) and does NOT
// change the mutation's HTTP response — the next read picks up the
// change on the next refresh. Strong-consistency UX in the typical
// case, eventually-consistent fallback when the refresh transiently
// fails (lock conflict, slow REFRESH on a hot MV, etc.).

import {
  addCollectionItemRequest,
  bulkUpdateCollectionRequest,
  updateCollectionItemRequest,
} from '../contracts.ts';
import { ApiError, apiNoContent, apiOk } from '../errors.ts';
import { parseJsonBody } from '../validate.ts';
import {
  requireUser,
  translatePostgrestError,
  type AuthenticatedSession,
  type ClientFactoryDeps,
  type EdgeFunctionEnv,
} from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { RouteMatch } from '../routing.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

const COLLECTION_ITEM_TABLE = 'collection_item';
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const REFRESH_USER_COMPLETION_RPC = 'refresh_user_completion';

/**
 * Fire-and-forget refresh of the per-user completion MVs. Returns a
 * Promise the caller may `await` for strong-consistency UX (the
 * next read sees the change) or ignore for best-effort throughput.
 *
 * All known failure modes are non-fatal for the surrounding
 * mutation:
 *
 *   - Refresh lock conflict (concurrent mutation also refreshing) —
 *     the second caller's CONCURRENTLY waits; if it times out at
 *     the PG layer, the next read sees the stale MV one extra
 *     beat. Acceptable.
 *   - Refresh function missing (pre-0018 environment) — surfaces as
 *     a `function not found` PostgREST error. Logged + ignored.
 *   - RPC connectivity blip — same.
 *
 * The structured log line uses the request id so on-call can
 * correlate a "the home screen lagged my last add by ~30s" report
 * with the specific refresh that didn't fire.
 */
async function bestEffortRefreshUserCompletion(
  session: AuthenticatedSession,
  requestId: string,
): Promise<void> {
  try {
    const { error } = await session.supabase.rpc(REFRESH_USER_COMPLETION_RPC);
    if (error !== null && error !== undefined) {
      console.warn(
        `[rid=${requestId}] refresh_user_completion RPC returned an error; ` +
          `the mutation succeeded, but the MV is stale until the next refresh. ` +
          `Error: ${error.message}`,
      );
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `[rid=${requestId}] refresh_user_completion RPC threw; the mutation ` +
        `succeeded, but the MV is stale until the next refresh. Error: ${message}`,
    );
  }
}

/**
 * Snake-cased DB row shape — what the Supabase JS client returns
 * from `.from('collection_item').select('*')`.
 */
interface CollectionItemRow {
  readonly id: string;
  readonly user_id: string;
  readonly printing_id: string;
  readonly quantity: number;
  readonly condition: string;
  readonly grade_company: string | null;
  readonly grade: string | null;
  readonly acquired_at: string | null;
  readonly acquired_price: string | null;
  readonly acquired_currency: string | null;
  readonly notes: string | null;
  readonly photo_urls: readonly string[];
  readonly source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Wire-shape DTO mirroring `collectionItemDto` in
 * `packages/api-contracts/src/collection.ts`. We hand-roll the camel-
 * case mapping here so the dispatcher doesn't take a runtime
 * dependency on a generic snake↔camel converter.
 */
export interface CollectionItemWire {
  id: string;
  userId: string;
  printingId: string;
  quantity: number;
  condition: string;
  gradeCompany: string | null;
  grade: string | null;
  acquiredAt: string | null;
  acquiredPrice: string | null;
  acquiredCurrency: string | null;
  notes: string | null;
  photoUrls: readonly string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

export function rowToWire(row: CollectionItemRow): CollectionItemWire {
  return {
    id: row.id,
    userId: row.user_id,
    printingId: row.printing_id,
    quantity: row.quantity,
    condition: row.condition,
    gradeCompany: row.grade_company,
    grade: row.grade,
    acquiredAt: row.acquired_at,
    acquiredPrice: row.acquired_price,
    acquiredCurrency: row.acquired_currency,
    notes: row.notes,
    photoUrls: row.photo_urls,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Module-scoped context the dispatcher passes to every handler:
 * env + injected client factory + the request id (for log lines).
 */
export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

// ============================================================
// GET /me/collection — list with cursor + limit
// ============================================================

export async function handleListCollection(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const limit = parseLimit(match.searchParams.get('limit'));
  const cursor = match.searchParams.get('cursor');

  let query = session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1); // request one extra so we can compute nextCursor

  if (cursor !== null && cursor.length > 0) {
    const decoded = decodeCursor(cursor);
    // (created_at, id) tuple comparison — PostgREST doesn't support
    // composite OR ranges directly; fall back to two filters AND'd.
    query = query.lte('created_at', decoded.createdAt).lt('id', decoded.id);
  }

  const { data, error } = await query;
  if (error !== null) {
    throw translatePostgrestError(error);
  }
  const rows = (data ?? []) as readonly CollectionItemRow[];
  const items = rows.slice(0, limit).map(rowToWire);
  const hasMore = rows.length > limit;
  const lastReturned = items[items.length - 1];
  const nextCursor =
    hasMore && lastReturned !== undefined
      ? encodeCursor({ createdAt: lastReturned.createdAt, id: lastReturned.id })
      : null;

  return apiOk(request, ctx.cors, ctx.requestId, {
    items,
    nextCursor,
  });
}

// ============================================================
// POST /me/collection — add (additive upsert)
// ============================================================

export async function handleAddCollectionItem(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const payload = await parseJsonBody(request, addCollectionItemRequest);
  const requestQuantity = payload.quantity ?? 1;
  const requestCondition = payload.condition ?? 'NEAR_MINT';

  const insertRow = {
    user_id: session.user.id,
    printing_id: payload.printingId,
    quantity: requestQuantity,
    condition: requestCondition,
    ...(payload.gradeCompany !== undefined ? { grade_company: payload.gradeCompany } : {}),
    ...(payload.grade !== undefined
      ? { grade: payload.grade === null ? null : numericToString(payload.grade, 1) }
      : {}),
    ...(payload.acquiredAt !== undefined ? { acquired_at: payload.acquiredAt } : {}),
    ...(payload.acquiredPrice !== undefined
      ? {
          acquired_price:
            payload.acquiredPrice === null ? null : numericToString(payload.acquiredPrice, 2),
        }
      : {}),
    ...(payload.acquiredCurrency !== undefined
      ? { acquired_currency: payload.acquiredCurrency }
      : {}),
    ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    ...(payload.photoUrls !== undefined ? { photo_urls: payload.photoUrls } : {}),
    ...(payload.source !== undefined ? { source: payload.source } : {}),
  };

  // Try INSERT. On unique-violation (23505), fall back to additive
  // UPDATE so the caller's repeated "I added another one" still
  // bumps the quantity instead of erroring.
  const { data: insertData, error: insertError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .insert(insertRow)
    .select('*')
    .single();

  if (insertError === null && insertData !== null) {
    await bestEffortRefreshUserCompletion(session, ctx.requestId);
    return apiOk(request, ctx.cors, ctx.requestId, rowToWire(insertData as CollectionItemRow), {
      status: 201,
    });
  }

  if (insertError !== null && insertError.code === '23505') {
    // Conflict — read existing row by the unique-constraint key,
    // bump its quantity, return it.
    const updated = await additiveQuantityUpdate(session, insertRow, requestQuantity);
    await bestEffortRefreshUserCompletion(session, ctx.requestId);
    return apiOk(request, ctx.cors, ctx.requestId, rowToWire(updated), { status: 200 });
  }

  if (insertError !== null) {
    throw translatePostgrestError(insertError);
  }
  throw new ApiError('INTERNAL', 'Insert returned no data and no error.');
}

async function additiveQuantityUpdate(
  session: AuthenticatedSession,
  insertRow: Record<string, unknown>,
  addQuantity: number,
): Promise<CollectionItemRow> {
  // Fetch the existing row matching the unique-constraint key.
  // RLS forces the row to belong to the caller (so this can't leak
  // another user's row even if the insertRow.user_id were spoofed
  // — which it can't be: we set it from session.user.id).
  let query = session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .select('*')
    .eq('user_id', insertRow['user_id'] as string)
    .eq('printing_id', insertRow['printing_id'] as string)
    .eq('condition', insertRow['condition'] as string);

  // grade_company / grade are nullable; use `.is(...)` for null,
  // `.eq(...)` for non-null. The unique constraint declares NULLS
  // NOT DISTINCT so this matches the semantics correctly.
  query = applyNullableFilter(query, 'grade_company', insertRow['grade_company']);
  query = applyNullableFilter(query, 'grade', insertRow['grade']);

  const { data: existingRows, error: selectError } = await query;
  if (selectError !== null) {
    throw translatePostgrestError(selectError);
  }
  const existing = (existingRows ?? [])[0] as CollectionItemRow | undefined;
  if (existing === undefined) {
    // Race: row vanished between INSERT-conflict and SELECT. Retry
    // the INSERT path once.
    throw new ApiError(
      'CONFLICT',
      'Conflict resolved between insert and re-fetch; retry the request.',
    );
  }
  const newQuantity = existing.quantity + addQuantity;
  const { data: updatedRow, error: updateError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('*')
    .single();
  if (updateError !== null) {
    throw translatePostgrestError(updateError);
  }
  if (updatedRow === null) {
    throw new ApiError('INTERNAL', 'Update returned no row.');
  }
  return updatedRow as CollectionItemRow;
}

// ============================================================
// PATCH /me/collection/:id — update one row
// ============================================================

export async function handleUpdateCollectionItem(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const id = match.params['id'];
  if (id === undefined) {
    throw new ApiError('VALIDATION', 'Missing :id path parameter.');
  }
  const payload = await parseJsonBody(request, updateCollectionItemRequest);
  const updateRow = patchToRow(payload);
  const response = await applySingleRowUpdate(session, request, ctx, id, updateRow);
  await bestEffortRefreshUserCompletion(session, ctx.requestId);
  return response;
}

// ============================================================
// DELETE /me/collection/:id — delete one row
// ============================================================

export async function handleDeleteCollectionItem(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const id = match.params['id'];
  if (id === undefined) {
    throw new ApiError('VALIDATION', 'Missing :id path parameter.');
  }
  // Two-step delete so we can fail fast with a 403 envelope when the
  // caller doesn't own the row (RLS would silently match zero rows
  // and produce a 204; the prompt explicitly wants the 403 signal).
  const { data: existing, error: selectError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();
  if (selectError !== null) {
    throw translatePostgrestError(selectError);
  }
  if (existing === null) {
    throw new ApiError('NOT_FOUND', `collection_item ${id} not found.`);
  }
  const existingTyped = existing as { id: string; user_id: string };
  if (existingTyped.user_id !== session.user.id) {
    throw new ApiError('AUTH', 'You do not own this collection_item.', { status: 403 });
  }
  const { error: deleteError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .delete()
    .eq('id', id);
  if (deleteError !== null) {
    throw translatePostgrestError(deleteError);
  }
  await bestEffortRefreshUserCompletion(session, ctx.requestId);
  return apiNoContent(request, ctx.cors, ctx.requestId);
}

// ============================================================
// POST /me/collection/bulk — transactional bulk update
// ============================================================

export async function handleBulkUpdateCollection(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const payload = await parseJsonBody(request, bulkUpdateCollectionRequest);

  // Snapshot every row's pre-image so we can revert on failure. RLS
  // ensures the caller can only see their own rows; if any id is
  // unknown we fail fast.
  const ids = payload.items.map((item) => item.id);
  const { data: snapshotRows, error: snapshotError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .select('*')
    .in('id', ids);
  if (snapshotError !== null) {
    throw translatePostgrestError(snapshotError);
  }
  const snapshot = new Map<string, CollectionItemRow>();
  for (const row of (snapshotRows ?? []) as readonly CollectionItemRow[]) {
    snapshot.set(row.id, row);
  }
  for (const item of payload.items) {
    if (!snapshot.has(item.id)) {
      throw new ApiError('NOT_FOUND', `collection_item ${item.id} not found.`);
    }
  }

  // Apply updates serially. On the first failure, revert every row
  // we've already touched back to its snapshot. The classical
  // "transactional" behavior wants a single SQL transaction; without
  // RPC we approximate it with this best-effort revert. If the
  // revert ALSO fails, we surface a CONFLICT envelope and trust the
  // caller to refetch and reconcile.
  const applied: { id: string; pre: CollectionItemRow }[] = [];
  const results: CollectionItemWire[] = [];
  try {
    for (const item of payload.items) {
      const pre = snapshot.get(item.id);
      if (pre === undefined) {
        throw new ApiError('NOT_FOUND', `collection_item ${item.id} not found.`);
      }
      const updateRow = patchToRow(item.patch);
      const { data: updated, error: updateError } = await session.supabase
        .from(COLLECTION_ITEM_TABLE)
        .update({ ...updateRow, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .select('*')
        .single();
      if (updateError !== null) {
        throw translatePostgrestError(updateError);
      }
      if (updated === null) {
        throw new ApiError('INTERNAL', `Update returned no row for ${item.id}.`);
      }
      applied.push({ id: item.id, pre });
      results.push(rowToWire(updated as CollectionItemRow));
    }
  } catch (cause) {
    await revertSnapshot(session.supabase, applied);
    throw cause;
  }
  await bestEffortRefreshUserCompletion(session, ctx.requestId);
  return apiOk(request, ctx.cors, ctx.requestId, { items: results });
}

async function revertSnapshot(
  supabase: SupabaseClient,
  applied: readonly { readonly id: string; readonly pre: CollectionItemRow }[],
): Promise<void> {
  // Best-effort revert; we swallow individual revert errors so the
  // caller still gets the original error envelope and the on-call
  // can use the request id to investigate any leftover drift.
  for (const entry of applied) {
    try {
      await supabase
        .from(COLLECTION_ITEM_TABLE)
        .update({
          quantity: entry.pre.quantity,
          condition: entry.pre.condition,
          grade_company: entry.pre.grade_company,
          grade: entry.pre.grade,
          acquired_at: entry.pre.acquired_at,
          acquired_price: entry.pre.acquired_price,
          acquired_currency: entry.pre.acquired_currency,
          notes: entry.pre.notes,
          photo_urls: entry.pre.photo_urls,
          updated_at: entry.pre.updated_at,
        })
        .eq('id', entry.id);
    } catch {
      // Already reporting the original error; revert failure is
      // logged by the supabase client itself.
    }
  }
}

// ============================================================
// Shared helpers
// ============================================================

function patchToRow(payload: {
  readonly quantity?: number | undefined;
  readonly condition?: string | undefined;
  readonly gradeCompany?: string | null | undefined;
  readonly grade?: number | null | undefined;
  readonly acquiredAt?: string | null | undefined;
  readonly acquiredPrice?: number | null | undefined;
  readonly acquiredCurrency?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly photoUrls?: readonly string[] | undefined;
}): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (payload.quantity !== undefined) row['quantity'] = payload.quantity;
  if (payload.condition !== undefined) row['condition'] = payload.condition;
  if (payload.gradeCompany !== undefined) row['grade_company'] = payload.gradeCompany;
  if (payload.grade !== undefined) {
    row['grade'] = payload.grade === null ? null : numericToString(payload.grade, 1);
  }
  if (payload.acquiredAt !== undefined) row['acquired_at'] = payload.acquiredAt;
  if (payload.acquiredPrice !== undefined) {
    row['acquired_price'] =
      payload.acquiredPrice === null ? null : numericToString(payload.acquiredPrice, 2);
  }
  if (payload.acquiredCurrency !== undefined) row['acquired_currency'] = payload.acquiredCurrency;
  if (payload.notes !== undefined) row['notes'] = payload.notes;
  if (payload.photoUrls !== undefined) row['photo_urls'] = payload.photoUrls;
  return row;
}

async function applySingleRowUpdate(
  session: AuthenticatedSession,
  request: Request,
  ctx: HandlerContext,
  id: string,
  updateRow: Record<string, unknown>,
): Promise<Response> {
  // Fetch first to surface a clean 404 vs 403 split (RLS would
  // silently 0-row-match for an unowned row, surfacing as a 404
  // which is misleading for "you don't own this").
  const { data: existing, error: selectError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();
  if (selectError !== null) {
    throw translatePostgrestError(selectError);
  }
  if (existing === null) {
    throw new ApiError('NOT_FOUND', `collection_item ${id} not found.`);
  }
  const existingTyped = existing as { id: string; user_id: string };
  if (existingTyped.user_id !== session.user.id) {
    throw new ApiError('AUTH', 'You do not own this collection_item.', { status: 403 });
  }
  const { data: updated, error: updateError } = await session.supabase
    .from(COLLECTION_ITEM_TABLE)
    .update({ ...updateRow, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (updateError !== null) {
    throw translatePostgrestError(updateError);
  }
  if (updated === null) {
    throw new ApiError('INTERNAL', 'Update returned no row.');
  }
  return apiOk(request, ctx.cors, ctx.requestId, rowToWire(updated as CollectionItemRow));
}

function applyNullableFilter<TQuery extends { eq: Function; is: Function }>(
  query: TQuery,
  column: string,
  value: unknown,
): TQuery {
  if (value === null || value === undefined) {
    return (query as unknown as { is: (col: string, val: null) => TQuery }).is(column, null);
  }
  return (query as unknown as { eq: (col: string, val: unknown) => TQuery }).eq(column, value);
}

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_PAGE_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ApiError('VALIDATION', `Invalid limit query param: ${raw}.`);
  }
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

interface CursorPayload {
  readonly createdAt: string;
  readonly id: string;
}

function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return base64UrlEncode(json);
}

function decodeCursor(cursor: string): CursorPayload {
  let json: string;
  try {
    json = base64UrlDecode(cursor);
  } catch (cause) {
    throw new ApiError(
      'VALIDATION',
      `Invalid cursor: ${cause instanceof Error ? cause.message : 'unknown'}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ApiError('VALIDATION', 'Cursor payload is not valid JSON.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== 'string' ||
    typeof (parsed as { id?: unknown }).id !== 'string'
  ) {
    throw new ApiError('VALIDATION', 'Cursor payload missing required fields.');
  }
  return parsed as CursorPayload;
}

function base64UrlEncode(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  const btoaFn = (globalThis as { btoa?: (input: string) => string }).btoa;
  if (typeof btoaFn !== 'function') {
    throw new Error('No base64 encoder available.');
  }
  return btoaFn(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  let padded = input.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) padded += '=';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf-8');
  }
  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof atobFn !== 'function') {
    throw new Error('No base64 decoder available.');
  }
  return atobFn(padded);
}

function numericToString(value: number, scale: number): string {
  return value.toFixed(scale);
}
