// `<MatchOverlay>` — floating confirmation shown when the scanner
// auto-adds a card.
//
// Appears when a `MatchResult` with `disposition === 'auto-add'`
// fires. Displays the matched printing name, set name, number,
// and the stability indicator. Disappears after the undo window
// (the parent swaps it for `<UndoToast>`).
//
// Layout: a semi-transparent pill anchored near the top of the
// camera frame, centred horizontally. The parent positions it
// with absolute stacking; this component only handles its own
// internal layout.

import { type ReactNode } from 'react';

import { Text, XStack, YStack } from '@binderly/ui';

import { CardThumbnail } from './CardThumbnail.js';
import { StabilityIndicator } from './StabilityIndicator.js';

export interface MatchOverlayProps {
  /** Printing name (e.g. "Charizard"). Empty string while loading. */
  readonly printingName: string;
  /** Set name (e.g. "Base Set"). Empty string while loading. */
  readonly setName: string;
  /** Collector number (e.g. "4/102"). Empty string while unknown. */
  readonly collectorNumber: string;
  /** Stability count (0–3) at the time the match fired. */
  readonly stabilityCount: number;
  /** Confidence score [0–1] for the debug label. */
  readonly confidence: number;
  /**
   * Resolved thumbnail URL for the matched printing (FU-34). `null` /
   * `undefined` while the catalog lookup is in flight or when the
   * printing has no image — the overlay shows a placeholder box.
   */
  readonly thumbnailUrl?: string | null;
  readonly testID?: string;
}

export function MatchOverlay(props: MatchOverlayProps): ReactNode {
  const {
    printingName,
    setName,
    collectorNumber,
    stabilityCount,
    confidence,
    thumbnailUrl,
    testID,
  } = props;

  const confidencePct = Math.round(confidence * 100);

  return (
    <YStack
      backgroundColor="$backgroundStrong"
      borderRadius="$4"
      padding="$3"
      gap="$2"
      shadowColor="$shadowColor"
      shadowRadius={8}
      testID={testID ?? 'match-overlay'}
      accessibilityLabel={`Matched: ${printingName} from ${setName}`}
      accessible
    >
      <XStack gap="$2" alignItems="center" justifyContent="space-between">
        <CardThumbnail
          url={thumbnailUrl}
          label={collectorNumber || printingName}
          testID="match-overlay-thumbnail"
        />
        <YStack flex={1} gap="$1">
          <Text
            variant="subtitle"
            tone="default"
            testID="match-overlay-name"
          >
            {printingName || '…'}
          </Text>
          <Text variant="bodySmall" tone="muted" testID="match-overlay-set">
            {setName ? `${setName} · ${collectorNumber}` : '…'}
          </Text>
        </YStack>
        <Text variant="caption" tone="muted" testID="match-overlay-confidence">
          {confidencePct}%
        </Text>
      </XStack>
      <StabilityIndicator stabilityCount={stabilityCount} />
    </YStack>
  );
}

/** Thin "hold steady" hint shown when confidence is below disambig floor. */
export function HoldSteadyHint({ testID }: { testID?: string }): ReactNode {
  return (
    <YStack
      backgroundColor="$backgroundStrong"
      borderRadius="$4"
      padding="$3"
      testID={testID ?? 'hold-steady-hint'}
      alignItems="center"
    >
      <Text variant="body" tone="muted">
        Hold steady…
      </Text>
    </YStack>
  );
}
