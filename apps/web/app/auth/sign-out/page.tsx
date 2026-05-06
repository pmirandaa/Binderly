'use client';

import { Text, YStack } from '@binderly/ui';

export default function SignOutPage(): React.ReactNode {
  return (
    <YStack padding="$6" gap="$3" data-testid="sign-out-page">
      <Text variant="title">Sign out</Text>
      <Text variant="body" tone="muted">
        Sign out handling lands in T-W-AUTH.
      </Text>
    </YStack>
  );
}
