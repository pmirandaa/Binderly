// `<Gate>` + `<UpgradePrompt>` — the consistent mobile gating UI (Tamagui).
//
//   - `<Gate feature>` renders its children only when the feature is
//     unlocked. Loading → skeleton (never the children — fail-closed);
//     blocked → `<UpgradePrompt>`.
//   - `<UpgradePrompt>` is the single reusable upsell. Its CTA routes to
//     the mobile billing/paywall surface (`MOBILE_UPGRADE_ROUTE`) by
//     default, overridable via `onUpgrade` for screens that present their
//     own offerings sheet (RevenueCat offerings from T-PB-REVENUECAT).
//
// Count-limited sites (custom collections, shareables) use `useLimitGate`
// directly + `<UpgradePrompt>` because the verdict depends on a live count.

import { useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

import type { PaidFeature } from '@binderly/entitlements';
import type { GateBlockReason } from '@binderly/feature-flags';
import { Button, Card, Spinner, Text, YStack } from '@binderly/ui';

import { describeGate } from './copy.js';
import { useGate } from './useGate.js';

/**
 * Destination for the upgrade CTA. The dedicated mobile paywall screen is
 * owned by a future payments task (see `UpgradeBanner`'s note); until it
 * ships, the CTA routes here so the intent is wired + testable. Screens
 * that already hold an offerings sheet can override via `onUpgrade`.
 */
export const MOBILE_UPGRADE_ROUTE = '/billing';

export interface UpgradePromptProps {
  readonly feature: PaidFeature;
  readonly reason: GateBlockReason;
  readonly limit?: number;
  /** Override the default navigation. */
  readonly onUpgrade?: () => void;
  /** Override the default CTA label. */
  readonly ctaLabel?: string;
  /** Test id (defaults to `upgrade-prompt`). */
  readonly testID?: string;
}

/** The reusable upgrade surface. Always non-shaming copy + a CTA. */
export function UpgradePrompt({
  feature,
  reason,
  limit,
  onUpgrade,
  ctaLabel = 'See Pro plans',
  testID = 'upgrade-prompt',
}: UpgradePromptProps): ReactNode {
  const router = useRouter();
  const copy = describeGate(feature, reason, limit);
  const handlePress = useCallback(() => {
    if (onUpgrade !== undefined) {
      onUpgrade();
      return;
    }
    router.push(MOBILE_UPGRADE_ROUTE);
  }, [onUpgrade, router]);

  return (
    <Card variant="outlined" gap="$3" padding="$4" backgroundColor="$surfaceMuted" testID={testID}>
      <YStack gap="$2">
        <Text variant="subtitle" tone="default" testID="upgrade-prompt-title">
          {copy.title}
        </Text>
        <Text variant="body" tone="muted" testID="upgrade-prompt-body">
          {copy.body}
        </Text>
      </YStack>
      <Button
        label={ctaLabel}
        variant="primary"
        size="md"
        onPress={handlePress}
        accessibilityLabel={`${ctaLabel} — upgrade to Pro`}
        testID="upgrade-prompt-cta"
      />
    </Card>
  );
}

/** Skeleton shown while the entitlement read resolves. Never the children. */
export function GateSkeleton({ testID = 'gate-skeleton' }: { readonly testID?: string }): ReactNode {
  return (
    <YStack gap="$2" padding="$4" alignItems="center" testID={testID}>
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
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
    return loadingFallback ?? <GateSkeleton />;
  }
  if (result.allowed) {
    return children;
  }
  return (
    blockedFallback ?? (
      <UpgradePrompt feature={result.feature} reason={result.reason} limit={result.limit} />
    )
  );
}
