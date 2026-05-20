'use client';

// `<BillingView>` — pure presentational surface for `/billing`.
//
// Takes a narrow `BillingApi` and a snapshot of the current
// entitlement state. The route component (`<BillingRoute>`) is
// responsible for wiring the real api-client + Paddle SDK.
//
// Three render branches:
//
//   1. Unconfigured env (no `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`) →
//      friendly "Billing isn't configured" placeholder. Never
//      crashes the build, never confuses testers in CI.
//
//   2. Free tier → upsell card per plan (monthly / annual) with
//      a "Subscribe" CTA. Annual gets the recommended badge.
//
//   3. Pro tier → "You're on Pro" status card + a manage-via-
//      Paddle link. (Cancel / billing-portal flows live in
//      Paddle's hosted customer portal — we link to it rather
//      than rebuilding it.)
//
// Optimistic UX: clicking Subscribe opens the Paddle overlay and
// flips the local `pending` flag so the button shows a spinner.
// On `checkout.completed` (callback from `<BillingRoute>`), we
// invalidate the entitlements query so the UI flips to "Pro"
// immediately — no need to wait for the webhook + page reload.

import { useState } from 'react';

import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { PLANS, resolvePriceId, type Plan, type PaddlePriceIds } from '../../lib/paddle/plans';

import type { EntitlementSnapshot } from '../../lib/paddle/entitlements';

export interface BillingApi {
  /** Open the Paddle overlay with the given price id. */
  readonly openCheckout: (input: { priceId: string; planId: Plan['id'] }) => Promise<void>;
  /** Open Paddle's hosted customer portal in a new tab. */
  readonly openCustomerPortal: () => void;
}

export interface BillingViewProps {
  readonly api: BillingApi;
  readonly entitlement: EntitlementSnapshot;
  readonly priceIds: PaddlePriceIds;
  /**
   * `null` when the public Paddle env (client token) is missing —
   * the view renders the unconfigured-env placeholder.
   */
  readonly clientTokenConfigured: boolean;
  /** Test seam — render an inline error if checkout throws. */
  readonly initialError?: string | null;
}

type CheckoutPending = { kind: 'idle' } | { kind: 'pending'; planId: Plan['id'] };

export function BillingView(props: BillingViewProps): React.ReactNode {
  const { api, entitlement, priceIds, clientTokenConfigured } = props;
  const [pending, setPending] = useState<CheckoutPending>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(props.initialError ?? null);

  if (!clientTokenConfigured) {
    return <UnconfiguredPlaceholder />;
  }

  const isPro = entitlement.tier === 'pro';

  async function handleSubscribe(plan: Plan): Promise<void> {
    const priceId = resolvePriceId(plan, priceIds);
    if (priceId === null) {
      setError(
        `The ${plan.displayName} plan is not configured in this environment. Set NEXT_PUBLIC_PADDLE_PRICE_${plan.interval.toUpperCase()} to enable it.`,
      );
      return;
    }
    setError(null);
    setPending({ kind: 'pending', planId: plan.id });
    try {
      await api.openCheckout({ priceId, planId: plan.id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not start checkout.';
      setError(message);
    } finally {
      setPending({ kind: 'idle' });
    }
  }

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1100}
      marginHorizontal="auto"
      data-testid="billing-page"
    >
      <YStack gap="$2">
        <Text variant="title">Billing</Text>
        <Text variant="body" tone="muted">
          Manage your Binderly subscription. Pro unlocks unlimited custom
          collections, smart collections, shareables, and the stack scanner.
        </Text>
      </YStack>

      <CurrentTierCard entitlement={entitlement} onManage={api.openCustomerPortal} />

      {error !== null ? (
        <Card
          variant="outlined"
          padding="$4"
          gap="$2"
          backgroundColor="$surfaceMuted"
          role="alert"
          data-testid="billing-error"
        >
          <Text variant="subtitle">Could not start checkout</Text>
          <Text variant="body" tone="muted">
            {error}
          </Text>
        </Card>
      ) : null}

      {isPro ? null : (
        <YStack gap="$4" data-testid="billing-plan-list">
          <Text variant="subtitle">Choose a plan</Text>
          <XStack gap="$4" flexWrap="wrap">
            {PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                priceConfigured={resolvePriceId(plan, priceIds) !== null}
                pending={pending.kind === 'pending' && pending.planId === plan.id}
                onSubscribe={(): void => {
                  void handleSubscribe(plan);
                }}
              />
            ))}
          </XStack>
        </YStack>
      )}
    </YStack>
  );
}

function UnconfiguredPlaceholder(): React.ReactNode {
  return (
    <YStack
      padding="$6"
      gap="$4"
      maxWidth={620}
      marginHorizontal="auto"
      data-testid="billing-unconfigured"
    >
      <YStack gap="$2">
        <Text variant="title">Billing</Text>
        <Text variant="body" tone="muted">
          Billing isn&apos;t configured in this environment yet. Set
          <Text variant="caption">{' NEXT_PUBLIC_PADDLE_CLIENT_TOKEN '}</Text>
          (and the matching server-side keys) to enable Pro subscriptions.
        </Text>
      </YStack>
      <Card
        variant="outlined"
        padding="$5"
        gap="$2"
        backgroundColor="$surfaceMuted"
        data-testid="billing-unconfigured-hint"
      >
        <Text variant="subtitle">For administrators</Text>
        <Text variant="body" tone="muted">
          Configure Paddle Billing v2 + RevenueCat keys per
          {' '}
          <Text variant="caption">apps/web/.env.example</Text>
          {' '}
          and redeploy. Until then, the rest of Binderly continues to work on
          the free tier.
        </Text>
      </Card>
    </YStack>
  );
}

interface CurrentTierCardProps {
  readonly entitlement: EntitlementSnapshot;
  readonly onManage: () => void;
}

function CurrentTierCard({ entitlement, onManage }: CurrentTierCardProps): React.ReactNode {
  const isPro = entitlement.tier === 'pro';
  return (
    <Card
      variant="outlined"
      padding="$5"
      gap="$3"
      data-testid="billing-current-tier"
      data-tier={entitlement.tier}
    >
      <YStack gap="$1">
        <Text variant="caption" tone="muted">
          Current tier
        </Text>
        <Text variant="title" data-testid="billing-current-tier-label">
          {isPro ? 'Pro' : 'Free'}
        </Text>
      </YStack>
      {isPro ? (
        <YStack gap="$3">
          <Text variant="body" tone="muted">
            You&apos;re on Pro. Thanks for supporting Binderly!
            {entitlement.expiresAt !== null
              ? ` Renews / expires on ${formatExpiry(entitlement.expiresAt)}.`
              : ''}
          </Text>
          <XStack>
            <Button
              label="Manage billing in Paddle"
              aria-label="Manage billing in Paddle"
              onPress={onManage}
              data-testid="billing-manage-button"
            />
          </XStack>
        </YStack>
      ) : (
        <Text variant="body" tone="muted">
          You&apos;re on the free tier. Upgrade to Pro to unlock unlimited
          custom collections, the stack scanner, and pricing graphs.
        </Text>
      )}
      {!entitlement.authoritative ? (
        <Text variant="caption" tone="muted" data-testid="billing-tier-degraded">
          (Entitlement endpoint not yet deployed — showing default tier.)
        </Text>
      ) : null}
    </Card>
  );
}

interface PlanCardProps {
  readonly plan: Plan;
  readonly priceConfigured: boolean;
  readonly pending: boolean;
  readonly onSubscribe: () => void;
}

function PlanCard({ plan, priceConfigured, pending, onSubscribe }: PlanCardProps): React.ReactNode {
  return (
    <Card
      variant="outlined"
      padding="$5"
      gap="$3"
      flex={1}
      minWidth={280}
      data-testid="billing-plan-card"
      data-plan-id={plan.id}
      data-plan-interval={plan.interval}
    >
      <YStack gap="$1">
        <Text variant="subtitle">{plan.displayName}</Text>
        <Text variant="title">{plan.displayPrice}</Text>
        <Text variant="body" tone="muted">
          {plan.tagline}
        </Text>
      </YStack>
      <YStack gap="$2" data-testid="billing-plan-features">
        {plan.features.map((feature) => (
          <Text key={feature} variant="body">
            • {feature}
          </Text>
        ))}
      </YStack>
      <XStack gap="$2" alignItems="center">
        <Button
          label={pending ? 'Opening checkout…' : `Subscribe — ${plan.displayPrice}`}
          aria-label={`Subscribe to ${plan.displayName}`}
          onPress={onSubscribe}
          disabled={pending || !priceConfigured}
          data-testid={`billing-subscribe-${plan.id}`}
        />
        {pending ? <Spinner size="sm" aria-label="Loading" /> : null}
      </XStack>
      {!priceConfigured ? (
        <Text
          variant="caption"
          tone="muted"
          data-testid={`billing-plan-${plan.id}-missing-price`}
        >
          Price id not configured for this environment.
        </Text>
      ) : null}
    </Card>
  );
}

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
