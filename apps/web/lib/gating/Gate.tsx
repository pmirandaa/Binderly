'use client';

// `<Gate>` + `<UpgradePrompt>` — the consistent web gating UI.
//
//   - `<Gate feature>` renders its children only when the user may use the
//     feature. While the entitlement read is loading it renders a skeleton
//     (never the children — fail-closed, no over-grant flash); when blocked
//     it renders `<UpgradePrompt>`.
//   - `<UpgradePrompt>` is the single, reusable upsell surface. Its CTA
//     always routes to `/billing` (the Paddle checkout page from T-PB-PADDLE).
//
// Count-limited sites (custom collections, shareables) use `useLimitGate`
// directly + `<UpgradePrompt>` because the gate verdict depends on a live
// count the surrounding screen owns.

import Link from 'next/link';

import type { PaidFeature } from '@binderly/entitlements';
import { type GateBlockReason, type GateResult } from '@binderly/feature-flags';
import { Button, Card, Text, YStack } from '@binderly/ui';


import { describeGate } from './copy';
import { useGate } from './useGate';

import type { ReactNode } from 'react';


/** Destination for every upgrade CTA. The Paddle checkout page. */
export const BILLING_HREF = '/billing';

export interface UpgradePromptProps {
  readonly feature: PaidFeature;
  readonly reason: GateBlockReason;
  readonly limit?: number;
  /** Override the default CTA label. */
  readonly ctaLabel?: string;
  /** Optional testid override for site-specific assertions. */
  readonly testId?: string;
}

/**
 * The reusable upgrade surface. Always present a non-shaming message + a
 * CTA to `/billing`. Rendered by `<Gate>` and by count-limited gate sites.
 */
export function UpgradePrompt({
  feature,
  reason,
  limit,
  ctaLabel = 'See Pro plans',
  testId = 'upgrade-prompt',
}: UpgradePromptProps): ReactNode {
  const copy = describeGate(feature, reason, limit);
  return (
    <Card
      variant="outlined"
      padding="$5"
      gap="$3"
      data-testid={testId}
      data-gate-reason={reason}
      data-gate-feature={feature}
      role="note"
    >
      <YStack gap="$2">
        <Text variant="subtitle" data-testid="upgrade-prompt-title">
          {copy.title}
        </Text>
        <Text variant="body" tone="muted" data-testid="upgrade-prompt-body">
          {copy.body}
        </Text>
      </YStack>
      <Link href={BILLING_HREF} style={{ textDecoration: 'none' }} data-testid="upgrade-prompt-cta">
        <Button label={ctaLabel} aria-label={`${ctaLabel} — upgrade to Pro`} />
      </Link>
    </Card>
  );
}

/** Skeleton shown while the entitlement read resolves. Never the children. */
export function GateSkeleton({ testId = 'gate-skeleton' }: { readonly testId?: string }): ReactNode {
  return (
    <YStack
      padding="$5"
      gap="$2"
      backgroundColor="$surfaceMuted"
      borderRadius={12}
      data-testid={testId}
      aria-busy={true}
      aria-hidden={true}
    >
      <Text variant="bodySmall" tone="muted">
        Checking your plan…
      </Text>
    </YStack>
  );
}

export interface GateProps {
  readonly feature: PaidFeature;
  readonly children: ReactNode;
  /** Custom node rendered while loading. Defaults to `<GateSkeleton>`. */
  readonly loadingFallback?: ReactNode;
  /** Custom node rendered when blocked. Defaults to `<UpgradePrompt>`. */
  readonly blockedFallback?: ReactNode;
}

/**
 * Render `children` only when `feature` is unlocked. Loading → skeleton;
 * blocked → upgrade prompt. The unlocked content is never rendered until
 * the read resolves to an allowed verdict.
 */
export function Gate({ feature, children, loadingFallback, blockedFallback }: GateProps): ReactNode {
  const { result, isLoading } = useGate(feature);
  if (isLoading) {
    return <>{loadingFallback ?? <GateSkeleton />}</>;
  }
  if (result.allowed) {
    return <>{children}</>;
  }
  return (
    <>
      {blockedFallback ?? (
        <UpgradePrompt feature={result.feature} reason={result.reason} limit={result.limit} />
      )}
    </>
  );
}

export type { GateResult };
