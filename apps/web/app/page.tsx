'use client';

// Placeholder home page for the Binderly web shell.
// `"use client"` because @binderly/ui primitives mount React
// contexts at module evaluation; until Tamagui ships an RSC-safe
// build, pages that render the design system live on the client
// side. Routes can opt back into RSC for server-only data fetches
// once the design-system boundary is split.

import { Button, Text, YStack } from '@binderly/ui';

export default function HomePage(): React.ReactNode {
  return (
    <YStack
      padding="$6"
      gap="$4"
      alignItems="flex-start"
      justifyContent="center"
      maxWidth={720}
      marginHorizontal="auto"
      data-testid="home-page"
    >
      <Text variant="display">Binderly</Text>
      <Text variant="title">Collection-first Pokémon TCG tracker.</Text>
      <Text variant="body" tone="muted">
        Browse every set, track your collection, scan stacks of cards in seconds, and share what you
        own. Web app shell — feature surfaces land in upcoming tasks.
      </Text>
      <Button label="Browse sets" />
    </YStack>
  );
}
