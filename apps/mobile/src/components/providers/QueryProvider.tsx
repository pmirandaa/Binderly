// `<QueryProvider>` — TanStack Query's `<QueryClientProvider>`
// pre-configured with React Native-friendly defaults.
//
// Two RN-specific concerns:
//
//   1. **Network mode.** TanStack Query's default `'online'` mode
//      pauses every query when the browser reports offline. RN apps
//      with our offline posture (T-OF-LOCAL-DB, stage 9) prefer
//      `'offlineFirst'` — fire the query optimistically; let the
//      cache + sync engine handle reconciliation.
//
//   2. **App-level network awareness.** We bridge
//      `@react-native-community/netinfo` into TanStack Query's
//      `onlineManager` so cancellations / refetch-on-reconnect work
//      without a window object.
//
// The provider exposes the singleton `QueryClient` via context;
// callers use `useQueryClient()` from `@tanstack/react-query`
// directly (we don't re-export to avoid surface duplication).

import NetInfo from '@react-native-community/netinfo';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

export interface QueryProviderProps {
  /**
   * Optional pre-configured client (tests inject a fresh instance
   * with `staleTime: 0`). Defaults to a shell-provided singleton
   * with sensible RN defaults.
   */
  client?: QueryClient;
  children: ReactNode;
}

/**
 * Build a `QueryClient` with shell defaults. Exported separately
 * so feature tasks can reuse the same defaults without copying.
 */
export function createMobileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Render stale data while revalidating on focus / reconnect.
        // 60s matches the typical Supabase cache TTL for catalog
        // reads; mutating endpoints invalidate explicitly.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 2,
        // Mobile / offline-first posture. Per TanStack Query docs:
        // 'offlineFirst' lets the cache satisfy reads immediately
        // and only round-trips when online — exactly what we want
        // when the user is at a card show with bad signal.
        networkMode: 'offlineFirst',
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
        networkMode: 'offlineFirst',
      },
    },
  });
}

/**
 * Wire RN's `AppState` and the NetInfo observer into TanStack
 * Query's focus + online managers. Returns the cleanup function so
 * the calling effect can dispose of native subscriptions on
 * unmount.
 *
 * `onlineManager.setEventListener(setup)` returns `void`; the
 * `setup` callback's return value (the unsubscribe) is invoked
 * internally by the next `setEventListener` call. We don't capture
 * it; we just register a no-op handler on cleanup so the active
 * NetInfo listener is detached.
 */
function bridgeReactNative(): () => void {
  let netInfoUnsubscribe: (() => void) | undefined;

  onlineManager.setEventListener((setOnline) => {
    // We treat `isInternetReachable === true` as "online"; null is
    // treated as online (best-effort) so a slow NetInfo probe
    // doesn't pause the very first query at boot.
    const unsub = NetInfo.addEventListener((state) => {
      const isOnline = state.isInternetReachable !== false;
      setOnline(isOnline);
    });
    netInfoUnsubscribe = unsub;
    return unsub;
  });

  const onAppStateChange = (status: AppStateStatus): void => {
    if (Platform.OS !== 'web') {
      focusManager.setFocused(status === 'active');
    }
  };

  let appStateSubscription: { remove: () => void } | undefined;
  if (Platform.OS !== 'web') {
    appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  }

  return () => {
    netInfoUnsubscribe?.();
    appStateSubscription?.remove();
  };
}

export function QueryProvider({ client, children }: QueryProviderProps): ReactNode {
  const [queryClient] = useState(() => client ?? createMobileQueryClient());

  useEffect(() => {
    const cleanup = bridgeReactNative();
    return cleanup;
  }, []);

  // The same `queryClient` instance is preserved across re-renders
  // via `useState`; `useMemo` here just narrows the prop typing.
  const value = useMemo(() => queryClient, [queryClient]);

  return <QueryClientProvider client={value}>{children}</QueryClientProvider>;
}
