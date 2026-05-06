// Root layout — the single place every provider mounts.
//
// Tree (top → bottom):
//   <EnvGate>                 # boot-time env validation
//     <ErrorBoundary>          # catches downstream throws (ApiError, etc.)
//       <ThemeOverrideProvider># resolves system + user override into a ThemeName,
//         <UIProvider>         # mounts Tamagui (handled inside ThemeOverrideProvider)
//           <SafeAreaProvider> # respects notches / status bars
//             <SupabaseAndApiClientProvider> # builds singletons once
//               <AuthProvider> # subscribes to Supabase auth state
//                 <QueryProvider> # TanStack Query w/ NetInfo bridge
//                   <Stack/>   # expo-router root stack
//
// expo-router requires a default export here; the route tree uses
// it as the root layout.

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '../src/components/error/ErrorBoundary';
import {
  AuthProvider,
  EnvGate,
  QueryProvider,
  ThemeOverrideProvider,
} from '../src/components/providers';
import { ApiClientProvider, createMobileApiClient } from '../src/lib/api-client';
import { createSupabaseMobileClient } from '../src/lib/supabase-mobile';

import type { MobileEnv } from '../src/lib/env';

export default function RootLayout(): ReactNode {
  return (
    <ThemeOverrideProvider>
      <ErrorBoundary>
        <EnvGate>
          {(env) => (
            <SafeAreaProvider>
              <SupabaseAndApiClientProvider env={env}>
                {(supabase, apiClient) => (
                  <AuthProvider supabase={supabase}>
                    <QueryProvider>
                      <ApiClientProvider client={apiClient}>
                        <StatusBar style="auto" />
                        <Stack screenOptions={{ headerShown: false }}>
                          <Stack.Screen name="(tabs)" />
                          <Stack.Screen name="auth" options={{ presentation: 'modal' }} />
                          <Stack.Screen name="+not-found" />
                        </Stack>
                      </ApiClientProvider>
                    </QueryProvider>
                  </AuthProvider>
                )}
              </SupabaseAndApiClientProvider>
            </SafeAreaProvider>
          )}
        </EnvGate>
      </ErrorBoundary>
    </ThemeOverrideProvider>
  );
}

interface SupabaseAndApiClientProviderProps {
  env: MobileEnv;
  children: (
    supabase: ReturnType<typeof createSupabaseMobileClient>,
    apiClient: ReturnType<typeof createMobileApiClient>,
  ) => ReactNode;
}

/**
 * Builds the Supabase + api-client singletons exactly once for the
 * resolved env. `useMemo` keyed on the env URL keeps the same
 * instances across re-renders without leaking a closure between
 * env-mismatched mounts.
 */
function SupabaseAndApiClientProvider(props: SupabaseAndApiClientProviderProps): ReactNode {
  const { env, children } = props;
  const supabase = useMemo(() => createSupabaseMobileClient(env), [env]);
  const apiClient = useMemo(() => createMobileApiClient(env, supabase), [env, supabase]);
  return <>{children(supabase, apiClient)}</>;
}
