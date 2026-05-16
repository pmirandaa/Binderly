// `<CollectionSetRow>` — one row of the CollectionScreen list.
//
// Composition:
//   - small set logo / fallback initials,
//   - set name + release date / language footnote,
//   - Set % progress bar with `owned/total` count,
//   - Master % progress bar with the same shape (the home-screen
//     summary leaves master at 0 until the per-set drill-down is
//     visited — see `lib/collection/completion.ts`).
//
// Tap target: the entire row is a `<Pressable>` so a tap routes to
// the per-set drill-down (`/collection/sets/{canonicalKey}`). The
// CollectionScreen owns the navigation handler.

import { Image } from 'expo-image';

import { Pressable, Text, XStack, YStack } from '@binderly/ui';

import { ProgressBar } from './ProgressBar.js';
import { formatReleaseDate } from '../../lib/browse/format.js';
import { formatCount, formatPercent } from '../../lib/collection/format.js';

import type { CollectionSetSummary } from '../../lib/collection/index.js';
import type { ReactNode } from 'react';

export interface CollectionSetRowProps {
  readonly summary: CollectionSetSummary;
  readonly onPress: (summary: CollectionSetSummary) => void;
  readonly testID?: string;
}

const COVER_SIZE = 56;

export function CollectionSetRow(props: CollectionSetRowProps): ReactNode {
  const { summary, onPress, testID } = props;
  const { set } = summary;
  const slug = set.canonicalKey;
  const rowTestID = testID ?? `collection-set-row-${slug}`;
  return (
    <Pressable
      onPress={() => onPress(summary)}
      variant="ghost"
      paddingHorizontal="$4"
      paddingVertical="$3"
      aria-label={`Open ${set.name} progress`}
      accessibilityLabel={`Open ${set.name} progress`}
      testID={rowTestID}
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
        >
          {set.logoUrl !== null ? (
            <Image
              source={{ uri: set.logoUrl }}
              style={{ width: COVER_SIZE, height: COVER_SIZE }}
              contentFit="contain"
              accessibilityLabel={`${set.name} logo`}
            />
          ) : (
            <Text variant="caption" tone="muted">
              {set.code.toUpperCase().slice(0, 3)}
            </Text>
          )}
        </YStack>
        <YStack flex={1} gap="$2">
          <YStack gap="$1">
            <Text variant="label" tone="default" numberOfLines={1}>
              {set.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {formatReleaseDate(set.releaseDate)} · {set.language.toUpperCase()}
            </Text>
          </YStack>
          <YStack gap="$1" testID={`${rowTestID}-set-progress`}>
            <XStack justifyContent="space-between">
              <Text variant="caption" tone="muted">
                Set
              </Text>
              <Text variant="caption" tone="default">
                {formatPercent(summary.setPct)} ·{' '}
                {formatCount(summary.ownedNumbered, summary.totalNumbered)}
              </Text>
            </XStack>
            <ProgressBar
              value={summary.setPct}
              tone="set"
              accessibilityLabel={`Set progress ${formatPercent(summary.setPct)}`}
              testID={`${rowTestID}-set-bar`}
            />
          </YStack>
          <YStack gap="$1" testID={`${rowTestID}-master-progress`}>
            <XStack justifyContent="space-between">
              <Text variant="caption" tone="muted">
                Master
              </Text>
              <Text variant="caption" tone="muted">
                {summary.totalMaster > 0
                  ? `${formatPercent(summary.masterPct)} · ${formatCount(
                      summary.ownedMaster,
                      summary.totalMaster,
                    )}`
                  : 'Open set to compute'}
              </Text>
            </XStack>
            <ProgressBar
              value={summary.masterPct}
              tone="master"
              accessibilityLabel={`Master progress ${formatPercent(summary.masterPct)}`}
              testID={`${rowTestID}-master-bar`}
            />
          </YStack>
        </YStack>
        <Text variant="label" tone="muted" aria-hidden>
          ›
        </Text>
      </XStack>
    </Pressable>
  );
}
