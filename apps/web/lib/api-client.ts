// `@binderly/api-client` browser singleton.
//
// Constructed lazily on first use, with:
//   - baseUrl + apiKey from `lib/env.ts`
//   - `getJwt` callback that reads the current session from the
//     same Supabase JS singleton the AuthProvider subscribes to
//   - `supabaseAuth` shared with the AuthProvider so sign-in /
//     sign-out / session-change events round-trip through one
//     SDK instance.
//
// This is the ONLY place feature code obtains an api-client
// instance. Direct `fetch` to backend resources is forbidden by
// `rules/04-web.md` — every consumer goes through the typed
// resource methods exposed here.

import { createClient, type BinderlyClient } from '@binderly/api-client';

import { loadWebEnv } from './env';
import { getBrowserSupabase } from './supabase-browser';

let cached: BinderlyClient | null = null;

/**
 * Returns the singleton api-client. Construction is cheap — it's
 * memoized across the app so components don't repeatedly rebuild
 * the resource namespaces.
 */
export function getApiClient(): BinderlyClient {
  if (cached !== null) return cached;
  const env = loadWebEnv();
  const supabase = getBrowserSupabase();
  cached = createClient({
    baseUrl: env.supabaseUrl,
    apiKey: env.supabaseAnonKey,
    getJwt: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    supabaseAuth: supabase,
    defaultHeaders: { 'x-binderly-app': 'web' },
  });
  return cached;
}

/** Test-only: drop the cached singleton so a fresh build can use stub deps. */
export function __resetApiClientForTests(): void {
  cached = null;
}
