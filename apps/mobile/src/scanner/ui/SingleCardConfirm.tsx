// `<SingleCardConfirm>` — the free single-card-scan confirmation card
// (FU-57).
//
// In single-card mode a match does NOT auto-commit (unlike the Pro
// continuous/stack flow). Instead the matched printing is shown here for
// an explicit confirm: "Add to collection" commits the one card, "Rescan"
// dismisses and returns to the live camera for another capture. There is
// no session accumulation and no stack-review phase.
//
// Pure presentational component — the screen owns the catalog lookup and
// the add/delete API calls and feeds resolved strings + a `thumbnailUrl`
// in (the `scanner/ui/` tree is network-isolated by test).

import { type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { CardThumbnail } from './CardThumbnail.js';

export interface SingleCardConfirmProps {
  /** Printing name (e.g. "Charizard"). Empty string while loading. */
  readonly printingName: string;
  /** Set name (e.g. "Base Set"). Empty string while loading. */
  readonly setName: string;
  /** Collector number (e.g. "4/102"). Empty string while unknown. */
  readonly collectorNumber: string;
  /** Confidence score [0–1] for the debug label. */
  readonly confidence: number;
  /** Resolved thumbnail URL for the matched printing (FU-34). */
  readonly thumbnailUrl?: string | null;
  /** Commit this single card to the collection. */
  onConfirm(): void;
  /** Dismiss and return to the live camera for another capture. */
  onRescan(): void;
  readonly testID?: string;
}

export function SingleCardConfirm(props: SingleCardConfirmProps): ReactNode {
  const {
    printingName,
    setName,
    collectorNumber,
    confidence,
    thumbnailUrl,
    onConfirm,
    onRescan,
    testID,
  } = props;

  const confidencePct = Math.round(confidence * 100);

  return (
    <YStack
      backgroundColor="$background"
      borderTopLeftRadius="$6"
      borderTopRightRadius="$6"
      padding="$4"
      gap="$3"
      shadowColor="$shadowColor"
      shadowRadius={12}
      testID={testID ?? 'single-card-confirm'}
      accessibilityLabel={`Matched ${printingName} from ${setName}. Confirm to add.`}
      accessible
    >
      <XStack gap="$3" alignItems="center">
        <CardThumbnail
          url={thumbnailUrl}
          label={collectorNumber || printingName}
          testID="single-card-confirm-thumbnail"
        />
        <YStack flex={1} gap="$1">
          <Text variant="subtitle" tone="default" testID="single-card-confirm-name">
            {printingName || '…'}
          </Text>
          <Text variant="bodySmall" tone="muted" testID="single-card-confirm-set">
            {setName ? `${setName} · ${collectorNumber}` : '…'}
          </Text>
        </YStack>
        <Text variant="caption" tone="muted" testID="single-card-confirm-confidence">
          {confidencePct}%
        </Text>
      </XStack>
      <XStack gap="$3">
        <Button
          variant="ghost"
          flex={1}
          label="Rescan"
          onPress={onRescan}
          testID="single-card-confirm-rescan"
          accessibilityLabel="Rescan — discard this match and capture again"
        />
        <Button
          variant="primary"
          flex={1}
          label="Add to collection"
          onPress={onConfirm}
          testID="single-card-confirm-add"
          accessibilityLabel="Add this card to your collection"
        />
      </XStack>
    </YStack>
  );
}
