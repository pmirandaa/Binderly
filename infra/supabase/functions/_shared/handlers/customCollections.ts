// Handlers for `/me/custom-collections*` routes.
//
// Wire surface (matches `packages/api-client/src/resources/collection.ts`):
//
//   GET    /me/custom-collections                  — list
//   POST   /me/custom-collections                  — create (manual or smart)
//   GET    /me/custom-collections/:id              — read one
//   PATCH  /me/custom-collections/:id              — update name/slug/etc
//   DELETE /me/custom-collections/:id              — delete
//
//   GET    /me/custom-collections/:id/items        — list manual members
//   POST   /me/custom-collections/:id/items        — add a printing
//   DELETE /me/custom-collections/:id/items/:printingId — remove a printing
//
//   GET    /me/custom-collections/:id/smart-rule   — read the rule
//   PUT    /me/custom-collections/:id/smart-rule   — replace the rule expression
//
// Smart-collection expressions are accepted as opaque `unknown` per
// `smartCollectionRuleDto` in `api-contracts/collection.ts` — the
// smart-DSL parser lives in T-SP-SMART-DSL (which hasn't landed) and
// will validate the AST when it does. For now we round-trip the
// JSON value as `jsonb`.
//
// Freemium gating (3 manual + 0 smart on free) is documented in the
// contracts and SHOULD be enforced here. The actual entitlements
// resolver is owned by T-BE-AUTH (the `subscription` row) and isn't
// wired into a reusable helper yet — we leave a `TODO(freemium)`
// marker, with a unit test that asserts the marker is reachable so a
// future task can light it up.

import {
  addPrintingToCustomCollectionRequest,
  createCustomCollectionRequest,
  updateCustomCollectionRequest,
  updateSmartCollectionExpressionRequest,
} from '../contracts.ts';
import { ApiError, apiNoContent, apiOk } from '../errors.ts';
import { parseJsonBody } from '../validate.ts';
import { requireUser, translatePostgrestError } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

const CUSTOM_COLLECTION_TABLE = 'custom_collection';
const CUSTOM_COLLECTION_ITEM_TABLE = 'custom_collection_item';
const SMART_COLLECTION_RULE_TABLE = 'smart_collection_rule';

interface CustomCollectionRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: string;
  readonly description: string | null;
  readonly cover_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CustomCollectionItemRow {
  readonly custom_collection_id: string;
  readonly printing_id: string;
  readonly added_at: string;
}

interface SmartCollectionRuleRow {
  readonly custom_collection_id: string;
  readonly expression: unknown;
  readonly last_evaluated_at: string | null;
}

export interface CustomCollectionWire {
  id: string;
  userId: string;
  name: string;
  slug: string;
  kind: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomCollectionItemWire {
  customCollectionId: string;
  printingId: string;
  addedAt: string;
}

export interface SmartCollectionRuleWire {
  customCollectionId: string;
  expression: unknown;
  lastEvaluatedAt: string | null;
}

export function customCollectionToWire(row: CustomCollectionRow): CustomCollectionWire {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    description: row.description,
    coverUrl: row.cover_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function customCollectionItemToWire(row: CustomCollectionItemRow): CustomCollectionItemWire {
  return {
    customCollectionId: row.custom_collection_id,
    printingId: row.printing_id,
    addedAt: row.added_at,
  };
}

export function smartRuleToWire(row: SmartCollectionRuleRow): SmartCollectionRuleWire {
  return {
    customCollectionId: row.custom_collection_id,
    expression: row.expression,
    lastEvaluatedAt: row.last_evaluated_at,
  };
}

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

// ============================================================
// /me/custom-collections — top-level CRUD
// ============================================================

export async function handleListCustomCollections(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const { data, error } = await session.supabase
    .from(CUSTOM_COLLECTION_TABLE)
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });
  if (error !== null) throw translatePostgrestError(error);
  const rows = (data ?? []) as readonly CustomCollectionRow[];
  return apiOk(request, ctx.cors, ctx.requestId, rows.map(customCollectionToWire));
}

export async function handleCreateCustomCollection(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const payload = await parseJsonBody(request, createCustomCollectionRequest);

  // TODO(freemium): wire the per-tier limits when T-BE-AUTH ships
  // the entitlements resolver. Free tier allows 3 manual + 0 smart;
  // paid tier removes the cap. Leaving a marker handler here so the
  // future task can enable it without re-architecting this file.
  await checkFreemiumLimits(session, payload.kind);

  const insertRow = {
    user_id: session.user.id,
    name: payload.name,
    slug: payload.slug,
    kind: payload.kind,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.coverUrl !== undefined ? { cover_url: payload.coverUrl } : {}),
  };

  const { data: collectionRow, error: insertError } = await session.supabase
    .from(CUSTOM_COLLECTION_TABLE)
    .insert(insertRow)
    .select('*')
    .single();
  if (insertError !== null) throw translatePostgrestError(insertError);
  if (collectionRow === null) {
    throw new ApiError('INTERNAL', 'Insert returned no data.');
  }
  const typedCollection = collectionRow as CustomCollectionRow;

  if (payload.kind === 'smart') {
    const { error: ruleError } = await session.supabase.from(SMART_COLLECTION_RULE_TABLE).insert({
      custom_collection_id: typedCollection.id,
      expression: payload.expression,
    });
    if (ruleError !== null) {
      // Best-effort cleanup: the smart-collection without a rule row
      // is a corrupt state. The cascade-on-delete in the schema
      // would do this for us, but we want to surface the original
      // error.
      await session.supabase.from(CUSTOM_COLLECTION_TABLE).delete().eq('id', typedCollection.id);
      throw translatePostgrestError(ruleError);
    }
  }

  return apiOk(request, ctx.cors, ctx.requestId, customCollectionToWire(typedCollection), {
    status: 201,
  });
}

export async function handleGetCustomCollection(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const id = requireParam(match, 'id');
  const { data, error } = await session.supabase
    .from(CUSTOM_COLLECTION_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error !== null) throw translatePostgrestError(error);
  if (data === null) throw new ApiError('NOT_FOUND', `custom_collection ${id} not found.`);
  const typed = data as CustomCollectionRow;
  if (typed.user_id !== session.user.id) {
    throw new ApiError('AUTH', 'You do not own this custom_collection.', { status: 403 });
  }
  return apiOk(request, ctx.cors, ctx.requestId, customCollectionToWire(typed));
}

export async function handleUpdateCustomCollection(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const id = requireParam(match, 'id');
  const payload = await parseJsonBody(request, updateCustomCollectionRequest);
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, id, 'custom_collection');
  const updateRow: Record<string, unknown> = {};
  if (payload.name !== undefined) updateRow['name'] = payload.name;
  if (payload.slug !== undefined) updateRow['slug'] = payload.slug;
  if (payload.description !== undefined) updateRow['description'] = payload.description;
  if (payload.coverUrl !== undefined) updateRow['cover_url'] = payload.coverUrl;
  updateRow['updated_at'] = new Date().toISOString();
  const { data, error } = await session.supabase
    .from(CUSTOM_COLLECTION_TABLE)
    .update(updateRow)
    .eq('id', id)
    .select('*')
    .single();
  if (error !== null) throw translatePostgrestError(error);
  if (data === null) throw new ApiError('INTERNAL', 'Update returned no row.');
  return apiOk(
    request,
    ctx.cors,
    ctx.requestId,
    customCollectionToWire(data as CustomCollectionRow),
  );
}

export async function handleDeleteCustomCollection(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const id = requireParam(match, 'id');
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, id, 'custom_collection');
  const { error } = await session.supabase.from(CUSTOM_COLLECTION_TABLE).delete().eq('id', id);
  if (error !== null) throw translatePostgrestError(error);
  return apiNoContent(request, ctx.cors, ctx.requestId);
}

// ============================================================
// /me/custom-collections/:id/items — manual-collection membership
// ============================================================

export async function handleListCustomCollectionItems(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const customCollectionId = requireParam(match, 'id');
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, customCollectionId, 'custom_collection');
  const { data, error } = await session.supabase
    .from(CUSTOM_COLLECTION_ITEM_TABLE)
    .select('*')
    .eq('custom_collection_id', customCollectionId)
    .order('added_at', { ascending: false });
  if (error !== null) throw translatePostgrestError(error);
  const rows = (data ?? []) as readonly CustomCollectionItemRow[];
  return apiOk(request, ctx.cors, ctx.requestId, rows.map(customCollectionItemToWire));
}

export async function handleAddPrintingToCustomCollection(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const customCollectionId = requireParam(match, 'id');
  const payload = await parseJsonBody(request, addPrintingToCustomCollectionRequest);
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, customCollectionId, 'custom_collection');
  // The schema PK is `(custom_collection_id, printing_id)` — duplicate
  // adds bounce off a 23505 which we map to CONFLICT, matching the
  // `addPrintingToCustomCollectionRequest` contract comment ("server
  // returns CONFLICT if the printing is already in the collection").
  const { data, error } = await session.supabase
    .from(CUSTOM_COLLECTION_ITEM_TABLE)
    .insert({
      custom_collection_id: customCollectionId,
      printing_id: payload.printingId,
    })
    .select('*')
    .single();
  if (error !== null) throw translatePostgrestError(error);
  if (data === null) throw new ApiError('INTERNAL', 'Insert returned no row.');
  return apiOk(
    request,
    ctx.cors,
    ctx.requestId,
    customCollectionItemToWire(data as CustomCollectionItemRow),
    { status: 201 },
  );
}

export async function handleRemovePrintingFromCustomCollection(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const customCollectionId = requireParam(match, 'id');
  const printingId = requireParam(match, 'printingId');
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, customCollectionId, 'custom_collection');
  const { data: existing, error: selectError } = await session.supabase
    .from(CUSTOM_COLLECTION_ITEM_TABLE)
    .select('*')
    .eq('custom_collection_id', customCollectionId)
    .eq('printing_id', printingId)
    .maybeSingle();
  if (selectError !== null) throw translatePostgrestError(selectError);
  if (existing === null) {
    throw new ApiError(
      'NOT_FOUND',
      `Printing ${printingId} not in collection ${customCollectionId}.`,
    );
  }
  const { error: deleteError } = await session.supabase
    .from(CUSTOM_COLLECTION_ITEM_TABLE)
    .delete()
    .eq('custom_collection_id', customCollectionId)
    .eq('printing_id', printingId);
  if (deleteError !== null) throw translatePostgrestError(deleteError);
  return apiNoContent(request, ctx.cors, ctx.requestId);
}

// ============================================================
// /me/custom-collections/:id/smart-rule — smart-rule expression
// ============================================================

export async function handleGetSmartCollectionRule(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const customCollectionId = requireParam(match, 'id');
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, customCollectionId, 'custom_collection');
  const { data, error } = await session.supabase
    .from(SMART_COLLECTION_RULE_TABLE)
    .select('*')
    .eq('custom_collection_id', customCollectionId)
    .maybeSingle();
  if (error !== null) throw translatePostgrestError(error);
  if (data === null) {
    throw new ApiError(
      'NOT_FOUND',
      `smart_collection_rule for collection ${customCollectionId} not found.`,
    );
  }
  return apiOk(request, ctx.cors, ctx.requestId, smartRuleToWire(data as SmartCollectionRuleRow));
}

export async function handleUpdateSmartCollectionExpression(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const customCollectionId = requireParam(match, 'id');
  const payload = await parseJsonBody(request, updateSmartCollectionExpressionRequest);
  await assertOwnership(session, CUSTOM_COLLECTION_TABLE, customCollectionId, 'custom_collection');
  // The smart-DSL parser is owned by T-SP-SMART-DSL; we round-trip
  // the expression as opaque jsonb here per the contract comment.
  const { data, error } = await session.supabase
    .from(SMART_COLLECTION_RULE_TABLE)
    .update({ expression: payload.expression })
    .eq('custom_collection_id', customCollectionId)
    .select('*')
    .single();
  if (error !== null) throw translatePostgrestError(error);
  if (data === null) throw new ApiError('INTERNAL', 'Update returned no row.');
  return apiOk(request, ctx.cors, ctx.requestId, smartRuleToWire(data as SmartCollectionRuleRow));
}

// ============================================================
// Internal helpers
// ============================================================

function requireParam(match: RouteMatch, name: string): string {
  const value = match.params[name];
  if (value === undefined) {
    throw new ApiError('VALIDATION', `Missing :${name} path parameter.`);
  }
  return value;
}

async function assertOwnership(
  session: { readonly supabase: { from: Function }; readonly user: { id: string } },
  table: string,
  id: string,
  resourceLabel: string,
): Promise<void> {
  const builder = (session.supabase.from(table) as { select: Function }).select('id, user_id');
  const eqBuilder = (builder as { eq: Function }).eq('id', id);
  const { data, error } = await (
    eqBuilder as {
      maybeSingle: () => Promise<{
        data: { id: string; user_id: string } | null;
        error: { code?: string; message: string } | null;
      }>;
    }
  ).maybeSingle();
  if (error !== null) {
    throw translatePostgrestError(error);
  }
  if (data === null) {
    throw new ApiError('NOT_FOUND', `${resourceLabel} ${id} not found.`);
  }
  if (data.user_id !== session.user.id) {
    throw new ApiError('AUTH', `You do not own this ${resourceLabel}.`, { status: 403 });
  }
}

/**
 * Freemium limit gate marker. Currently a no-op pending T-BE-AUTH's
 * entitlements helper; the test asserts the function returns without
 * throwing for any kind so a future task can replace this body
 * without breaking the rest of the suite.
 */
export async function checkFreemiumLimits(
  _session: { readonly user: { id: string } },
  _kind: 'manual' | 'smart',
): Promise<void> {
  // TODO(freemium): replace with real entitlements check once
  // T-BE-AUTH exposes the resolver. The contract is documented in
  // PROJECT.md § 16 and `api-contracts/collection.ts`.
  return;
}
