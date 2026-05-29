'use client';

// Web entitlement read for gating.
//
// Reads the current user's live tier from the unified entitlement service
// (`client.entitlements.getMyEntitlements()` → `GET /v1/me/entitlements`),
// which is itself fail-closed server-side (RC outage / unconfigured env →
// `{ tier: 'free', source: 'fallback' }` with a 200). This module layers a
// second fail-closed guard on top: any unexpected client-side failure (a
// genuine 401, a network blip, a decode error) also resolves to free so a
// gate never over-grants while a read is degraded.
//
// This is intentionally separate from `lib/paddle/entitlements.ts` (owned
// by T-PB-PADDLE): that reads `/v1/me/subscription` (provider/expiry
// metadata for the billing page) whereas gating reads the live RC-derived
// "what's unlocked right now" answer. Different endpoint, different query
// key, so the two caches don't collide.

import { useQuery } from '@tanstack/react-query';

import { type BinderlyClient } from '@binderly/api-client';
import type { EntitlementSource, EntitlementsDto } from '@binderly/api-contracts';
import type { Tier } from '@binderly/entitlements';

import { useAuth } from '../../components/providers/AuthProvider';
import { getApiClient } from '../api-client';

/** TanStack Query key for the gating entitlement read. */
export const GATING_ENTITLEMENT_QUERY_KEY = ['gating', 'entitlements'] as const;

/**
 * RC caches `getCustomerInfo` server-side and tiers change rarely, so a
 * 5-minute stale window is plenty and avoids a refetch on every gated
 * render. An externally-granted upgrade still propagates within the window;
 * the billing page invalidates this key on checkout success for instant UX.
 */
const ENTITLEMENT_STALE_MS = 5 * 60 * 1000;

/** Resolved entitlement state the gating hooks feed into `@binderly/feature-flags`. */
export interface EntitlementState {
  readonly tier: Tier;
  readonly source: EntitlementSource;
  /**
   * `true` while the read (or auth) is still resolving. Consumers render
   * the gated skeleton — never the unlocked content — until this clears,
   * so a free flash never momentarily over-grants.
   */
  readonly isLoading: boolean;
}

function freeFallback(): EntitlementsDto {
  return {
    tier: 'free',
    activeFeatures: [],
    source: 'fallback',
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Read the entitlement DTO; never throws except on abort. Any other
 * failure degrades to a free fallback (fail-closed).
 */
export async function readGatingEntitlement(
  client: BinderlyClient,
  options: { readonly signal?: AbortSignal } = {},
): Promise<EntitlementsDto> {
  try {
    return await client.entitlements.getMyEntitlements(options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return freeFallback();
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * Resolve the current user's entitlement state for gating. Fail-closed:
 *   - signed out → free, not loading (a signed-out user is never pro).
 *   - auth still resolving / read in flight → free + `isLoading: true`.
 *   - read resolved → the DTO's tier/source.
 */
export function useEntitlement(): EntitlementState {
  const { user, loading: authLoading } = useAuth();
  const enabled = user !== null;

  const query = useQuery<EntitlementsDto>({
    queryKey: GATING_ENTITLEMENT_QUERY_KEY,
    enabled,
    staleTime: ENTITLEMENT_STALE_MS,
    queryFn: ({ signal }) => readGatingEntitlement(getApiClient(), { signal }),
  });

  if (!enabled) {
    return { tier: 'free', source: 'fallback', isLoading: authLoading };
  }
  if (query.data === undefined) {
    return { tier: 'free', source: 'fallback', isLoading: authLoading || query.isPending };
  }
  return { tier: query.data.tier, source: query.data.source, isLoading: authLoading };
}
