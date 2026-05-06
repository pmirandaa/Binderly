'use client';

import { Text, YStack } from '@binderly/ui';

export default function ScannerPage(): React.ReactNode {
  // Scanner is a mobile-only feature in MVP (see PROJECT.md §11).
  // The web placeholder explains the divergence so users hitting
  // the URL aren't surprised.
  return (
    <YStack padding="$6" gap="$3" data-testid="scanner-page">
      <Text variant="title">Scanner</Text>
      <Text variant="body" tone="muted">
        Stack scanning is a mobile-only feature in v1. Open Binderly on your phone to scan cards.
      </Text>
    </YStack>
  );
}
