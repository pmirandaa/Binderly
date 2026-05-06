// Browser Supabase JS singleton. The `<AuthProvider>` listens to
// this instance for session changes; the api-client's `getJwt`
// pulls the freshest access token from it. One SDK instance per
// browser session keeps the auth state machine consistent.
//
// Server-side code uses `@binderly/auth` instead — never import
// this module from `'use server'` or RSC code.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadWebEnv } from './env';

let cached: SupabaseClient | null = null;

/**
 * Lazy-build the browser Supabase client. Idempotent — the second
 * call returns the same instance so the SDK's `onAuthStateChange`
 * subscribers all see the same store.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (cached !== null) return cached;
  const env = loadWebEnv();
  cached = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}

/** Test-only: drop the cached singleton so a fresh load picks up new env. */
export function __resetBrowserSupabaseForTests(): void {
  cached = null;
}
