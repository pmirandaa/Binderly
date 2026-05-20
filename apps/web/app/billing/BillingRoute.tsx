'use client';

// `<BillingRoute>` — auth + env wiring for `/billing`.
//
// Mirrors `<CollectionRoute>` (T-W-COLLECTION). Three jobs:
//
//   1. Read auth state via `useAuth()`. While loading → page-
//      level spinner. Signed out → friendly sign-in prompt
//      (forbids hard crash for signed-out visitors).
//   2. Read the public Paddle env on mount. If unconfigured,
//      render the placeholder branch.
//   3. Wire the api-client + Paddle SDK + entitlement query into
//      a `BillingApi` adapter and hand it to `<BillingView>`.
//
// Optimistic UX: after Paddle signals checkout success, we
// invalidate the entitlements query. The webhook is the
// authoritative grant (it forwards to RevenueCat), but we don't
// want the UI to wait on it.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BillingView, type BillingApi } from './BillingView';
import { SignInPrompt } from '../../components/collection/SignInPrompt';
import { PageLoading } from '../../components/loading/PageLoading';
import { useAuth } from '../../components/providers/AuthProvider';
import { getApiClient } from '../../lib/api-client';
import { loadPaddle, openCheckout, subscribeToCheckoutEvents } from '../../lib/paddle/client';
import {
  ENTITLEMENTS_QUERY_KEY,
  readEntitlement,
  DEFAULT_FREE_SNAPSHOT,
  type EntitlementSnapshot,
} from '../../lib/paddle/entitlements';
import { loadPublicPaddleEnv, type PublicPaddleEnvResult } from '../../lib/paddle/env';

import type { PaddlePriceIds } from '../../lib/paddle/plans';

export interface BillingRouteProps {
  /** Test seam — pre-built env (skips reading process.env). */
  readonly env?: PublicPaddleEnvResult;
  /** Test seam — pre-built api adapter. */
  readonly api?: BillingApi;
  /** Test seam — pre-built entitlement snapshot. */
  readonly entitlement?: EntitlementSnapshot;
}

export function BillingRoute(props: BillingRouteProps): React.ReactNode {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [resolvedEnv, setResolvedEnv] = useState<PublicPaddleEnvResult | null>(props.env ?? null);

  useEffect(() => {
    if (resolvedEnv !== null) return;
    setResolvedEnv(loadPublicPaddleEnv());
  }, [resolvedEnv]);

  const userId = user?.id ?? null;

  const entitlementQuery = useQuery<EntitlementSnapshot>({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    enabled: userId !== null && props.entitlement === undefined,
    initialData: props.entitlement,
    queryFn: async ({ signal }) => readEntitlement(getApiClient(), { signal }),
  });

  const invalidateEntitlements = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
  }, [queryClient]);

  const api = useMemo<BillingApi>(() => {
    if (props.api !== undefined) return props.api;
    return makeBillingApi({
      env: resolvedEnv,
      userId,
      onCheckoutSuccess: invalidateEntitlements,
    });
  }, [props.api, resolvedEnv, userId, invalidateEntitlements]);

  if (loading) {
    return <PageLoading label="Loading billing…" />;
  }

  if (user === null) {
    return (
      <SignInPrompt
        nextPath="/billing"
        heading="Sign in to manage your subscription"
        body="Your subscription is tied to your Binderly account. Sign in to subscribe to Pro or manage an existing plan."
      />
    );
  }

  if (resolvedEnv === null) {
    return <PageLoading label="Loading billing…" />;
  }

  const clientTokenConfigured = resolvedEnv.kind === 'configured';
  const priceIds: PaddlePriceIds = resolvedEnv.kind === 'configured'
    ? { monthly: resolvedEnv.priceMonthly, annual: resolvedEnv.priceAnnual }
    : { monthly: null, annual: null };

  const entitlement: EntitlementSnapshot =
    entitlementQuery.data ?? props.entitlement ?? DEFAULT_FREE_SNAPSHOT;

  return (
    <BillingView
      api={api}
      entitlement={entitlement}
      priceIds={priceIds}
      clientTokenConfigured={clientTokenConfigured}
    />
  );
}

interface MakeBillingApiArgs {
  readonly env: PublicPaddleEnvResult | null;
  readonly userId: string | null;
  readonly onCheckoutSuccess: () => void;
}

function makeBillingApi({ env, userId, onCheckoutSuccess }: MakeBillingApiArgs): BillingApi {
  return {
    async openCheckout({ priceId }): Promise<void> {
      if (env === null || env.kind !== 'configured') {
        throw new Error('Billing is not configured in this environment.');
      }
      if (userId === null) {
        throw new Error('You must be signed in to subscribe.');
      }
      const paddle = await loadPaddle({
        clientToken: env.clientToken,
        environment: env.environment,
      });
      if (paddle === null) {
        throw new Error('Could not load the Paddle SDK. Disable any content blockers and try again.');
      }
      // Subscribe before opening so we never miss the
      // checkout.completed event. The unsubscribe fires once the
      // overlay closes (success or otherwise) so a second
      // checkout doesn't double-invalidate.
      const unsubscribe = subscribeToCheckoutEvents((event) => {
        if (event.name === 'checkout.completed') {
          onCheckoutSuccess();
          unsubscribe();
        } else if (event.name === 'checkout.closed') {
          unsubscribe();
        }
      });
      openCheckout(paddle, { priceId, userId });
    },
    openCustomerPortal(): void {
      // v1 stub — Paddle's hosted customer portal is configured per-
      // account in the Paddle dashboard. Until we wire the per-user
      // deep link (T-PB-ENTITLEMENTS will surface that URL via the
      // unified subscription DTO), we open the dashboard's generic
      // billing-help page.
      if (typeof window === 'undefined') return;
      window.open('https://www.paddle.com/customers', '_blank', 'noopener,noreferrer');
    },
  };
}

