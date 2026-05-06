// Mobile-flavoured Supabase JS client.
//
// We construct the SDK manually (instead of letting `@binderly/api-client`'s
// `createClient(...)` build its own) for two reasons:
//
//   1. We need to wire `expo-secure-store` as the auth-session storage
//      adapter — JWTs MUST be encrypted at rest on device. Using the
//      SDK's default storage (AsyncStorage) is forbidden by the stage
//      rules and the task brief.
//   2. We share the same Supabase client between the api-client (for
//      data calls) and the AuthProvider (for session subscriptions),
//      so the live session listener and the api-client's `getJwt`
//      callback resolve from one source of truth.
//
// The api-client constructed in `api-client.ts` consumes this
// instance via the `supabaseAuth` config option.

import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { AppState, type NativeEventSubscription, Platform } from 'react-native';

import { supabaseSecureStoreAdapter } from './secure-storage';

import type { MobileEnv } from './env';

/**
 * Build a Supabase JS client wired with the secure-store adapter and
 * RN-friendly defaults. Construction is cheap and idempotent;
 * callers cache the result.
 */
export function createSupabaseMobileClient(env: MobileEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      // JWTs encrypted at rest via Keychain / Keystore.
      storage: supabaseSecureStoreAdapter,
      // RN/Expo defaults: persist + auto-refresh between launches,
      // skip URL detection (deep-link callbacks are handled by
      // T-M-AUTH's exchange-code-for-session flow, not the SDK's
      // built-in `detectSessionInUrl` which targets browsers).
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        // Helps server-side log analysis distinguish mobile vs web
        // calls without leaking PII.
        'x-binderly-app': 'mobile',
      },
    },
  });
}

/**
 * Wire RN's AppState into the Supabase auto-refresh loop. Supabase
 * recommends pausing the refresh poll when the app is backgrounded
 * to avoid stale-tab refreshes; resume on foreground. Returns a
 * subscription the caller can `.remove()` on unmount.
 *
 * The `Platform.OS === 'web'` branch is a no-op so the same code
 * compiles under jsdom tests.
 */
export function startAuthAutoRefresh(client: SupabaseClient): NativeEventSubscription | null {
  if (Platform.OS === 'web') return null;
  return AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void client.auth.startAutoRefresh();
    } else {
      void client.auth.stopAutoRefresh();
    }
  });
}
