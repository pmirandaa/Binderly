'use client';

import { Text, YStack } from '@binderly/ui';

export default function NotFound(): React.ReactNode {
  return (
    <YStack
      padding="$6"
      gap="$3"
      alignItems="center"
      justifyContent="center"
      data-testid="not-found"
    >
      <Text variant="title">Page not found</Text>
      <Text variant="body" tone="muted">
        We couldn&apos;t find the page you were looking for.
      </Text>
    </YStack>
  );
}
