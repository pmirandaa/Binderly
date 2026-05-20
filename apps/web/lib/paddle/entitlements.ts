// Entitlement read adapter.
//
// The billing page asks "is the current user `free` or `pro`?" so it
// can render the right CTA (subscribe vs manage). The unified
// entitlement service that reads from RevenueCat lives in
// T-PB-ENTITLEMENTS (next iter); this adapter is the seam.
//
// v1 shape:
//   - Calls `client.profile.getMySubscription()` against
//     `/v1/me/subscription`. This endpoint may not exist yet in
//     the Edge Functions deploy (T-BE-EDGE-FUNCTIONS-V2 didn't
//     ship it). We catch 404 / 5xx and degrade to `'free'` so
//     the UI never crashes.
//
//   - When T-PB-ENTITLEMENTS lands, it will replace this read
//     with a server-side `getMyEntitlement(userId)` action that
//     proxies RevenueCat's REST API. The shape `{ tier, source,
//     expiresAt }` won't change, so the BillingView stays put.
//
// TODO(T-PB-ENTITLEMENTS): swap this read for the unified-RC
// adapter once that task lands. Until then, the optimistic update
// after Paddle checkout flips the cached value to `'pro'` so the
// UI updates without waiting for our webhook + the next page load.

import {
  ApiAuthError,
  ApiNetworkError,
  ApiNotFoundError,
  ApiUnauthorizedError,
  type BinderlyClient,
} from '@binderly/api-client';
import type { SubscriptionDto, SubscriptionTier, SubscriptionSource } from '@binderly/api-contracts';

export interface EntitlementSnapshot {
  readonly tier: SubscriptionTier;
  readonly source: SubscriptionSource | null;
  readonly externalCustomerId: string | null;
  readonly expiresAt: string | null;
  /**
   * `true` when the read succeeded against the unified entitlement
   * service. `false` when we degraded to `'free'` because the
   * endpoint isn't deployed yet (404) or the user has no row.
   * The UI renders a small "(degraded)" annotation so testers know
   * the value isn't authoritative.
   */
  readonly authoritative: boolean;
}

const DEFAULT_FREE_SNAPSHOT: EntitlementSnapshot = {
  tier: 'free',
  source: null,
  externalCustomerId: null,
  expiresAt: null,
  authoritative: false,
};

/**
 * Read the current user's entitlement snapshot. Never throws;
 * degrades to a `'free'` placeholder on any non-network error.
 *
 * Caller should pass an `AbortSignal` for proper cleanup on
 * route navigation.
 */
export async function readEntitlement(
  client: BinderlyClient,
  options: { readonly signal?: AbortSignal } = {},
): Promise<EntitlementSnapshot> {
  let dto: SubscriptionDto;
  try {
    dto = await client.profile.getMySubscription({
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    // 404 = endpoint not yet deployed (T-PB-ENTITLEMENTS) or no
    // subscription row for the user (free user; profile-trigger
    // backfills `tier='free'` but a partially-migrated DB might
    // not have it). Both → safe to render as free.
    if (error instanceof ApiNotFoundError) return DEFAULT_FREE_SNAPSHOT;
    // 401 / 403 / network errors → re-throw so the caller can
    // distinguish unauthenticated from transient. The billing
    // route guards `useAuth()` before calling this, so 401 here
    // would be a genuine session-expired.
    if (error instanceof ApiAuthError || error instanceof ApiUnauthorizedError) throw error;
    if (error instanceof ApiNetworkError) throw error;
    // Anything else (5xx, validation drift, unknown) → degrade
    // to free + log to console. The webhook + reconciliation
    // path are still authoritative; the UI just shouldn't crash
    // because the entitlement endpoint hiccupped.
    console.warn('[paddle.entitlements] degrading to free tier:', error);
    return DEFAULT_FREE_SNAPSHOT;
  }

  return {
    tier: dto.tier,
    source: dto.source,
    externalCustomerId: dto.externalCustomerId,
    expiresAt: dto.expiresAt,
    authoritative: true,
  };
}

function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

export const ENTITLEMENTS_QUERY_KEY = ['paddle', 'entitlements'] as const;

/**
 * The default snapshot is exported for tests and for the
 * unconfigured-env placeholder render.
 */
export { DEFAULT_FREE_SNAPSHOT };
