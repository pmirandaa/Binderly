// `<ScannerError>` — full-screen error state shown when the
// embedding model or ANN index fails to load.
//
// The parent renders this when `ModelLoadState.phase === 'error'`.
// The error message is surfaced for debugging; the user gets a
// friendly summary and a retry button.

import { type ReactNode } from 'react';

import { Button, Text, YStack } from '@binderly/ui';

export interface ScannerErrorProps {
  /** The raw error surfaced from the loader. May be `null`. */
  readonly error: Error | null;
  /** Called when the user taps "Try again". */
  onRetry(): void;
  readonly testID?: string;
}

export function ScannerError(props: ScannerErrorProps): ReactNode {
  const { error, onRetry, testID } = props;

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$4"
      padding="$6"
      backgroundColor="$background"
      testID={testID ?? 'scanner-error'}
      accessibilityLabel="Scanner failed to load"
      accessible
    >
      <Text
        variant="subtitle"
        tone="default"
        textAlign="center"
        testID="scanner-error-title"
      >
        Scanner unavailable
      </Text>
      <Text
        variant="body"
        tone="muted"
        textAlign="center"
        testID="scanner-error-message"
      >
        {error?.message ?? 'The recognition model failed to load. Please try again.'}
      </Text>
      <Button
        variant="primary"
        onPress={onRetry}
        testID="scanner-error-retry"
        accessibilityLabel="Try loading the scanner again"
        accessibilityRole="button"
      >
        Try again
      </Button>
    </YStack>
  );
}
