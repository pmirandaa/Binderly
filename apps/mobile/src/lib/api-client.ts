// Singleton factory + React context for the Binderly API client.
//
// The factory builds a `BinderlyClient` (`@binderly/api-client`)
// wired to:
//
//   - the env URL (with `EXPO_PUBLIC_API_URL` overriding the
//     Supabase URL when set),
//   - the Supabase anon key from env,
//   - a `getJwt` callback that reads the live Supabase JS session
//     so refreshes are picked up at call time,
//   - the same Supabase JS instance used by the AuthProvider, so
//     the SDK's session listener and the api-client's `getJwt`
//     callback resolve from one source of truth.
//
// The React context exposes the singleton via `useApiClient()` so
// feature code never imports the singleton directly — easier to
// mock under tests.

import { createContext, createElement, useContext, type ReactNode } from 'react';

import { createClient as createBinderlyClient, type BinderlyClient } from '@binderly/api-client';

import type { MobileEnv } from './env';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Construct a {@link BinderlyClient} wired for the mobile runtime.
 * Idempotent and side-effect free; safe to invoke once at module
 * load and pin to a constant.
 */
export function createMobileApiClient(env: MobileEnv, supabase: SupabaseClient): BinderlyClient {
  return createBinderlyClient({
    baseUrl: env.apiBaseUrl,
    apiKey: env.supabaseAnonKey,
    getJwt: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    supabaseAuth: supabase,
    defaultHeaders: { 'x-binderly-app': 'mobile' },
  });
}

const ApiClientContext = createContext<BinderlyClient | null>(null);

export interface ApiClientProviderProps {
  client: BinderlyClient;
  children: ReactNode;
}

/**
 * Provide a {@link BinderlyClient} instance to the React tree. Use
 * `useApiClient()` to consume.
 */
export function ApiClientProvider(props: ApiClientProviderProps): ReactNode {
  return createElement(ApiClientContext.Provider, { value: props.client }, props.children);
}

/**
 * Read the {@link BinderlyClient} from React context. Throws when
 * no provider is mounted (helps surface boot-tree wiring bugs
 * loudly instead of crashing inside a network call).
 */
export function useApiClient(): BinderlyClient {
  const client = useContext(ApiClientContext);
  if (client === null) {
    throw new Error(
      'useApiClient(): no <ApiClientProvider> found in the tree. Mount the provider in app/_layout.tsx.',
    );
  }
  return client;
}
