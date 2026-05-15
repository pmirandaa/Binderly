// Handler for POST /me/collection/recompute-set-completion.
//
// The actual set-completion math (Set %, Master %, All Pokémon %)
// lives in `T-SP-SET-COMPLETION`, which is a stage-3 task that has
// not landed yet. This endpoint exists in the v1 dispatcher today
// (rather than 404'ing until SP-SET-COMPLETION lands) so:
//
//   1. The api-client / web / mobile UIs can wire their "recompute"
//      button without waiting for the math package — they call the
//      endpoint, get a deferred-202 envelope back, and treat it as
//      "task accepted; no completion data yet".
//
//   2. The contract is forward-compatible: when the math lands it
//      replaces this body with the real recompute (driven by a
//      service-role client to read aggregate `collection_item` data
//      across the whole user's collection without RLS scoping).
//
// Today's behavior:
//
//   - Auth still required — anyone calling the endpoint must be
//     authenticated, so misuse from anonymous traffic gets the same
//     401 envelope every other endpoint emits.
//   - Returns a `202 Accepted` with body
//     `{ ok: false, error: { code: 'NOT_FOUND', message, details: { deferred: true } } }`.
//     The status is 202 (not 404) because the contract is "we've
//     received your request, the work is deferred"; the body uses
//     the `NOT_FOUND` code for the api-client's typed error
//     branch since `DEFERRED` isn't in `API_ERROR_CODES`.
//   - The README documents the cut-over: when T-SP-SET-COMPLETION
//     ships, the handler swaps to a real implementation and the
//     api-client picks up the new shape via its own typed path.

import { apiError } from '../errors.ts';
import { requireUser } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

export async function handleRecomputeSetCompletion(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  // Still require auth so the deferred-202 isn't a free anonymous
  // probe surface; anyone can trigger work for their own user only.
  await requireUser(request, ctx.env, ctx.deps);
  return apiError(
    request,
    ctx.cors,
    ctx.requestId,
    'NOT_FOUND',
    'recompute-set-completion is deferred until T-SP-SET-COMPLETION ships.',
    {
      status: 202,
      details: {
        deferred: true,
        deferredReason: 'T-SP-SET-COMPLETION not loaded',
        retryAfterSeconds: null,
      },
    },
  );
}
