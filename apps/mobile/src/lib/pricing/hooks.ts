// TanStack Query wrapper around the V2 current-price endpoint.
//
// `useCurrentPriceQuery({ printingId, enabled })` calls
// `client.pricing.getPrintingCurrentPrice({ printingId })` —
// the headline `(RAW_NM, EBAY_US)` price slice the card-detail
// screen renders. Wraps the result so the caller distinguishes:
//
//   - `isLoading` — first fetch in flight.
//   - `data === null` — server replied 404 (no price row for the
//     printing yet). NOT an error; rendered as the "Prices not
//     available yet" state. Per-task decision (D3 in
//     T-M-API-V2-WIRING.md).
//   - `data !== null` — server returned a `PrintingCurrentPriceDto`.
//     Render with `@binderly/pricing-display`'s `formatPrice`.
//   - `isError` — genuine error (network, 5xx, validation, etc.).
//     The screen surfaces a retry affordance.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ApiNotFoundError } from '@binderly/api-client';
import type { PrintingCurrentPriceDto } from '@binderly/api-contracts';

import { useApiClient } from '../api-client.js';

export const PRICING_QUERY_KEYS = {
  currentPrice: (printingId: string) => ['pricing', 'current-price', printingId] as const,
};

export type UseCurrentPriceQueryResult = UseQueryResult<PrintingCurrentPriceDto | null, Error>;

export interface UseCurrentPriceQueryOptions {
  readonly printingId: string | undefined;
  readonly enabled?: boolean;
}

/**
 * Authoritative headline price for a single printing. Reads the
 * V2 `/v1/printings/:id/current-price` endpoint (defaults to
 * `RAW_NM` + `EBAY_US`). 404 collapses into `data: null`; every
 * other error path surfaces via `isError`.
 *
 * `enabled` is false by default when `printingId` is undefined
 * — the card-detail surface handles the "no printing in scope"
 * case explicitly.
 */
export function useCurrentPriceQuery(
  options: UseCurrentPriceQueryOptions,
): UseCurrentPriceQueryResult {
  const client = useApiClient();
  const printingId = options.printingId;
  const enabled = (options.enabled ?? true) && printingId !== undefined;
  return useQuery<PrintingCurrentPriceDto | null, Error>({
    queryKey: PRICING_QUERY_KEYS.currentPrice(printingId ?? '__noop__'),
    enabled,
    queryFn: async () => {
      if (printingId === undefined) return null;
      try {
        return await client.pricing.getPrintingCurrentPrice({ printingId });
      } catch (cause) {
        // 404 is "no headline price computed for this printing
        // yet" — render the no-data branch, not the error branch.
        if (cause instanceof ApiNotFoundError) return null;
        throw cause;
      }
    },
  });
}
