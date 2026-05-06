'use client';

import { Text, YStack } from '@binderly/ui';

export default function BrowsePage(): React.ReactNode {
  return (
    <YStack padding="$6" gap="$3" data-testid="browse-page">
      <Text variant="title">Browse</Text>
      <Text variant="body" tone="muted">
        Sets, cards, and search. T-W-BROWSE will fill this surface.
      </Text>
    </YStack>
  );
}
