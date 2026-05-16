// CORS handling for the Binderly Edge Functions.
//
// The web app (`apps/web`) runs at `http://localhost:3000` in dev and
// at `https://binderly.app` (+ Vercel preview URLs) in prod. The
// mobile app issues its requests from `binderly://` — RN's `fetch`
// doesn't enforce CORS but Supabase's API gateway sometimes does, so
// we still emit the headers there for completeness.
//
// The allow-list is configurable via `CORS_ALLOW_ORIGINS` (comma
// separated). When the env var is unset (e.g. in tests) we fall back
// to a permissive `*` — Edge Functions deployed with no env config
// shouldn't be reachable in the first place, and an absent env var
// implies "I don't know what to allow", which we treat as a dev /
// test signal.
//
// Headers we allow on the request side:
//
//   - `authorization` — the bearer token
//   - `apikey` — Supabase's anon-key gate (always sent by the api-client)
//   - `content-type` — JSON
//   - `x-request-id` — the correlation id (propagated end-to-end;
//     see `request-id.ts`)
//   - `x-binderly-app` — the api-client tags requests with the
//     calling surface (`web`, `mobile`, `scanner`); useful in logs
//     and rate-limiting later
//
// Headers we expose on the response side:
//
//   - `x-request-id` — so browser network-tab can copy/paste the id
//     when filing a bug
//
// CORS preflight (`OPTIONS`) returns 204 with the allow headers; no
// body. Same envelope shape isn't returned because preflight is a
// browser-internal concern that never hits app code.

import { REQUEST_ID_HEADER } from './request-id.ts';

const ALLOWED_HEADERS = [
  'authorization',
  'apikey',
  'content-type',
  REQUEST_ID_HEADER,
  'x-binderly-app',
].join(', ');
const ALLOWED_METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
const EXPOSED_HEADERS = [REQUEST_ID_HEADER].join(', ');
const MAX_AGE_SECONDS = '600'; // 10 minutes

/**
 * Snapshot of the runtime config the CORS layer consults. Tests pass a
 * synthetic snapshot; production reads from `Deno.env`.
 */
export interface CorsConfig {
  /**
   * List of allowed origins. `'*'` matches everything; an explicit
   * list allows only exact matches. An empty list disables CORS
   * (rejects everything) — useful for "internal-only" deployments.
   */
  readonly allowOrigins: readonly string[];
}

/**
 * Build a `CorsConfig` from a comma-separated env value.
 * `parseCorsConfig(undefined)` → `{ allowOrigins: ['*'] }` (dev/test
 * default). `parseCorsConfig('https://binderly.app,https://staging.binderly.app')`
 * → an exact-match list.
 */
export function parseCorsConfig(envValue: string | undefined): CorsConfig {
  if (envValue === undefined || envValue.trim().length === 0) {
    return { allowOrigins: ['*'] };
  }
  const origins = envValue
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return { allowOrigins: origins };
}

/**
 * Resolve the `Access-Control-Allow-Origin` header value for the
 * given request origin. Returns:
 *
 *   - `'*'` if the config allows everything
 *   - the request's `Origin` header verbatim if it appears in the
 *     allow-list (echoing the exact origin, NOT the wildcard, because
 *     `Access-Control-Allow-Credentials` is implied by some browsers
 *     when paired with bearer-token requests)
 *   - `null` if the request origin is not allowed (caller emits a
 *     401-ish response with no CORS headers — the browser will then
 *     surface a CORS failure to the dev console)
 */
export function resolveAllowedOrigin(request: Request, config: CorsConfig): string | null {
  if (config.allowOrigins.includes('*')) {
    return '*';
  }
  const origin = request.headers.get('origin');
  if (origin === null) {
    // Same-origin and server-to-server requests don't carry an Origin
    // header. We can't echo a value, but we shouldn't fail the
    // request either — return `null` and let the caller emit no
    // CORS header (browsers only enforce on cross-origin).
    return null;
  }
  return config.allowOrigins.includes(origin) ? origin : null;
}

/**
 * Build the headers map the response should carry. Includes the
 * allow-origin (when one matches) plus the exposed-headers + vary
 * needed so caches don't conflate cross-origin responses.
 */
export function corsResponseHeaders(request: Request, config: CorsConfig): Record<string, string> {
  const allowOrigin = resolveAllowedOrigin(request, config);
  const headers: Record<string, string> = {
    'access-control-expose-headers': EXPOSED_HEADERS,
    vary: 'Origin',
  };
  if (allowOrigin !== null) {
    headers['access-control-allow-origin'] = allowOrigin;
  }
  return headers;
}

/**
 * Handle a CORS preflight (`OPTIONS`) request. Returns a `Response`
 * if the request was a preflight, or `null` if the caller should
 * continue with normal request handling.
 */
export function handlePreflight(request: Request, config: CorsConfig): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }
  const allowOrigin = resolveAllowedOrigin(request, config);
  if (allowOrigin === null) {
    // Origin not allowed — explicit no-cors response. The browser
    // will surface this as a CORS error.
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': ALLOWED_METHODS,
      'access-control-allow-headers': ALLOWED_HEADERS,
      'access-control-max-age': MAX_AGE_SECONDS,
      vary: 'Origin',
    },
  });
}

/**
 * Header-name constants — exported for test assertions that don't
 * want to re-declare the literals.
 */
export const CORS_ALLOWED_HEADERS = ALLOWED_HEADERS;
export const CORS_ALLOWED_METHODS = ALLOWED_METHODS;
export const CORS_EXPOSED_HEADERS = EXPOSED_HEADERS;
