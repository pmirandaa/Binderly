// `<Pressable>` — cross-platform press target. Wraps Tamagui's
// `Stack` with `pressStyle` + `hoverStyle` (web-only via Tamagui's
// platform fork), `disabled` short-circuit, and a11y forwarding.
// Consumers reach for `<Pressable>` when they need an interactive
// surface that isn't a Button (a card-as-link, a tap-to-expand row,
// a custom chip).

import { Stack as TamaguiStack, styled } from '@tamagui/core';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';

const PressableBase = styled(TamaguiStack, {
  name: 'BinderlyPressable',
  cursor: 'pointer',
  userSelect: 'none',
  variants: {
    variant: {
      default: {
        backgroundColor: 'transparent',
      },
      ghost: {
        backgroundColor: 'transparent',
        hoverStyle: { backgroundColor: '$surfaceMuted' },
        pressStyle: { backgroundColor: '$surfaceMuted', opacity: 0.8 },
      },
    },
    disabled: {
      true: {
        opacity: 0.5,
        cursor: 'not-allowed',
      },
    },
  } as const,
  defaultVariants: {
    variant: 'default',
  },
});

type BasePressableProps = ComponentProps<typeof PressableBase>;

export interface PressableProps extends Omit<BasePressableProps, 'onPress'> {
  /** Press handler. Suppressed when `disabled === true`. */
  onPress?: () => void;
  /** Disable interaction; sets `aria-disabled` + RN `accessibilityState`. */
  disabled?: boolean;
  /** Variant — `'default'` (no surface) or `'ghost'` (faint hover/press surface). */
  variant?: 'default' | 'ghost';
  /** Web a11y label. Forwarded to the underlying Tamagui primitive. */
  'aria-label'?: string;
  /** RN a11y label. Forwarded to the underlying Tamagui primitive. */
  accessibilityLabel?: string;
  children?: ReactNode;
}

export const Pressable = forwardRef<HTMLDivElement, PressableProps>(function Pressable(props, ref) {
  const {
    onPress,
    disabled = false,
    variant = 'default',
    'aria-label': ariaLabel,
    accessibilityLabel,
    children,
    ...rest
  } = props;

  const safePress = disabled
    ? undefined
    : (event?: { preventDefault?: () => void }) => {
        if (event && typeof event.preventDefault === 'function') {
          // Tamagui forwards onPress with the underlying RN/web event;
          // keep behaviour consistent across platforms.
        }
        onPress?.();
      };

  return (
    <PressableBase
      ref={ref}
      role={ariaLabel ? 'button' : undefined}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      accessibilityLabel={accessibilityLabel ?? ariaLabel}
      accessibilityState={{ disabled }}
      // The Tamagui Stack onPress signature is intentionally permissive;
      // we narrow it to a no-arg callback at the public surface.
      onPress={safePress as BasePressableProps['onPress']}
      disabled={disabled}
      variant={variant}
      {...rest}
    >
      {children}
    </PressableBase>
  );
});
