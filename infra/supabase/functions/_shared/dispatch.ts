// HTTP entry-point glue for the v1 mux.
//
// `dispatch(request, ctx, routes)` is the function the Deno.serve
// callback (and vitest tests) invoke. It:
//
//   1. Echoes / mints the `x-request-id` and threads it into the
//      handler context.
//   2. Handles CORS preflight (`OPTIONS`) before any auth/route work.
//   3. Walks the route table, returning 404 / 405 envelopes when no
//      route matches the path or no method matches the path.
//   4. Catches any thrown `ApiError` (or unexpected error) and
//      serializes the error envelope.
//
// Splitting this out of `v1/index.ts` keeps the entry-point thin and
// makes the dispatcher testable in isolation (no Deno.serve required).

import { handlePreflight, parseCorsConfig, type CorsConfig } from './cors.ts';
import { apiError, errorToResponse } from './errors.ts';
import { resolveRequestId } from './request-id.ts';
import { matchPattern, normalizePathname } from './routing.ts';

import type { ContextualRoute, DispatcherContext } from './routes-table.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from './db.ts';

/**
 * Read the env-var bag the dispatcher needs. The `getEnv` callback
 * is `Deno.env.get` in production and a stub in tests.
 */
export function buildEnv(getEnv: (name: string) => string | undefined): EdgeFunctionEnv {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const corsAllowOriginsRaw = getEnv('CORS_ALLOW_ORIGINS');
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error(
      'Edge Function env is incomplete — set SUPABASE_URL, SUPABASE_ANON_KEY, and ' +
        'SUPABASE_SERVICE_ROLE_KEY (the supabase functions runtime sets the first two ' +
        'automatically; service-role must be supplied via `supabase secrets set`).',
    );
  }
  const corsConfig = parseCorsConfig(corsAllowOriginsRaw);
  // RevenueCat secret key is OPTIONAL — the entitlements handler
  // fail-closes to free tier when it's absent (dev / not-yet-
  // provisioned). Never throw on a missing RC key.
  const revenueCatSecretApiKey = getEnv('REVENUECAT_SECRET_API_KEY');
  const revenueCatApiBaseUrl = getEnv('REVENUECAT_API_BASE_URL');
  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    corsAllowOrigins: corsConfig.allowOrigins,
    ...(revenueCatSecretApiKey !== undefined && revenueCatSecretApiKey.length > 0
      ? { revenueCatSecretApiKey }
      : {}),
    ...(revenueCatApiBaseUrl !== undefined && revenueCatApiBaseUrl.length > 0
      ? { revenueCatApiBaseUrl }
      : {}),
  };
}

/**
 * Build the per-request `DispatcherContext` from an `EdgeFunctionEnv`,
 * a request id, and optional dependency overrides (tests pass a fake
 * `createClient` here).
 */
export function buildContext(
  env: EdgeFunctionEnv,
  requestId: string,
  deps?: ClientFactoryDeps,
): DispatcherContext {
  const cors: CorsConfig = { allowOrigins: env.corsAllowOrigins };
  return deps !== undefined ? { env, cors, requestId, deps } : { env, cors, requestId };
}

/**
 * Dispatch a single `Request` through the route table. Returns a
 * `Response` for every input — never throws.
 */
export async function dispatch(
  request: Request,
  ctx: DispatcherContext,
  routes: readonly ContextualRoute[],
): Promise<Response> {
  // 1. CORS preflight short-circuit.
  const preflight = handlePreflight(request, ctx.cors);
  if (preflight !== null) return preflight;

  try {
    // 2. Walk the route table.
    const url = new URL(request.url);
    const normalized = normalizePathname(url.pathname);
    let methodNotAllowed = false;
    for (const route of routes) {
      const params = matchPattern(route.pattern, normalized);
      if (params === null) continue;
      if (route.method !== request.method) {
        methodNotAllowed = true;
        continue;
      }
      const result = await route.handler(
        request,
        {
          pathname: url.pathname,
          normalizedPathname: normalized,
          params,
          searchParams: url.searchParams,
        },
        ctx,
      );
      return result;
    }
    if (methodNotAllowed) {
      return apiError(
        request,
        ctx.cors,
        ctx.requestId,
        'VALIDATION',
        `Method ${request.method} not allowed for ${normalized}.`,
        { status: 405 },
      );
    }
    return apiError(
      request,
      ctx.cors,
      ctx.requestId,
      'NOT_FOUND',
      `No route matches ${request.method} ${normalized}.`,
    );
  } catch (cause) {
    return errorToResponse(request, ctx.cors, ctx.requestId, cause);
  }
}

/**
 * The top-level handler signature `Deno.serve` expects. Tests can
 * call this directly to round-trip a synthesized request.
 */
export function makeHandler(options: {
  readonly getEnv: (name: string) => string | undefined;
  readonly routes: readonly ContextualRoute[];
  readonly deps?: ClientFactoryDeps;
}): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const requestId = resolveRequestId(request);
    let env: EdgeFunctionEnv;
    try {
      env = buildEnv(options.getEnv);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'env build failed';
      const ctx: DispatcherContext = {
        env: {
          supabaseUrl: '',
          supabaseAnonKey: '',
          supabaseServiceRoleKey: '',
          corsAllowOrigins: ['*'],
        },
        cors: { allowOrigins: ['*'] },
        requestId,
      };
      return apiError(request, ctx.cors, requestId, 'INTERNAL', message);
    }
    const ctx = buildContext(env, requestId, options.deps);
    return dispatch(request, ctx, options.routes);
  };
}
