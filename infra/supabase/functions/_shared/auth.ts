// Auth helpers for the Edge Functions.
//
// We re-implement the relevant subset of `@binderly/auth` here rather
// than import it. Three reasons:
//
//   1. Production deploy story — the supabase CLI bundles the
//      function and its imports; pulling `@binderly/auth` into the
//      bundle requires either a relative-path import (brittle: the
//      package's own dependency on `@supabase/supabase-js` would
//      double-bundle) or a published package (we don't publish).
//      Mirroring the small subset we need (bearer-token extraction,
//      JWT claim decoding, expiry check) is simpler and stable.
//
//   2. Isolation — the Edge Function bundle should be pinned per
//      deploy. If `@binderly/auth` evolves, we want a deliberate
//      bump, not an implicit one through `pnpm install`.
//
//   3. Trust-boundary clarity — the actual signature verification
//      goes through `supabase.auth.getUser(token)` (see `db.ts`).
//      The local decode is purely for "extract `sub` so we can fail
//      fast on obviously bad tokens"; the real validation is the
//      Supabase round-trip. Keeping the helper local makes that
//      separation explicit.
//
// The mirror tests in `auth.test.ts` round-trip a token built with
// the same shape `@binderly/auth` produces, so any drift is caught.

import { ApiError } from './errors.ts';

const BEARER_PREFIX = 'bearer ';
const CLOCK_SKEW_SECONDS = 30;

/**
 * Decoded JWT claims we surface to handlers. Mirrors the
 * `AuthClaims` interface in `@binderly/auth/types.ts` minus the
 * `raw` field (Edge Functions don't currently need the free-form
 * claim bag, and trimming it shrinks the surface).
 */
export interface AuthClaims {
  readonly sub: string;
  readonly role: 'authenticated' | 'anon' | 'service_role';
  readonly email?: string;
  readonly exp: number;
  readonly iat: number;
}

/**
 * Pull the raw JWT out of an `Authorization: Bearer <token>` header.
 * Throws an `ApiError` with code `AUTH` when:
 *
 *   - the header is absent / empty (`status: 401`),
 *   - the header value doesn't start with `Bearer ` (`status: 401`),
 *   - the value after the prefix is empty (`status: 401`).
 */
export function extractBearerToken(headers: Headers): string {
  const raw = headers.get('authorization');
  if (raw === null || raw.length === 0) {
    throw new ApiError('AUTH', 'Missing Authorization header.');
  }
  const lower = raw.toLowerCase();
  if (!lower.startsWith(BEARER_PREFIX)) {
    throw new ApiError('AUTH', 'Authorization header must use the "Bearer <token>" scheme.');
  }
  const token = raw.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) {
    throw new ApiError('AUTH', 'Authorization header has Bearer prefix but no token.');
  }
  return token;
}

/**
 * Decode the JWT *payload* without verifying the signature. Throws
 * `ApiError({ code: 'AUTH' })` if the structure is malformed or the
 * canonical claims are missing.
 *
 * Signature verification is delegated to `supabase.auth.getUser(token)`
 * — see `verifyToken()` below. The local decode is only used to
 * produce a `sub` that handlers can pass into log lines and to fail
 * fast on obviously broken tokens.
 */
export function decodeClaims(token: string): AuthClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new ApiError('AUTH', 'JWT does not have three dot-separated segments.');
  }
  const payloadSegment = parts[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    throw new ApiError('AUTH', 'JWT payload segment is empty.');
  }
  let payload: unknown;
  try {
    const json = decodeBase64Url(payloadSegment);
    payload = JSON.parse(json);
  } catch {
    throw new ApiError('AUTH', 'JWT payload segment is not valid base64url JSON.');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ApiError('AUTH', 'JWT payload is not a JSON object.');
  }
  const claimsObject = payload as Record<string, unknown>;
  const sub = claimsObject['sub'];
  const role = claimsObject['role'];
  const exp = claimsObject['exp'];
  const iat = claimsObject['iat'];
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new ApiError('AUTH', 'JWT payload is missing a non-empty `sub` claim.');
  }
  if (role !== 'authenticated' && role !== 'anon' && role !== 'service_role') {
    throw new ApiError('AUTH', 'JWT payload has unexpected `role` claim.');
  }
  if (typeof exp !== 'number') {
    throw new ApiError('AUTH', 'JWT payload is missing a numeric `exp` claim.');
  }
  if (typeof iat !== 'number') {
    throw new ApiError('AUTH', 'JWT payload is missing a numeric `iat` claim.');
  }
  const email =
    typeof claimsObject['email'] === 'string' ? (claimsObject['email'] as string) : undefined;
  return {
    sub,
    role,
    exp,
    iat,
    ...(email !== undefined ? { email } : {}),
  };
}

/**
 * Returns `true` when the claims' `exp` is at or before the supplied
 * epoch-seconds value (defaults to `now()`). The 30-second skew
 * mirrors the leeway Supabase's clients use when refreshing tokens —
 * keeps users on slightly-fast clocks from drowning in spurious 401s.
 */
export function isExpired(claims: AuthClaims, nowSeconds: number = currentEpochSeconds()): boolean {
  return claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS;
}

/**
 * Extract + decode + locally-validate the JWT in one call. Throws
 * `ApiError({ code: 'AUTH' })` on any failure.
 *
 * The returned claims have NOT been signature-verified; the bundled
 * `verifyTokenWithSupabase` (in `db.ts`) is the trust boundary.
 * Handlers typically call `requireUser(...)` from `db.ts`, which
 * stitches both halves together.
 */
export function decodeAuthHeader(headers: Headers): { token: string; claims: AuthClaims } {
  const token = extractBearerToken(headers);
  const claims = decodeClaims(token);
  if (claims.role !== 'authenticated') {
    throw new ApiError(
      'AUTH',
      `JWT \`role\` claim must be \`authenticated\` (got \`${claims.role}\`).`,
    );
  }
  if (isExpired(claims)) {
    throw new ApiError('AUTH', 'JWT `exp` claim is in the past.');
  }
  return { token, claims };
}

function currentEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function decodeBase64Url(segment: string): string {
  let base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding === 2) base64 += '==';
  else if (padding === 3) base64 += '=';
  else if (padding !== 0) {
    throw new Error(`base64url segment has invalid padding length (${padding}).`);
  }
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(base64, 'base64').toString('utf8');
  }
  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof atobFn !== 'function') {
    throw new Error('No base64 decoder available (neither Buffer nor atob).');
  }
  const binary = atobFn(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Test-only: header-name + clock-skew constants.
 */
export const BEARER_PREFIX_CONST = BEARER_PREFIX;
export const CLOCK_SKEW_SECONDS_CONST = CLOCK_SKEW_SECONDS;
