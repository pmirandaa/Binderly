// Server-side session primitives for @binderly/auth.
//
// `requireUser(request, env)` is the canonical entry point: extract
// the bearer token, validate it via Supabase, decode the canonical
// claims, and return an `AuthenticatedSession` with the user, the
// claims, and a user-scoped Supabase client RLS will key against
// `auth.uid() = sub`.
//
// Every error path is a typed {@link AuthError} so call sites can
// branch deterministically and translate into the
// `{ ok: false, error: { code } }` API shape:
//
//   - missing_token       — header absent / empty
//   - invalid_token       — wrong scheme, malformed JWT, role mismatch
//   - expired_token       — exp <= now (or Supabase reports expired)
//   - service_unavailable — Supabase upstream timeout / 5xx
//
// Note: this module deliberately doesn't catch Supabase's
// own `AuthError` class and rethrow as ours — the SDK error is
// returned in the data/error tuple, so we inspect that and translate.

import { createUserScopedClient, type CreateClientFn } from './clients.js';
import { AuthError } from './errors.js';
import { decodeClaims, extractBearerToken, isExpired } from './jwt.js';

import type { AuthClaims, AuthenticatedSession, AuthEnv, RequireUserOptions } from './types.js';
import type { AuthError as SupabaseAuthError, SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Minimal request-like shape `requireUser` and `getSessionFromRequest`
 * can read headers from. `Request` (Web standard, used by Next.js
 * Route Handlers and Edge Functions) satisfies this; Node `IncomingMessage`
 * does too via `req.headers`. Callers that already have a token in
 * hand should call {@link verifyAccessToken} directly.
 */
export interface RequestLike {
  readonly headers: Headers | Readonly<Record<string, string | string[] | undefined>>;
}

/** Options for {@link requireUser} that allow swapping the underlying client factory in tests. */
export interface RequireUserDeps {
  readonly createClient?: CreateClientFn;
}

/**
 * Resolve an `AuthenticatedSession` from a Web `Request`-like object.
 * Throws {@link AuthError} with a stable `code` for every failure
 * path. Returns the user, their canonical claims, and a Supabase
 * client whose every PostgREST call carries the user's bearer token.
 */
export async function requireUser(
  request: RequestLike,
  env: AuthEnv,
  options: RequireUserOptions = {},
  deps: RequireUserDeps = {},
): Promise<AuthenticatedSession> {
  const token = extractBearerToken(request.headers, options.headerName);
  return verifyAccessToken(token, env, deps);
}

/**
 * Like {@link requireUser} but returns `null` instead of throwing on
 * missing-token. Useful for endpoints that are public-by-default but
 * want to opportunistically read user state when present (e.g. a
 * shareable page that highlights "you own this card" if logged in).
 *
 * Still throws on invalid/expired tokens — those represent a *bad*
 * client state, not "anonymous user".
 */
export async function getSessionFromRequest(
  request: RequestLike,
  env: AuthEnv,
  options: RequireUserOptions = {},
  deps: RequireUserDeps = {},
): Promise<AuthenticatedSession | null> {
  try {
    return await requireUser(request, env, options, deps);
  } catch (error) {
    if (error instanceof AuthError && error.code === 'missing_token') {
      return null;
    }
    throw error;
  }
}

/**
 * Verify a raw JWT against Supabase. The token is decoded for claims
 * (a quick reject for malformed tokens), then validated via
 * `supabase.auth.getUser(token)` (the SDK's wire-trust boundary). If
 * Supabase reports the token expired, or the local clock-skew check
 * trips, throws `expired_token`.
 *
 * On success returns `{ user, claims, supabase }` — the supabase
 * client is built with the *same* token so PostgREST round-trips
 * resolve to the JWT's subject under RLS.
 */
export async function verifyAccessToken(
  token: string,
  env: AuthEnv,
  deps: RequireUserDeps = {},
): Promise<AuthenticatedSession> {
  const claims = decodeClaims(token);
  if (claims.role !== 'authenticated') {
    throw new AuthError(
      'invalid_token',
      `JWT \`role\` claim must be \`authenticated\` (got \`${claims.role}\`).`,
    );
  }
  if (isExpired(claims)) {
    throw new AuthError('expired_token', 'JWT `exp` claim is in the past.');
  }
  const supabase = createUserScopedClient(token, env, deps);
  const user = await fetchUser(supabase, token);
  return { user, claims, supabase };
}

/**
 * Round-trip the token through Supabase to validate the signature +
 * not-revoked status. Translates SDK errors into our typed
 * {@link AuthError} taxonomy.
 */
async function fetchUser(supabase: SupabaseClient, token: string): Promise<User> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error !== null) {
    throw translateSupabaseError(error);
  }
  return data.user;
}

function translateSupabaseError(error: SupabaseAuthError): AuthError {
  // Supabase tags some error codes that map cleanly:
  //   - 'session_not_found' / 'bad_jwt' / 'invalid_credentials' → invalid_token
  //   - 'pkce_grant_code_exchange'                              → invalid_token
  //   - status === 401 with code 'session_expired'              → expired_token
  //   - status >= 500                                           → service_unavailable
  //   - everything else                                         → invalid_token (safe default)
  const status = typeof error.status === 'number' ? error.status : undefined;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = error.message || 'Supabase rejected the access token.';
  if (code === 'session_expired' || code === 'token_expired') {
    return new AuthError('expired_token', message, { cause: error });
  }
  if (status !== undefined && status >= 500) {
    return new AuthError('service_unavailable', `Supabase upstream error: ${message}`, {
      cause: error,
    });
  }
  return new AuthError('invalid_token', message, { cause: error });
}

/** Re-export of the canonical {@link AuthClaims} shape for callers' convenience. */
export type { AuthClaims };
