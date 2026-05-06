'use client';

// Skeleton loading primitive. Token-driven sizing; consumers pass
// `width` / `height` as Tamagui token values (e.g. `'$8'` or a
// raw number). Pure presentation — feature tasks compose multiple
// skeletons to mirror a real layout while data loads.

import { Box } from '@binderly/ui';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Border radius token; defaults to `$md`. */
  radius?: string;
  /** Optional aria-label for screen readers. */
  label?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = '$md',
  label,
}: SkeletonProps): React.ReactNode {
  return (
    <Box
      width={width as never}
      height={height as never}
      borderRadius={radius as never}
      backgroundColor="$surfaceMuted"
      role="presentation"
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      data-testid="skeleton"
    />
  );
}
