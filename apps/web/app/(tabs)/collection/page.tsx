'use client';

import { Text, YStack } from '@binderly/ui';

export default function CollectionPage(): React.ReactNode {
  return (
    <YStack padding="$6" gap="$3" data-testid="collection-page">
      <Text variant="title">Collection</Text>
      <Text variant="body" tone="muted">
        Your collection home. T-W-COLLECTION will fill this surface.
      </Text>
    </YStack>
  );
}
