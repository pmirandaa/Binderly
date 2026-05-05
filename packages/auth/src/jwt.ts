// JWT extraction + decode helpers for @binderly/auth.
//
// We deliberately do NOT verify the JWT signature here — verification
// is delegated to `supabase.auth.getUser(token)`, which round-trips
// to GoTrue and returns a typed `User` plus a discriminated
// data/error shape. The decode helper below ONLY parses the base64
// JSON payload so we can surface the canonical claims (sub, role,
// exp, iat, email) to callers; the `User` returned by the SDK is the
// trust boundary, not the decoded payload.
//
// Any decoder that "verifies" a JWT without round-tripping to the
// auth server has to maintain JWKS state. That's a different task
// (T-BE-EDGE-FUNCTIONS may want it for cold-start latency reasons);
// here we keep the dependency surface minimal.

import { AuthError } from './errors.js';

import type { AuthClaims } from './types.js';

const BEARER_PREFIX = 'bearer ';

/**
 * Pull the raw JWT out of an `Authorization: Bearer <token>` header.
 * Throws {@link AuthError} with code `missing_token` (header absent
 * entirely or empty) or `invalid_token` (header present but doesn't
 * start with `Bearer ` or has an empty token after the prefix).
 *
 * Header lookup is case-insensitive — Web standard `Headers` is
 * already case-insensitive; for plain `Record<string, string>` bags
 * we fall back to a case-insensitive scan.
 */
export function extractBearerToken(
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
  headerName = 'authorization',
): string {
  const raw = readHeaderValue(headers, headerName);
  if (raw === undefined || raw.length === 0) {
    throw new AuthError(
      'missing_token',
      `request is missing the ${headerName} header (no Bearer token to authenticate against).`,
    );
  }
  const lower = raw.toLowerCase();
  if (!lower.startsWith(BEARER_PREFIX)) {
    throw new AuthError(
      'invalid_token',
      `request ${headerName} header does not use the "Bearer <token>" scheme.`,
    );
  }
  const token = raw.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) {
    throw new AuthError(
      'invalid_token',
      `request ${headerName} header has the Bearer prefix but no token value.`,
    );
  }
  return token;
}

/**
 * Decode the JWT *payload* (claims) without verifying the signature.
 * Use this only after `supabase.auth.getUser(token)` has confirmed
 * the token is valid. Throws `AuthError({ code: 'invalid_token' })`
 * if the structure is malformed. The signature-verification path is
 * the SDK's `getUser`; do not confuse the two.
 */
export function decodeClaims(token: string): AuthClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError(
      'invalid_token',
      'JWT does not have three dot-separated segments; cannot decode claims.',
    );
  }
  const payloadSegment = parts[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    throw new AuthError('invalid_token', 'JWT payload segment is empty.');
  }
  let payload: unknown;
  try {
    const json = decodeBase64Url(payloadSegment);
    payload = JSON.parse(json);
  } catch (cause) {
    throw new AuthError('invalid_token', 'JWT payload segment is not valid base64url JSON.', {
      cause,
    });
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new AuthError('invalid_token', 'JWT payload is not a JSON object.');
  }
  const claimsObject = payload as Record<string, unknown>;
  const sub = claimsObject['sub'];
  const role = claimsObject['role'];
  const exp = claimsObject['exp'];
  const iat = claimsObject['iat'];
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new AuthError('invalid_token', 'JWT payload is missing a non-empty `sub` claim.');
  }
  if (role !== 'authenticated' && role !== 'anon' && role !== 'service_role') {
    throw new AuthError(
      'invalid_token',
      `JWT payload has unexpected \`role\` claim (got ${typeof role === 'string' ? `"${role}"` : typeof role}).`,
    );
  }
  if (typeof exp !== 'number') {
    throw new AuthError('invalid_token', 'JWT payload is missing a numeric `exp` claim.');
  }
  if (typeof iat !== 'number') {
    throw new AuthError('invalid_token', 'JWT payload is missing a numeric `iat` claim.');
  }
  const email = typeof claimsObject['email'] === 'string' ? claimsObject['email'] : undefined;
  const aal = typeof claimsObject['aal'] === 'string' ? claimsObject['aal'] : undefined;
  return {
    sub,
    role,
    exp,
    iat,
    ...(email !== undefined ? { email } : {}),
    ...(aal !== undefined ? { aal } : {}),
    raw: claimsObject,
  };
}

/**
 * Returns true if the claims' `exp` is at or before the supplied
 * epoch-seconds value (defaults to `now()`). The 30-second skew
 * mirrors the leeway Supabase's own clients use when refreshing
 * tokens — keeps clients on slightly-fast clocks from drowning
 * in spurious 401s.
 */
export function isExpired(claims: AuthClaims, nowSeconds: number = currentEpochSeconds()): boolean {
  const SKEW_SECONDS = 30;
  return claims.exp <= nowSeconds - SKEW_SECONDS;
}

function currentEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function readHeaderValue(
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  if (isHeaders(headers)) {
    return headers.get(name) ?? undefined;
  }
  // Plain object — case-insensitive scan.
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      if (Array.isArray(value)) return value[0];
      return value;
    }
  }
  return undefined;
}

function isHeaders(value: unknown): value is Headers {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof (value as { get: unknown }).get === 'function'
  );
}

/**
 * Decode a base64url-encoded string to UTF-8. Pure JS so it works in
 * Node, Edge runtimes, and Vitest without polyfills.
 */
function decodeBase64Url(segment: string): string {
  // base64url -> base64 (replace url-safe chars + pad).
  let base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding === 2) base64 += '==';
  else if (padding === 3) base64 += '=';
  else if (padding !== 0) {
    throw new Error(`base64url segment has invalid padding length (${padding}).`);
  }
  // Buffer is available in Node and on Edge runtimes that polyfill it
  // (Vercel Edge, Cloudflare Workers, Supabase Edge Functions all do).
  // Fall back to atob + TextDecoder for the rare runtime that doesn't.
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(base64, 'base64').toString('utf8');
  }
  // atob is web-standard; if it's missing too the runtime is broken.
  // Cast through `unknown` so we don't depend on `lib.dom`.
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
