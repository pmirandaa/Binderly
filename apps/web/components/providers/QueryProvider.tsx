'use client';

// TanStack Query provider. One client per browser session;
// downstream feature tasks (T-W-BROWSE, T-W-COLLECTION, ...)
// will configure their own per-query options on top of these
// sensible defaults.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const DEFAULT_STALE_TIME_MS = 30_000;

export interface QueryProviderProps {
  children: ReactNode;
  /** Test seam — supply a pre-built client (e.g. with retries off). */
  client?: QueryClient;
}

export function QueryProvider({ children, client }: QueryProviderProps): ReactNode {
  const [queryClient] = useState(() => client ?? createDefaultQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function createDefaultQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export { DEFAULT_STALE_TIME_MS };
