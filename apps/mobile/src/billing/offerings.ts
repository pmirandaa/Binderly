// Offerings query.
//
// - `useOfferings()`: TanStack Query wrapper over
//   `Purchases.getOfferings()`. Returns the strict
//   `OfferingsSnapshot` shape from `./types.ts`. Five-minute cache,
//   refetch on focus.
//
// - `OFFERINGS_QUERY_KEY`: exported so callers can invalidate
//   after a config-change event (e.g. an A/B targeting reroll).
//
// **Dev-mode sentinel.** When billing runs in stub mode (no RC
// keys), the stub's `getOfferings()` resolves to `{ all: {},
// current: null }`. The snapshot's `current === null` is the
// agreed "no paywall, hide upgrade CTAs" sentinel paywall UIs
// branch on without juggling Query loading flags. This also
// covers the RC-configured-but-no-offering-published-yet case
// (which is what happens in a fresh RC project).

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getBillingAdapter } from './init.js';

import type { OfferingsSnapshot, PurchasesOffering } from './types.js';

export const OFFERINGS_QUERY_KEY = ['binderly', 'billing', 'offerings'] as const;

const OFFERINGS_STALE_MS = 5 * 60 * 1000;

export function useOfferings(): UseQueryResult<OfferingsSnapshot, Error> {
  return useQuery<OfferingsSnapshot, Error>({
    queryKey: OFFERINGS_QUERY_KEY,
    queryFn: async (): Promise<OfferingsSnapshot> => {
      const adapter = getBillingAdapter();
      const raw = await adapter.getOfferings();
      return {
        current: raw.current ?? null,
        all: normaliseAllOfferings(raw.all),
      };
    },
    staleTime: OFFERINGS_STALE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

function normaliseAllOfferings(
  raw: { [key: string]: PurchasesOffering } | null | undefined,
): Readonly<Record<string, PurchasesOffering>> {
  if (raw === null || raw === undefined) return {};
  // Defensive clone so callers can't mutate the snapshot via the
  // map they read from. The original RC object is `readonly` in
  // its type but isn't frozen at runtime.
  return { ...raw };
}
