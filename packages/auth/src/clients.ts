// Supabase client factories for @binderly/auth.
//
// Two factories, two distinct trust postures:
//
//   1. `createUserScopedClient(jwt, env)` — built with the **anon**
//      key, but every PostgREST round-trip carries the user's
//      Authorization: Bearer <jwt> header. Postgres role inside
//      Supabase resolves to `authenticated`, RLS policies key
//      `auth.uid()` against the JWT's `sub` claim. This is the
//      client server-side code uses for everything that should
//      respect the user's permissions.
//
//   2. `createServiceRoleClient(env)` — built with the
//      **service-role** key. BYPASSRLS attribute on the role; can
//      read/write any row. Used **only** for elevated paths
//      (profile back-fill, admin tooling, webhook handlers). A
//      service-role client must never be returned to a code path
//      that handles user input.
//
// We disable session persistence on both — server-side code is
// stateless per request; the SDK's auto-refresh and storage paths
// are mobile/web-client concerns. Disabling them avoids accidental
// "cookie jar" leakage between requests in long-lived processes
// (Next.js dev server, Edge worker reuse).

import { createClient as supabaseCreateClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AuthEnv } from './types.js';

/**
 * Wire shape of the SDK's `createClient` so we can swap a stub in
 * during tests. Defaults to the real export from
 * `@supabase/supabase-js`. Test suites pass their own factory and
 * inspect the call args.
 */
export type CreateClientFn = (
  url: string,
  key: string,
  options?: Parameters<typeof supabaseCreateClient>[2],
) => SupabaseClient;

interface ClientFactoryDeps {
  readonly createClient?: CreateClientFn;
}

/**
 * Build a user-scoped Supabase client. Every PostgREST call it makes
 * carries `Authorization: Bearer <jwt>`, so RLS sees the request as
 * the JWT's subject and the role resolves to `authenticated`.
 *
 * The supplied JWT is **not** verified here — call sites typically
 * verify via `supabase.auth.getUser(jwt)` first (see
 * `requireUser`), then build the client with the same token. If
 * the token is invalid the next PostgREST call will fail with
 * `permission denied` at RLS time.
 */
export function createUserScopedClient(
  jwt: string,
  env: AuthEnv,
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
      // Server-side: never persist a session, never auto-refresh, never
      // listen for storage events. Each request stands alone.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Build a service-role Supabase client. BYPASSRLS, full DML on every
 * catalog table; treat the returned client as the trusted-tier
 * surface and never expose it to user input directly. Only call
 * sites are: profile back-fill (the safety net behind the DB
 * trigger), webhook handlers (RevenueCat / Paddle), admin-tool
 * code, and the migration / seed scripts in `data-pipeline/`.
 */
export function createServiceRoleClient(
  env: AuthEnv,
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
