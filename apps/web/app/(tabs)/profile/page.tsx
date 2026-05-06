'use client';

import { Text, YStack } from '@binderly/ui';

export default function ProfilePage(): React.ReactNode {
  return (
    <YStack padding="$6" gap="$3" data-testid="profile-page">
      <Text variant="title">Profile</Text>
      <Text variant="body" tone="muted">
        Account, subscription, preferences. Future feature tasks fill this surface.
      </Text>
    </YStack>
  );
}
