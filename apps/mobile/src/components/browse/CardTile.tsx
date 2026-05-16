// `<CardTile>` — one tile in the SetScreen grid.
//
// Tile composition:
//   - card image (placeholder background until printings load),
//   - card number badge,
//   - card name footer.
//
// Card-level imagery lives on the printing, but the per-set card
// list endpoint returns `CardDto` (no printings inlined). For
// MVP we render a number-only tile and surface the image on the
// CardScreen detail page; this matches the read-only spec.

import { Pressable, Text, YStack } from '@binderly/ui';

import type { CardInSetDto } from '../../lib/browse/index.js';
import type { ReactNode } from 'react';

export interface CardTileProps {
  readonly card: CardInSetDto;
  readonly onPress: (card: CardInSetDto) => void;
  readonly testID?: string;
}

export function CardTile(props: CardTileProps): ReactNode {
  const { card, onPress, testID } = props;
  return (
    <Pressable
      flex={1}
      onPress={() => onPress(card)}
      variant="ghost"
      padding="$2"
      borderRadius={12}
      aria-label={`Open card ${card.name} (#${card.number})`}
      accessibilityLabel={`Open card ${card.name} (#${card.number})`}
      testID={testID ?? `card-tile-${card.id}`}
    >
      <YStack
        aspectRatio={5 / 7}
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        alignItems="center"
        justifyContent="center"
        padding="$3"
      >
        <Text variant="label" tone="muted">
          #{card.number}
        </Text>
      </YStack>
      <YStack paddingTop="$2" gap="$1">
        <Text variant="caption" tone="default" numberOfLines={2}>
          {card.name}
        </Text>
        {card.rarity !== null ? (
          <Text variant="caption" tone="muted">
            {card.rarity}
          </Text>
        ) : null}
      </YStack>
    </Pressable>
  );
}
