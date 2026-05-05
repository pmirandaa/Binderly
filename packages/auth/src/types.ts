// Internal types for @binderly/auth.
//
// These mirror the shapes server-side callers (Edge Functions, Next.js
// Route Handlers, Server Actions) interact with. We deliberately do
// NOT depend on `@binderly/api-contracts` from this package — that
// sibling task is in flight in parallel. The downstream
// `@binderly/api-client` package is what stitches the two together.

import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Supabase env-var triple. The user-scoped client is built from the URL
 * + anon key + the request's bearer JWT; the service-role client is
 * built from the URL + service-role key. Callers pass this in once at
 * boot (typically constructed via {@link loadAuthEnv}).
 */
export interface AuthEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceRoleKey: string;
}

/**
 * Decoded JWT claims we surface to callers. Supabase JWTs carry more
 * fields, but these are the ones the application layer actually
 * needs — the rest is intentionally opaque so we don't lock ourselves
 * to a particular Supabase JWT version.
 *
 * `sub` is the auth user UUID and is the value RLS policies key
 * `auth.uid()` against. `role` is one of `authenticated`, `anon`, or
 * `service_role`; sessions returned by {@link requireUser} are
 * always `authenticated`.
 */
export interface AuthClaims {
  readonly sub: string;
  readonly role: 'authenticated' | 'anon' | 'service_role';
  readonly email?: string;
  /** Unix epoch seconds. */
  readonly exp: number;
  /** Unix epoch seconds. */
  readonly iat: number;
  /** Auth method: `oauth` (Google/Apple/Discord), `magiclink`, etc. */
  readonly aal?: string;
  /** Free-form claims the caller can inspect when needed. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * An authenticated server-side session. Returned by {@link requireUser}.
 *
 * The `supabase` field is the **user-scoped** client — every PostgREST
 * call it makes carries the request's `Authorization: Bearer <jwt>`
 * header, so RLS policies key `auth.uid()` to the same user the JWT
 * authenticated. Server-side code that needs to bypass RLS (e.g.
 * back-fill a profile after an admin tool purges one) builds a
 * separate client via {@link createServiceRoleClient}.
 */
export interface AuthenticatedSession {
  readonly user: User;
  readonly claims: AuthClaims;
  readonly supabase: SupabaseClient;
}

/**
 * The application-level row state {@link provisionProfile} guarantees.
 * The DB trigger in `0017_profile_provisioning_trigger.sql` is the
 * primary path; this is the belt-and-braces fallback signal.
 */
export interface ProvisionedProfile {
  readonly userId: string;
  /** True if the helper actually inserted the row; false if it was already present. */
  readonly inserted: boolean;
  readonly handle: string;
}

/**
 * Optional knobs accepted by {@link requireUser}. None are required —
 * the defaults match the canonical "authenticated user, JWT in
 * `Authorization: Bearer <token>`" pattern.
 */
export interface RequireUserOptions {
  /**
   * Override the default header name (`authorization`). Useful for
   * proxied environments that rewrite the header (e.g. some Vercel
   * middleware setups).
   */
  readonly headerName?: string;
}
