// Path / method dispatcher for the Edge Function mux.
//
// The dispatcher table is a flat list of routes; each route declares
// a method, a pattern with `:param` placeholders, and a handler
// function. The first matching route wins; on no match we emit a
// `NOT_FOUND` envelope (the dispatcher's outermost catch).
//
// Supported URL flavors (the function may sit behind multiple
// proxies; this dispatcher accepts every plausible incoming shape):
//
//   - `/v1/me/collection`            (api-client baseUrl=supabaseUrl + reverse proxy)
//   - `/me/collection`               (api-client baseUrl=`${supabaseUrl}/functions/v1/v1`)
//   - `/functions/v1/v1/me/collection` (raw Supabase URL with no rewrite)
//   - `/v1/v1/me/collection`         (Supabase deploy where function name is `v1`)
//
// The `normalizePathname()` helper folds them down to a canonical
// `/me/...` shape before matching. Tests cover each flavor explicitly.

export type RouteHandler = (request: Request, match: RouteMatch) => Promise<Response> | Response;

export interface RouteDescriptor {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /**
   * Path pattern relative to the canonical `/me/...` namespace.
   * Placeholders use `:name` and bind to a single path segment.
   * Example: `'/me/collection/:id'`.
   */
  readonly pattern: string;
  readonly handler: RouteHandler;
  /**
   * Human-readable description — surfaced in `NOT_FOUND` responses
   * to help debug "why didn't my request route?" issues. Optional.
   */
  readonly description?: string;
}

export interface RouteMatch {
  readonly pathname: string;
  readonly normalizedPathname: string;
  readonly params: Readonly<Record<string, string>>;
  readonly searchParams: URLSearchParams;
}

/**
 * Strip every known prefix the function might see, leaving the
 * canonical `/me/...` path. Idempotent: applying it to an already-
 * normalized path is a no-op.
 */
export function normalizePathname(pathname: string): string {
  let path = pathname;
  if (!path.startsWith('/')) path = `/${path}`;
  // Strip any number of leading `/functions/v1/v1` or `/v1/v1`
  // segments (defense against double-rewrites).
  // We loop because chained rewrites in real prod traffic happen.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (path.startsWith('/functions/v1/v1/')) {
      path = path.slice('/functions/v1/v1'.length);
      continue;
    }
    if (path.startsWith('/functions/v1/v1')) {
      path = path.slice('/functions/v1/v1'.length) || '/';
      continue;
    }
    if (path.startsWith('/v1/v1/')) {
      path = path.slice('/v1/v1'.length);
      continue;
    }
    if (path.startsWith('/v1/v1')) {
      path = path.slice('/v1/v1'.length) || '/';
      continue;
    }
    if (path.startsWith('/v1/me/') || path === '/v1/me') {
      path = path.slice('/v1'.length);
      continue;
    }
    // Strip the `/v1/` prefix from any non-`/me/...` paths too. This
    // covers the additive read endpoints (`/c/{handle}/{slug}`,
    // `/printings/:id/current-price`, `/smart-collections/...`) added in
    // T-BE-EDGE-FUNCTIONS-V2 that don't sit under `/me/`. The earlier
    // proxy-rewrite branches above (`/functions/v1/v1`, `/v1/v1`) still
    // win when present; this is the "user already canonicalized to
    // `/v1/...` and we just need to drop the version segment" case.
    if (path.startsWith('/v1/')) {
      path = path.slice('/v1'.length);
      continue;
    }
    if (path === '/v1') {
      path = '/';
      continue;
    }
    break;
  }
  // Trim trailing slash unless the path is the root.
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

/**
 * Match a normalized path against a single pattern. Returns the
 * extracted params on success, `null` on no match.
 */
export function matchPattern(
  pattern: string,
  normalizedPath: string,
): Record<string, string> | null {
  const patternSegments = pattern.split('/').filter((segment) => segment.length > 0);
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0);
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSeg = patternSegments[i];
    const pathSeg = pathSegments[i];
    if (patternSeg === undefined || pathSeg === undefined) return null;
    if (patternSeg.startsWith(':')) {
      const name = patternSeg.slice(1);
      if (name.length === 0) return null;
      params[name] = decodeURIComponent(pathSeg);
      continue;
    }
    if (patternSeg !== pathSeg) return null;
  }
  return params;
}

/**
 * Find the first route in the table that matches the request. The
 * dispatcher prioritizes a method+path match over a path-only match
 * — if a path matches but the method doesn't, we still return
 * `methodNotAllowed` so the caller can emit a 405.
 */
export interface RouteResolution {
  readonly route: RouteDescriptor;
  readonly match: RouteMatch;
}

export function resolveRoute(
  routes: readonly RouteDescriptor[],
  request: Request,
): RouteResolution | { readonly methodNotAllowed: true } | null {
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
    return {
      route,
      match: {
        pathname: url.pathname,
        normalizedPathname: normalized,
        params,
        searchParams: url.searchParams,
      },
    };
  }
  if (methodNotAllowed) return { methodNotAllowed: true };
  return null;
}
