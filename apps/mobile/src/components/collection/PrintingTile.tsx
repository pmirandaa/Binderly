// `<PrintingTile>` — one tile in the per-set drill-down's
// owned/missing grid. Renders the printing's image (or a number
// fallback), variant class chip, and a small "owned" / "missing"
// status pill.
//
// Tapping a tile pushes the existing `/cards/{cardId}` detail
// route — the drill-down doesn't need its own per-printing screen
// since the card detail surface already lists every printing.

import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import type { PrintingDto } from '@binderly/api-contracts';
import { Pressable, Text, XStack, YStack } from '@binderly/ui';

import { variantClassLabel } from '../../lib/browse/format.js';

import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
});

export interface PrintingTileProps {
  readonly printing: PrintingDto;
  readonly owned: boolean;
  readonly onPress: (printing: PrintingDto) => void;
  readonly testID?: string;
}

export function PrintingTile(props: PrintingTileProps): ReactNode {
  const { printing, owned, onPress } = props;
  const testID = props.testID ?? `collection-printing-tile-${printing.id}`;
  return (
    <Pressable
      flex={1}
      onPress={() => onPress(printing)}
      variant="ghost"
      padding="$2"
      borderRadius={12}
      aria-label={`${owned ? 'Owned' : 'Missing'} printing ${printing.variantKey}`}
      accessibilityLabel={`${owned ? 'Owned' : 'Missing'} printing ${printing.variantKey}`}
      testID={testID}
    >
      <YStack
        aspectRatio={5 / 7}
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        alignItems="center"
        justifyContent="center"
        overflow="hidden"
        opacity={owned ? 1 : 0.6}
      >
        {printing.imageSmallUrl !== null ? (
          <Image
            source={{ uri: printing.imageSmallUrl }}
            style={styles.image}
            contentFit="contain"
            accessibilityLabel={`Printing ${printing.variantKey}`}
          />
        ) : (
          <Text variant="caption" tone="muted">
            {printing.variantCode.toUpperCase().slice(0, 4)}
          </Text>
        )}
      </YStack>
      <YStack paddingTop="$2" gap="$1">
        <XStack justifyContent="space-between" alignItems="center">
          <Text variant="caption" tone="default" numberOfLines={1}>
            {variantClassLabel(printing.variantClass)}
          </Text>
          <Text
            variant="caption"
            tone={owned ? 'default' : 'muted'}
            testID={`collection-printing-status-${printing.id}`}
          >
            {owned ? 'Owned' : 'Missing'}
          </Text>
        </XStack>
        {printing.variantFlags.length > 0 ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {printing.variantFlags.map(variantClassLabel).join(', ')}
          </Text>
        ) : null}
      </YStack>
    </Pressable>
  );
}
