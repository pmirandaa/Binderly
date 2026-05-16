// `<CustomCollectionRow>` — one row in the custom-collection list.
//
// Surfaces the collection's name, optional description, kind chip
// (manual / smart) so the row tells the user at a glance which
// detail surface they'll land on, and the last-updated label. The
// whole row is a pressable that pushes either
// `/collections/custom/{id}` or `/collections/smart/{id}` depending
// on the row's `kind`.

import type { CustomCollectionDto } from '@binderly/api-contracts';
import { Pressable, Text, XStack, YStack } from '@binderly/ui';

import { formatDateLabel, truncate } from '../../lib/collections/format.js';

import type { ReactNode } from 'react';

export interface CustomCollectionRowProps {
  readonly collection: CustomCollectionDto;
  readonly onPress: (collection: CustomCollectionDto) => void;
  readonly testID?: string;
}

export function CustomCollectionRow(props: CustomCollectionRowProps): ReactNode {
  const { collection, onPress } = props;
  const testID = props.testID ?? `custom-collection-row-${collection.id}`;
  const description = collection.description ?? '';
  return (
    <Pressable
      onPress={() => onPress(collection)}
      variant="ghost"
      paddingHorizontal="$4"
      paddingVertical="$3"
      aria-label={`Open ${collection.name}`}
      accessibilityLabel={`Open ${collection.name}`}
      testID={testID}
    >
      <XStack gap="$3" alignItems="center">
        <YStack flex={1} gap="$1">
          <XStack gap="$2" alignItems="center">
            <Text variant="label" tone="default" numberOfLines={1}>
              {collection.name}
            </Text>
            <KindChip kind={collection.kind} testID={`${testID}-kind`} />
          </XStack>
          {description.length > 0 ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {truncate(description, 120)}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" numberOfLines={1}>
            Updated {formatDateLabel(collection.updatedAt)}
          </Text>
        </YStack>
        <Text variant="label" tone="muted" aria-hidden>
          ›
        </Text>
      </XStack>
    </Pressable>
  );
}

interface KindChipProps {
  readonly kind: 'manual' | 'smart';
  readonly testID?: string;
}

function KindChip(props: KindChipProps): ReactNode {
  const isSmart = props.kind === 'smart';
  return (
    <XStack
      paddingHorizontal="$2"
      paddingVertical={2}
      borderRadius={999}
      backgroundColor={isSmart ? '$primary' : '$surfaceMuted'}
      borderWidth={1}
      borderColor={isSmart ? '$primary' : '$border'}
      testID={props.testID}
    >
      <Text variant="caption" tone={isSmart ? 'inverse' : 'muted'}>
        {isSmart ? 'Smart' : 'Manual'}
      </Text>
    </XStack>
  );
}
