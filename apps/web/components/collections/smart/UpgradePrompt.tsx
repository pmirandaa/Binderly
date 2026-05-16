'use client';

// Reusable upsell card surfaced wherever the smart-collection
// flow gates a paid feature (saving a smart collection, viewing
// a saved one as a free-tier user, etc.). Pure visual — the
// `Upgrade` link goes to a placeholder route since the real
// billing flow lands with the paywall task. The brief is
// explicit: "no subscription/billing flow itself (upgrade
// button placeholder)".

import Link from 'next/link';

import { Button, Card, Text, YStack } from '@binderly/ui';

export interface UpgradePromptProps {
  /** Heading copy — defaults to a generic "saved" gate. */
  heading?: string;
  /** Body copy. */
  body?: string;
  /** Optional CTA label. Defaults to "Upgrade to Pro". */
  ctaLabel?: string;
  /**
   * Optional `data-testid` suffix so different surfaces can pin
   * their own upsell card.
   */
  testId?: string;
}

export function UpgradePrompt({
  heading = 'Smart-collection save is a Pro feature',
  body = 'Search results are free. Saving smart collections, naming them, and re-running them automatically is part of Binderly Pro.',
  ctaLabel = 'Upgrade to Pro',
  testId = 'smart-upgrade-prompt',
}: UpgradePromptProps): React.ReactNode {
  return (
    <Card
      variant="outlined"
      padding="$5"
      gap="$3"
      data-testid={testId}
      role="region"
      aria-label="Upgrade to Pro"
    >
      <YStack gap="$2">
        <Text variant="subtitle" data-testid={`${testId}-heading`}>
          {heading}
        </Text>
        <Text variant="body" tone="muted" data-testid={`${testId}-body`}>
          {body}
        </Text>
      </YStack>
      <Link
        href="/profile"
        style={{ textDecoration: 'none' }}
        data-testid={`${testId}-link`}
        aria-label={ctaLabel}
      >
        <Button label={ctaLabel} data-testid={`${testId}-cta`} />
      </Link>
    </Card>
  );
}
