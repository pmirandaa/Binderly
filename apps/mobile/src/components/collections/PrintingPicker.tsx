// `<PrintingPicker>` — inline picker the manual-detail screen mounts
// when the user taps "Add cards".
//
// Source: the user's own `collection_item` rows. Picking from owned
// printings is the dominant use case for v1 manual collections —
// "group what I already own". The orchestrator escalates the
// catalog-wide search picker to a follow-up.
//
// Behaviour:
//
//   - Search input filters owned printings by printing id (cheap
//     for v1; richer match keys land when the printing payload
//     carries card name on the wire).
//   - Existing members are visually de-emphasized + the Add button
//     is hidden so the user can't double-add.
//   - Add fires a callback per row; the parent screen owns the
//     mutation. Multiple Add presses queue independent mutations.

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { CollectionItemDto } from '@binderly/api-contracts';
import { Button, Card, Input, Pressable, Text, XStack, YStack } from '@binderly/ui';

export interface PrintingPickerProps {
  /** Owned printings (from `useCollectionItemsQuery`). */
  readonly ownedItems: ReadonlyArray<CollectionItemDto>;
  /** Already-in-collection printingIds; used to suppress duplicates. */
  readonly existingPrintingIds: ReadonlyArray<string>;
  /** Fired when the user taps Add for a row. */
  readonly onAdd: (printingId: string) => void;
  /** Fired when the user taps Done. The parent typically toggles open=false. */
  readonly onClose: () => void;
  readonly testID?: string;
}

export function PrintingPicker(props: PrintingPickerProps): ReactNode {
  const { ownedItems, existingPrintingIds, onAdd, onClose } = props;
  const testID = props.testID ?? 'printing-picker';
  const [search, setSearch] = useState('');

  const existingSet = useMemo(
    () => new Set(existingPrintingIds),
    [existingPrintingIds],
  );

  const filtered = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (trimmed.length === 0) return ownedItems;
    return ownedItems.filter((item) => item.printingId.toLowerCase().includes(trimmed));
  }, [ownedItems, search]);

  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$4"
      margin="$4"
      testID={testID}
      role="dialog"
      aria-label="Add cards"
      accessibilityLabel="Add cards"
    >
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="subtitle" tone="default">
          Add cards
        </Text>
        <Pressable
          onPress={onClose}
          variant="ghost"
          paddingHorizontal="$3"
          paddingVertical="$2"
          aria-label="Close picker"
          accessibilityLabel="Close picker"
          testID={`${testID}-close`}
        >
          <Text variant="label" tone="muted">
            Done
          </Text>
        </Pressable>
      </XStack>
      <Input
        aria-label="Filter your owned printings"
        accessibilityLabel="Filter your owned printings"
        placeholder="Filter by printing id…"
        value={search}
        onChangeText={setSearch}
        testID={`${testID}-search`}
      />
      {ownedItems.length === 0 ? (
        <YStack padding="$3" testID={`${testID}-empty`}>
          <Text variant="caption" tone="muted">
            You don't own any cards yet — add some from the catalog first.
          </Text>
        </YStack>
      ) : filtered.length === 0 ? (
        <YStack padding="$3" testID={`${testID}-no-matches`}>
          <Text variant="caption" tone="muted">
            No owned printings match that search.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$2" testID={`${testID}-list`}>
          {filtered.map((item) => (
            <PickerRow
              key={item.id}
              item={item}
              existing={existingSet.has(item.printingId)}
              onAdd={onAdd}
              testID={`${testID}-row-${item.printingId}`}
            />
          ))}
        </YStack>
      )}
    </Card>
  );
}

interface PickerRowProps {
  readonly item: CollectionItemDto;
  readonly existing: boolean;
  readonly onAdd: (printingId: string) => void;
  readonly testID: string;
}

function PickerRow(props: PickerRowProps): ReactNode {
  const { item, existing, onAdd, testID } = props;
  return (
    <XStack
      justifyContent="space-between"
      alignItems="center"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderRadius={6}
      backgroundColor={existing ? '$surfaceMuted' : 'transparent'}
      testID={testID}
    >
      <YStack flex={1} paddingRight="$2">
        <Text variant="label" tone={existing ? 'muted' : 'default'} numberOfLines={1}>
          {item.printingId}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          x{item.quantity} · {item.condition.toLowerCase().replace(/_/g, ' ')}
        </Text>
      </YStack>
      {existing ? (
        <Text variant="caption" tone="muted" testID={`${testID}-existing`}>
          Already added
        </Text>
      ) : (
        <Button
          label="Add"
          variant="secondary"
          size="sm"
          onPress={() => onAdd(item.printingId)}
          accessibilityLabel={`Add printing ${item.printingId}`}
          testID={`${testID}-add`}
        />
      )}
    </XStack>
  );
}
