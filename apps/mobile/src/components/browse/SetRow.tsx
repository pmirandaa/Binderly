// `<SetRow>` — one row of the BrowseScreen list.
//
// Composes:
//   - small cover image (`set.logoUrl`, expo-image),
//   - set name + series footnote,
//   - localized release date + card count,
//   - chevron-right glyph (drawn as a Text since the icon registry
//     lands in T-M-AUTH's followups).
//
// The row is a Tamagui `<Pressable>` so it picks up hover/press
// styling on web and surfaces a tap target on native. The
// container itself uses `@binderly/ui` primitives only.

import { Image } from 'expo-image';

import type { SetDto } from '@binderly/api-contracts';
import { Pressable, Text, XStack, YStack } from '@binderly/ui';

import { formatReleaseDate } from '../../lib/browse/format.js';

import type { ReactNode } from 'react';

export interface SetRowProps {
  readonly set: SetDto;
  readonly onPress: (set: SetDto) => void;
  readonly testID?: string;
}

const COVER_SIZE = 56;

export function SetRow(props: SetRowProps): ReactNode {
  const { set, onPress, testID } = props;
  const total = set.total ?? set.printedTotal ?? 0;
  return (
    <Pressable
      onPress={() => onPress(set)}
      variant="ghost"
      paddingHorizontal="$4"
      paddingVertical="$3"
      aria-label={`Open set ${set.name}`}
      accessibilityLabel={`Open set ${set.name}`}
      testID={testID ?? `set-row-${set.canonicalKey}`}
    >
      <XStack gap="$3" alignItems="center">
        <YStack
          width={COVER_SIZE}
          height={COVER_SIZE}
          borderRadius={8}
          backgroundColor="$surfaceMuted"
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
          testID={`set-row-${set.canonicalKey}-cover`}
        >
          {set.logoUrl !== null ? (
            <Image
              source={{ uri: set.logoUrl }}
              style={{ width: COVER_SIZE, height: COVER_SIZE }}
              contentFit="contain"
              testID={`set-row-${set.canonicalKey}-image`}
              accessibilityLabel={`${set.name} logo`}
            />
          ) : (
            <Text variant="caption" tone="muted">
              {set.code.toUpperCase().slice(0, 3)}
            </Text>
          )}
        </YStack>
        <YStack flex={1} gap="$1">
          <Text variant="label" tone="default" numberOfLines={1}>
            {set.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {formatReleaseDate(set.releaseDate)} · {total} cards · {set.language.toUpperCase()}
          </Text>
        </YStack>
        <Text variant="label" tone="muted" aria-hidden>
          ›
        </Text>
      </XStack>
    </Pressable>
  );
}
