// `<Skeleton>` — a token-driven placeholder block.
//
// Feature tasks (T-M-BROWSE, T-M-COLLECTION) compose multiple
// `<Skeleton>`s into list-item / card-grid placeholders. The shell
// just provides the primitive.
//
// We intentionally avoid `react-native-reanimated`'s shimmer here
// — animating the placeholder is a polish concern that belongs in
// a future visual-polish task, and adding the dependency would
// drag the worklets runtime into the cold-start path of every
// route that renders a placeholder.

import { Box, type BoxProps } from '@binderly/ui';

import type { ReactNode } from 'react';

export interface SkeletonProps {
  /** Width — passes through to Tamagui's `width` prop. Defaults to "100%". */
  width?: BoxProps['width'];
  /** Height — passes through to Tamagui's `height` prop. Defaults to 16. */
  height?: BoxProps['height'];
  /** Border radius token. Defaults to `$sm`. */
  borderRadius?: BoxProps['borderRadius'];
  /** Optional accessibility label (defaults to "Loading"). */
  accessibilityLabel?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = '$2',
  accessibilityLabel = 'Loading',
}: SkeletonProps): ReactNode {
  return (
    <Box
      width={width}
      height={height}
      borderRadius={borderRadius}
      backgroundColor="$surfaceMuted"
      opacity={0.7}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
    />
  );
}
