// Entitlements resource — `GET /v1/me/entitlements`.
//
// The canonical read path for "is the current user free or pro, and
// what can they do?". The edge function behind this endpoint reads
// RevenueCat (the source of truth) via the `@binderly/entitlements` RC
// read client; this resource is the typed client surface web + mobile
// call so they never hand-roll the RC read or the DTO shape.
//
// Split into its own resource (rather than folding into `profile`)
// because entitlements are a distinct concern: `profile.getMySubscription`
// reads the `subscription` table row (provider/source/expiry metadata),
// whereas `entitlements.getMyEntitlements` is the live, RC-derived
// "what's unlocked right now" answer T-PB-GATING gates on.

import { entitlementsDto, type EntitlementsDto } from '@binderly/api-contracts';

import type { HttpClient } from '../client.js';

export interface EntitlementsResource {
  /**
   * Read the current user's live entitlement state from the unified
   * service. Returns `{ tier, activeFeatures, source, checkedAt }`.
   *
   * The endpoint is fail-closed server-side: on an RC outage or a
   * not-yet-provisioned env it returns `{ tier: 'free', source:
   * 'fallback' }` with a 200 (never a 5xx), so this call resolves to a
   * usable free-tier snapshot rather than throwing. Genuine auth
   * failures (401) still throw `ApiUnauthorizedError`.
   */
  readonly getMyEntitlements: (options?: {
    readonly signal?: AbortSignal;
  }) => Promise<EntitlementsDto>;
}

export function makeEntitlementsResource(http: HttpClient): EntitlementsResource {
  return {
    async getMyEntitlements(options = {}): Promise<EntitlementsDto> {
      return http.request(
        {
          path: '/v1/me/entitlements',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        entitlementsDto,
      );
    },
  };
}
