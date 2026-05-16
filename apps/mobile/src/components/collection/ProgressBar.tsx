// `<ProgressBar>` — small, token-driven horizontal progress bar
// for the collection's per-set rows + the global completion badge.
//
// Tamagui's `YStack`/`XStack` give us the surface; we render two
// nested stacks where the inner one's width is a percentage. The
// outer track gets `$surfaceMuted`, the fill gets `$accent` (or
// the caller-supplied tone).
//
// Kept dumb on purpose: no animation, no interaction. The
// CollectionScreen owns layout, this owns the visual.

import { XStack, YStack } from '@binderly/ui';

import { clampPercent } from '../../lib/collection/format.js';

import type { ReactNode } from 'react';

export type ProgressBarTone = 'set' | 'master' | 'global';

const TONE_BACKGROUND = {
  set: '$primary',
  master: '$secondary',
  global: '$success',
} as const;

export interface ProgressBarProps {
  /** Percentage in the 0..100 range. Clamped defensively. */
  readonly value: number;
  /** Visual tone — `'set'` is the headline bar, `'master'` is the secondary. */
  readonly tone?: ProgressBarTone;
  /** Track height in pixels. Defaults to 6. */
  readonly height?: number;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

export function ProgressBar(props: ProgressBarProps): ReactNode {
  const value = clampPercent(props.value);
  const tone = props.tone ?? 'set';
  const height = props.height ?? 6;
  return (
    <XStack
      width="100%"
      height={height}
      borderRadius={height}
      backgroundColor="$surfaceMuted"
      overflow="hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
    >
      <YStack
        width={`${value}%` as `${number}%`}
        height="100%"
        backgroundColor={TONE_BACKGROUND[tone]}
        testID={props.testID !== undefined ? `${props.testID}-fill` : undefined}
        // Set a non-zero minWidth so a 1% value still paints a
        // visible nub instead of a rounding-zero sliver.
        minWidth={value > 0 ? 2 : 0}
      />
    </XStack>
  );
}
