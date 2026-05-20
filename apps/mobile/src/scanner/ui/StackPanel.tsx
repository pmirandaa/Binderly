// `<StackPanel>` — full-screen review panel for the session's
// committed scan items.
//
// Shown when the user taps "Done" in the session footer
// (`ScannerPhase === 'stack-review'`). The user can:
//   - Remove individual items (they are deleted from the collection).
//   - Tap "Commit" to accept everything and return to the camera.
//   - Tap "Discard all" to delete every item and reset the session.
//
// The panel is pure; all actions are surfaced via callbacks. The
// parent (ScanScreen) owns the API calls.

import { type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import type { SessionItem } from './types.js';

export interface StackPanelProps {
  /** Current committed items. */
  readonly items: readonly SessionItem[];
  /** Called when the user removes one item. */
  onRemoveItem(collectionItemId: string): void;
  /** Called when the user taps "Commit" (accept remaining). */
  onCommit(): void;
  /** Called when the user taps "Discard all". */
  onDiscardAll(): void;
  readonly testID?: string;
}

export function StackPanel(props: StackPanelProps): ReactNode {
  const { items, onRemoveItem, onCommit, onDiscardAll, testID } = props;

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      testID={testID ?? 'stack-panel'}
      accessibilityLabel="Review scanned cards"
      accessible
    >
      {/* Header */}
      <XStack
        padding="$4"
        justifyContent="space-between"
        alignItems="center"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
      >
        <Text variant="subtitle" tone="default" testID="stack-panel-title">
          {items.length === 1 ? '1 card scanned' : `${items.length} cards scanned`}
        </Text>
        <Button
          variant="ghost"
          onPress={onDiscardAll}
          testID="stack-panel-discard-all"
          accessibilityLabel="Discard all scanned cards"
          accessibilityRole="button"
        >
          Discard all
        </Button>
      </XStack>

      {/* Item list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="stack-panel-scroll"
        accessibilityRole="list"
      >
        {items.length === 0 && (
          <Text
            variant="body"
            tone="muted"
            textAlign="center"
            testID="stack-panel-empty"
          >
            No cards in this session.
          </Text>
        )}
        {items.map((item, i) => (
          <StackPanelRow
            key={item.collectionItemId}
            item={item}
            index={i}
            onRemove={onRemoveItem}
          />
        ))}
      </ScrollView>

      {/* Bottom actions */}
      <YStack
        padding="$4"
        gap="$2"
        borderTopWidth={1}
        borderTopColor="$borderColor"
        testID="stack-panel-actions"
      >
        <Button
          variant="primary"
          onPress={onCommit}
          testID="stack-panel-commit"
          accessibilityLabel="Commit scanned cards to collection"
          accessibilityRole="button"
        >
          {items.length === 0 ? 'Done' : `Keep ${items.length} card${items.length === 1 ? '' : 's'}`}
        </Button>
      </YStack>
    </YStack>
  );
}

interface StackPanelRowProps {
  readonly item: SessionItem;
  readonly index: number;
  onRemove(collectionItemId: string): void;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 8 },
});

function StackPanelRow({ item, index, onRemove }: StackPanelRowProps): ReactNode {
  return (
    <XStack
      padding="$3"
      borderRadius="$3"
      backgroundColor="$backgroundStrong"
      alignItems="center"
      justifyContent="space-between"
      gap="$2"
      testID={`stack-panel-item-${index}`}
      accessibilityLabel={item.displayName}
      accessibilityRole="none"
    >
      <YStack flex={1} gap="$1">
        <Text variant="body" tone="default" numberOfLines={1}>
          {item.displayName || item.printingId}
        </Text>
        <Text variant="caption" tone="muted">
          {item.printingId}
        </Text>
      </YStack>
      <Button
        variant="ghost"
        onPress={() => onRemove(item.collectionItemId)}
        testID={`stack-panel-remove-${index}`}
        accessibilityLabel={`Remove ${item.displayName}`}
        accessibilityRole="button"
      >
        Remove
      </Button>
    </XStack>
  );
}
