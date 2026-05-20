// `<SessionFooter>` — persistent "N cards added — Done" bar at the
// bottom of the live scan view.
//
// Renders nothing when there are 0 committed session items. Once
// the user has added at least one card, the bar appears with the
// running count and a "Done" button that transitions the screen
// into the stack-review phase.

import { type ReactNode } from 'react';

import { Button, Text, XStack } from '@binderly/ui';

export interface SessionFooterProps {
  /** Number of committed session items (0 = footer hidden). */
  readonly itemCount: number;
  /** Called when the user taps "Done". */
  onDone(): void;
  readonly testID?: string;
}

export function SessionFooter(props: SessionFooterProps): ReactNode {
  const { itemCount, onDone, testID } = props;

  if (itemCount === 0) {
    return null;
  }

  const label = itemCount === 1 ? '1 card added' : `${itemCount} cards added`;

  return (
    <XStack
      backgroundColor="$background"
      padding="$3"
      gap="$3"
      alignItems="center"
      justifyContent="space-between"
      testID={testID ?? 'session-footer'}
      accessibilityLabel={`${label}. Tap Done to review.`}
      accessible
    >
      <Text
        variant="body"
        tone="default"
        flex={1}
        testID="session-footer-count"
      >
        {label}
      </Text>
      <Button
        variant="primary"
        onPress={onDone}
        testID="session-footer-done"
        accessibilityLabel="Done scanning, review added cards"
        accessibilityRole="button"
      >
        Done
      </Button>
    </XStack>
  );
}
