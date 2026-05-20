// `<UndoToast>` — 5-second transient banner that appears after
// every auto-add.
//
// Shows the card name and an "Undo" button. The parent owns the
// timer and calls `onUndo` when the user presses the button.
// When the timer expires the parent removes the toast naturally.

import { type ReactNode } from 'react';

import { Button, Text, XStack } from '@binderly/ui';

export interface UndoToastProps {
  /** Friendly name of the card that was just added. */
  readonly displayName: string;
  /** Called when the user presses "Undo". */
  onUndo(): void;
  /** Remaining milliseconds (for an optional countdown label). */
  readonly remainingMs?: number;
  readonly testID?: string;
}

export function UndoToast(props: UndoToastProps): ReactNode {
  const { displayName, onUndo, testID } = props;

  return (
    <XStack
      backgroundColor="$backgroundStrong"
      borderRadius="$3"
      padding="$3"
      gap="$2"
      alignItems="center"
      justifyContent="space-between"
      shadowColor="$shadowColor"
      shadowRadius={4}
      testID={testID ?? 'undo-toast'}
      accessibilityLabel={`Added ${displayName}. Press Undo to remove it.`}
      accessible
    >
      <Text
        variant="body"
        tone="default"
        flex={1}
        numberOfLines={1}
        testID="undo-toast-label"
      >
        Added {displayName || 'card'}
      </Text>
      <Button
        variant="ghost"
        onPress={onUndo}
        testID="undo-toast-button"
        accessibilityLabel="Undo add"
        accessibilityRole="button"
      >
        Undo
      </Button>
    </XStack>
  );
}
