// `<ScannerLoading>` — full-screen loading state shown while the
// embedding model and ANN index are being loaded.
//
// The parent renders this while `ModelLoadState.phase === 'loading'`.
// The copy explains what's happening so the user doesn't assume the
// app is stuck.

import { type ReactNode } from 'react';

import { Spinner, Text, YStack } from '@binderly/ui';

export interface ScannerLoadingProps {
  readonly testID?: string;
}

export function ScannerLoading({ testID }: ScannerLoadingProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$4"
      padding="$6"
      backgroundColor="$background"
      testID={testID ?? 'scanner-loading'}
      accessibilityLabel="Preparing scanner, please wait"
      accessible
    >
      <Spinner size="lg" testID="scanner-loading-spinner" />
      <Text
        variant="subtitle"
        tone="default"
        textAlign="center"
        testID="scanner-loading-title"
      >
        Preparing scanner…
      </Text>
      <Text
        variant="body"
        tone="muted"
        textAlign="center"
        testID="scanner-loading-subtitle"
      >
        Loading the recognition model. This only happens once.
      </Text>
    </YStack>
  );
}
