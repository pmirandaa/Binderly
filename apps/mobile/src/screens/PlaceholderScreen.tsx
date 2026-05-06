// Generic placeholder screen used by every shell tab + auth route.
// Feature tasks (T-M-AUTH, T-M-BROWSE, T-M-COLLECTION, T-SC-*,
// T-GR-*) replace these by writing their own screens in
// `apps/mobile/src/screens/<feature>/...` and updating the
// matching `app/...` route's default export.

import { Text, YStack } from '@binderly/ui';

import type { ReactNode } from 'react';

export interface PlaceholderScreenProps {
  /** Human-readable title (matches the tab / stack route label). */
  title: string;
  /** Owning task id, e.g. `'T-M-AUTH'`. Renders as a footnote. */
  ownerTask: string;
  /** Optional description sentence, rendered between title and owner. */
  description?: string;
  /** Optional accessibility identifier for E2E tests. */
  testID?: string;
}

/**
 * Renders a screen body that documents which task will fill it in.
 * Token-driven so light / dark themes work without any extra wiring.
 */
export function PlaceholderScreen(props: PlaceholderScreenProps): ReactNode {
  const { title, ownerTask, description, testID } = props;
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID={testID ?? `placeholder-${ownerTask.toLowerCase()}`}
    >
      <Text variant="title" tone="default">
        {title}
      </Text>
      {description !== undefined ? (
        <Text variant="body" tone="muted">
          {description}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted">
        Owned by {ownerTask}
      </Text>
    </YStack>
  );
}
