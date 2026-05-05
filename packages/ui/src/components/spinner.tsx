// `<Spinner>` — token-driven loading indicator. Implemented as a
// styled `<View>` with a CSS animation on web (Tamagui's compiler
// emits the keyframes) and a static circle on native (apps that need
// a real animated indicator on native compose `<Spinner>` with their
// own driver — see README).
//
// Sizes are public so `<Button loading>` can size the spinner to the
// surrounding text.

import { View, styled } from '@tamagui/core';

import type { ComponentProps } from 'react';

const SIZE_PX: Record<'sm' | 'md' | 'lg', number> = {
  sm: 12,
  md: 16,
  lg: 24,
};

const SpinnerBase = styled(View, {
  name: 'BinderlySpinner',
  borderRadius: 9999,
  borderWidth: 2,
  borderColor: '$border',
  borderTopColor: '$primary',
  variants: {
    size: {
      sm: { width: SIZE_PX.sm, height: SIZE_PX.sm },
      md: { width: SIZE_PX.md, height: SIZE_PX.md },
      lg: { width: SIZE_PX.lg, height: SIZE_PX.lg },
    },
  } as const,
  defaultVariants: {
    size: 'md',
  },
});

export interface SpinnerProps extends Omit<ComponentProps<typeof SpinnerBase>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** a11y: announces the loading state. Default is `'Loading'`. */
  'aria-label'?: string;
  accessibilityLabel?: string;
}

export function Spinner(props: SpinnerProps): ReturnType<typeof SpinnerBase> {
  const { size = 'md', 'aria-label': ariaLabel = 'Loading', accessibilityLabel, ...rest } = props;

  return (
    <SpinnerBase
      size={size}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      accessibilityLabel={accessibilityLabel ?? ariaLabel}
      {...rest}
    />
  );
}

/** Public for tests + Button to read sizing math. */
export const SPINNER_SIZE_PX: Readonly<Record<'sm' | 'md' | 'lg', number>> = SIZE_PX;
