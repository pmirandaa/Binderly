// Postgres / Supabase client factories for the Edge Functions.
//
// Two postures, mirroring `@binderly/auth/clients.ts`:
//
//   1. `createUserScopedClient(env, jwt)` — built with the **anon**
//      key + the caller's `Authorization: Bearer <jwt>` header on
//      every PostgREST round-trip. The Postgres role inside Supabase
//      resolves to `authenticated` and RLS keys `auth.uid()` to the
//      JWT's `sub`. This is the client every mutation handler uses.
//
//   2. `createServiceRoleClient(env)` — built with the **service-role**
//      key. BYPASSRLS attribute on the role; can read/write any row.
//      Used **only** for `recompute-set-completion` and similar
//      admin-style operations where the client doesn't have
//      permission to read aggregate state. Must never be returned to
//      a code path that takes user input directly.
//
// The actual `@supabase/supabase-js` `createClient` import is injected
// (`deps.createClient`) so tests can pass a fake. Production wires
// the real import via the `deno.jsonc` import-map.

import { createClient as supabaseCreateClient } from '@supabase/supabase-js';

import { decodeAuthHeader, type AuthClaims } from './auth.ts';
import { ApiError } from './errors.ts';

import type { SupabaseClient, AuthError as SupabaseAuthError, User } from '@supabase/supabase-js';

/**
 * Env contract — three Supabase keys + a CORS allow-list. Read from
 * `Deno.env` in production (see `v1/index.ts`); tests pass a
 * synthesized object.
 */
export interface EdgeFunctionEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceRoleKey: string;
  /** CORS allow-list — comma-separated list, `'*'` for "any". */
  readonly corsAllowOrigins: readonly string[];
  /**
   * RevenueCat **secret** REST API key, used by the entitlements
   * handler to read the source-of-truth entitlement state. OPTIONAL:
   * when unset (dev / not-yet-provisioned) the entitlements endpoint
   * degrades to free tier (fail-closed) rather than 500ing. Mirrors
   * the env-degrade posture T-PB-REVENUECAT + T-PB-PADDLE both use.
   */
  readonly revenueCatSecretApiKey?: string;
  /** RevenueCat REST base URL override (defaults to api.revenuecat.com). */
  readonly revenueCatApiBaseUrl?: string;
}

/**
 * Wire shape of `@supabase/supabase-js#createClient` — declared
 * locally so we can swap a stub in. Real export is the default.
 */
export type CreateClientFn = (
  url: string,
  key: string,
  options?: Parameters<typeof supabaseCreateClient>[2],
) => SupabaseClient;

/**
 * Minimal `fetch`-like callable used by handlers that make outbound
 * HTTP calls (e.g. the entitlements handler reading RevenueCat). Tests
 * inject a stub; production falls through to `globalThis.fetch`.
 */
export type EdgeFetch = (
  input: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Dependencies the factories + handlers accept for testability. */
export interface ClientFactoryDeps {
  readonly createClient?: CreateClientFn;
  /** Outbound fetch seam — only the entitlements handler uses it today. */
  readonly fetch?: EdgeFetch;
}

/**
 * Build a user-scoped Supabase client. Every PostgREST call carries
 * `Authorization: Bearer <jwt>` so RLS sees the request as the JWT's
 * subject and the role resolves to `authenticated`.
 *
 * The supplied JWT is **not** verified here — call sites typically
 * verify via `requireUser()` first (which round-trips through
 * `supabase.auth.getUser(jwt)`). If the token is invalid the next
 * PostgREST call fails with `permission denied` at RLS time.
 */
export function createUserScopedClient(
  env: EdgeFunctionEnv,
  jwt: string,
  deps: ClientFactoryDeps = {},
): SupabaseClient {
  const create = deps.createClient ?? supabaseCreateClient;
  if (typeof jwt !== 'string' || jwt.length === 0) {
    throw new Error('createUserScopedClient: jwt must be a non-empty string.');
  }
  return create(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Build a service-role Supabase client. BYPASSRLS, full DML on every
 * application table; treat the returned client as the trusted-tier
 * surface and never expose it to user input directly.
 */
export function createServiceRoleClient(
  env: EdgeFunctionEnv,
  deps: ClientFactoryDeps = {},
): SupabaseClient {
  const create = deps.createClient ?? supabaseCreateClient;
  return create(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Resolved authenticated session — what every mutation handler
 * receives once `requireUser()` has cleared the request.
 */
export interface AuthenticatedSession {
  readonly user: User;
  readonly claims: AuthClaims;
  readonly token: string;
  readonly supabase: SupabaseClient;
}

/**
 * Read the `Authorization` header, decode the JWT locally, build a
 * user-scoped Supabase client, then round-trip through
 * `supabase.auth.getUser(token)` to verify the signature + not-revoked
 * status. Returns `{ user, claims, token, supabase }` on success;
 * throws `ApiError({ code: 'AUTH' })` on any failure.
 *
 * The `supabase` field is the *same* user-scoped client whose
 * subsequent calls will RLS-resolve to the same user. Handlers reuse
 * it for their actual DB work.
 */
export async function requireUser(
  request: Request,
  env: EdgeFunctionEnv,
  deps: ClientFactoryDeps = {},
): Promise<AuthenticatedSession> {
  const { token, claims } = decodeAuthHeader(request.headers);
  const supabase = createUserScopedClient(env, token, deps);
  const { data, error } = await supabase.auth.getUser(token);
  if (error !== null) {
    throw translateSupabaseAuthError(error);
  }
  if (data.user === null) {
    throw new ApiError('AUTH', 'Supabase returned no user for the supplied token.');
  }
  return { user: data.user, claims, token, supabase };
}

function translateSupabaseAuthError(error: SupabaseAuthError): ApiError {
  const status = typeof error.status === 'number' ? error.status : undefined;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = error.message || 'Supabase rejected the access token.';
  if (code === 'session_expired' || code === 'token_expired') {
    return new ApiError('AUTH', message);
  }
  if (status !== undefined && status >= 500) {
    return new ApiError('INTERNAL', `Supabase upstream error: ${message}`);
  }
  return new ApiError('AUTH', message);
}

/**
 * Translate a PostgREST error response into the canonical envelope.
 * Used by every handler that does a `supabase.from(...).insert/update/
 * delete/select` round-trip and gets a non-null `error`.
 *
 * Common code mappings (see https://supabase.com/docs/guides/database/postgres/error-codes):
 *
 *   - `'PGRST116'` (no rows when `.single()` was expected) → `NOT_FOUND`
 *   - `'23505'` (unique_violation) → `CONFLICT`
 *   - `'42501'` (insufficient_privilege — RLS denial) → `AUTH`
 *   - `'P0001'` (raise_exception — used by triggers) → `VALIDATION`
 *   - anything else → `INTERNAL`
 */
export function translatePostgrestError(error: {
  readonly code?: string;
  readonly message: string;
  readonly details?: string | null;
  readonly hint?: string | null;
}): ApiError {
  const code = error.code ?? '';
  // Wrap PG's stringly-typed `details` into an object so the wire body
  // ends up `{ details: { details: '...' } }` — keeps the schema open
  // for additional PG fields (`hint`, `column`, …) without breaking
  // existing consumers that read `details.details`.
  const detailsPayload =
    error.details !== undefined && error.details !== null ? { details: error.details } : undefined;
  switch (code) {
    case 'PGRST116':
      return new ApiError('NOT_FOUND', error.message, { details: detailsPayload });
    case '23505':
      return new ApiError('CONFLICT', error.message, { details: detailsPayload });
    case '42501':
      return new ApiError('AUTH', error.message, { status: 403, details: detailsPayload });
    case 'P0001':
      return new ApiError('VALIDATION', error.message, { details: detailsPayload });
    default:
      return new ApiError('INTERNAL', error.message, { details: detailsPayload });
  }
}
