// Route table — single source of truth for the v1 dispatcher.
//
// Each entry binds (HTTP method, normalized path pattern) to a
// handler. The order doesn't matter for correctness (patterns are
// disjoint), but we group them by resource for readability.
//
// Patterns are matched after `normalizePathname()` strips the
// proxy prefix (`/functions/v1/v1`, `/v1`, etc.) — see `routing.ts`.

import {
  handleAddCollectionItem,
  handleBulkUpdateCollection,
  handleDeleteCollectionItem,
  handleListCollection,
  handleUpdateCollectionItem,
} from './handlers/collection.ts';
import { handleGetCollectionCompletion } from './handlers/completion.ts';
import { handleGetPrintingCurrentPrice } from './handlers/currentPrice.ts';
import { handleGetMyEntitlements } from './handlers/entitlements.ts';
import { handleGetPublicShareable } from './handlers/publicShareable.ts';
import { handleSmartCollectionsPreview } from './handlers/smartPreview.ts';
import {
  handleAddPrintingToCustomCollection,
  handleCreateCustomCollection,
  handleDeleteCustomCollection,
  handleGetCustomCollection,
  handleGetSmartCollectionRule,
  handleListCustomCollectionItems,
  handleListCustomCollections,
  handleRemovePrintingFromCustomCollection,
  handleUpdateCustomCollection,
  handleUpdateSmartCollectionExpression,
} from './handlers/customCollections.ts';
import { handleRecomputeSetCompletion } from './handlers/recomputeSetCompletion.ts';

import type { CorsConfig } from './cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from './db.ts';
import type { RouteMatch } from './routing.ts';

/**
 * Per-request bag passed to every handler. Built once by the
 * dispatcher from `Deno.env` (or test fixtures) and threaded through
 * the route resolution path.
 */
export interface DispatcherContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

/**
 * Common handler signature — all collection / custom-collection /
 * recompute handlers conform to this shape.
 */
export type ContextualHandler = (
  request: Request,
  match: RouteMatch,
  ctx: DispatcherContext,
) => Promise<Response> | Response;

/**
 * Route descriptor used by the dispatcher. `pattern` and `method`
 * are the matchable surface; `handler` is invoked when both match.
 * `description` shows up in 404 envelopes to debug routing issues.
 */
export interface ContextualRoute {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly pattern: string;
  readonly handler: ContextualHandler;
  readonly description?: string;
}

function entry(
  method: ContextualRoute['method'],
  pattern: string,
  handler: ContextualHandler,
  description?: string,
): ContextualRoute {
  return {
    method,
    pattern,
    handler,
    description: description ?? `${method} ${pattern}`,
  };
}

export const ROUTES: readonly ContextualRoute[] = [
  // ---- collection_item ----
  entry('GET', '/me/collection', handleListCollection),
  entry('POST', '/me/collection', handleAddCollectionItem),
  entry('POST', '/me/collection/bulk', handleBulkUpdateCollection),
  entry('POST', '/me/collection/recompute-set-completion', handleRecomputeSetCompletion),
  entry('GET', '/me/collection/completion', handleGetCollectionCompletion),
  entry('PATCH', '/me/collection/:id', handleUpdateCollectionItem),
  entry('DELETE', '/me/collection/:id', handleDeleteCollectionItem),

  // ---- custom_collection ----
  entry('GET', '/me/custom-collections', handleListCustomCollections),
  entry('POST', '/me/custom-collections', handleCreateCustomCollection),
  entry('GET', '/me/custom-collections/:id', handleGetCustomCollection),
  entry('PATCH', '/me/custom-collections/:id', handleUpdateCustomCollection),
  entry('DELETE', '/me/custom-collections/:id', handleDeleteCustomCollection),

  // ---- custom_collection_item ----
  entry('GET', '/me/custom-collections/:id/items', handleListCustomCollectionItems),
  entry('POST', '/me/custom-collections/:id/items', handleAddPrintingToCustomCollection),
  entry(
    'DELETE',
    '/me/custom-collections/:id/items/:printingId',
    handleRemovePrintingFromCustomCollection,
  ),

  // ---- smart_collection_rule ----
  entry('GET', '/me/custom-collections/:id/smart-rule', handleGetSmartCollectionRule),
  entry('PUT', '/me/custom-collections/:id/smart-rule', handleUpdateSmartCollectionExpression),

  // ---- pricing — additive read endpoints (T-BE-EDGE-FUNCTIONS-V2) ----
  entry('GET', '/printings/:id/current-price', handleGetPrintingCurrentPrice),

  // ---- public shareable — anonymous SSR endpoint (T-BE-EDGE-FUNCTIONS-V2) ----
  entry('GET', '/c/:handle/:slug', handleGetPublicShareable),

  // ---- smart collections preview (T-BE-EDGE-FUNCTIONS-V2) ----
  entry('POST', '/smart-collections/preview', handleSmartCollectionsPreview),

  // ---- entitlements — unified RC read path (T-PB-ENTITLEMENTS) ----
  entry('GET', '/me/entitlements', handleGetMyEntitlements),
];
