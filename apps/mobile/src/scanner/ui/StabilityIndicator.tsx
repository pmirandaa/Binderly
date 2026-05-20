// `<StabilityIndicator>` — 3-dot visual representation of the
// stability gate progress.
//
// The matcher requires `MATCH_STABILITY_COUNT = 3` consecutive
// accepted frames at the same printing before firing. This
// component turns that counter into filled/empty dots so the user
// has visual feedback that the scanner is tracking the card.
//
// Dots are read from left to right: filled = stable frame seen,
// empty = waiting.

import { type ReactNode } from 'react';

import { XStack, YStack } from '@binderly/ui';

export interface StabilityIndicatorProps {
  /**
   * Number of consecutive stable frames so far (0–3).
   * Values outside [0, totalDots] are clamped.
   */
  readonly stabilityCount: number;
  /** Total dots to render. Defaults to 3 (= `MATCH_STABILITY_COUNT`). */
  readonly totalDots?: number;
  readonly testID?: string;
}

/** Diameter in logical pixels of each stability dot. */
const DOT_SIZE = 10;

export function StabilityIndicator(props: StabilityIndicatorProps): ReactNode {
  const { stabilityCount, totalDots = 3, testID } = props;
  const filled = Math.max(0, Math.min(totalDots, Math.floor(stabilityCount)));
  const dots = Array.from({ length: totalDots }, (_, i) => i < filled);

  return (
    <XStack
      gap="$2"
      alignItems="center"
      justifyContent="center"
      testID={testID ?? 'stability-indicator'}
      accessibilityLabel={`Stability: ${filled} of ${totalDots} frames`}
      accessibilityRole="progressbar"
    >
      {dots.map((isFilled, i) => (
        <StabilityDot key={i} filled={isFilled} index={i} />
      ))}
    </XStack>
  );
}

interface StabilityDotProps {
  readonly filled: boolean;
  readonly index: number;
}

function StabilityDot({ filled, index }: StabilityDotProps): ReactNode {
  return (
    <YStack
      width={DOT_SIZE}
      height={DOT_SIZE}
      borderRadius={DOT_SIZE / 2}
      backgroundColor={filled ? '$color' : '$colorTransparent'}
      borderWidth={2}
      borderColor="$color"
      testID={`stability-dot-${index}`}
      accessible={false}
    />
  );
}
