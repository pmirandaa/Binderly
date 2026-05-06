import { router } from 'expo-router';

import { Button, Text, YStack } from '@binderly/ui';

import type { ReactNode } from 'react';

export function NotFoundScreen(): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
    >
      <Text variant="title" tone="default">
        Page not found
      </Text>
      <Text variant="body" tone="muted">
        That route doesn’t exist in this build of Binderly.
      </Text>
      <Button
        label="Go home"
        variant="primary"
        size="md"
        onPress={() => {
          router.replace('/(tabs)/browse');
        }}
      />
    </YStack>
  );
}
