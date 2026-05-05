// `<Button>` — the canonical CTA. Composes `<Pressable>` + a
// variant/size-aware surface + a `<Text>` label + an optional inline
// `<Spinner>` (for loading state).
//
// Variant ↔ size matrix is the public contract; tests pin every
// cell. `disabled` and `loading` both block `onPress`; `loading`
// additionally sets `aria-busy="true"` and swaps the label for a
// spinner.

import { Stack as TamaguiStack, styled } from '@tamagui/core';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';

import { Spinner } from './spinner.js';
import { Text } from './text.js';

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/**
 * Pixel sizing per `size`. Public so tests can pin
 * `lg.height > md.height > sm.height`.
 */
export const BUTTON_SIZE_METRICS: Readonly<
  Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number }>
> = {
  sm: { height: 32, paddingHorizontal: 12, fontSize: 14 },
  md: { height: 40, paddingHorizontal: 16, fontSize: 15 },
  lg: { height: 48, paddingHorizontal: 20, fontSize: 16 },
};

const VARIANT_STYLES = {
  primary: {
    backgroundColor: '$primary',
    hoverStyle: { backgroundColor: '$primaryHover' },
    pressStyle: { backgroundColor: '$primaryPress' },
    color: '$onPrimary',
  },
  secondary: {
    backgroundColor: '$secondary',
    hoverStyle: { backgroundColor: '$secondaryHover' },
    pressStyle: { backgroundColor: '$secondaryPress' },
    color: '$onSecondary',
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '$border',
    hoverStyle: { backgroundColor: '$surfaceMuted' },
    pressStyle: { backgroundColor: '$surfaceMuted', opacity: 0.8 },
    color: '$text',
  },
  destructive: {
    backgroundColor: '$error',
    hoverStyle: { backgroundColor: '$error', opacity: 0.9 },
    pressStyle: { backgroundColor: '$error', opacity: 0.8 },
    color: '$textInverse',
  },
} as const;

const ButtonSurface = styled(TamaguiStack, {
  name: 'BinderlyButton',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 8,
  cursor: 'pointer',
  userSelect: 'none',
  variants: {
    variant: {
      primary: {
        backgroundColor: '$primary',
        hoverStyle: { backgroundColor: '$primaryHover' },
        pressStyle: { backgroundColor: '$primaryPress' },
      },
      secondary: {
        backgroundColor: '$secondary',
        hoverStyle: { backgroundColor: '$secondaryHover' },
        pressStyle: { backgroundColor: '$secondaryPress' },
      },
      ghost: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '$border',
        hoverStyle: { backgroundColor: '$surfaceMuted' },
        pressStyle: { backgroundColor: '$surfaceMuted', opacity: 0.8 },
      },
      destructive: {
        backgroundColor: '$error',
        hoverStyle: { backgroundColor: '$error', opacity: 0.9 },
        pressStyle: { backgroundColor: '$error', opacity: 0.8 },
      },
    },
    size: {
      sm: {
        height: BUTTON_SIZE_METRICS.sm.height,
        paddingHorizontal: BUTTON_SIZE_METRICS.sm.paddingHorizontal,
      },
      md: {
        height: BUTTON_SIZE_METRICS.md.height,
        paddingHorizontal: BUTTON_SIZE_METRICS.md.paddingHorizontal,
      },
      lg: {
        height: BUTTON_SIZE_METRICS.lg.height,
        paddingHorizontal: BUTTON_SIZE_METRICS.lg.paddingHorizontal,
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
    variant: 'primary',
    size: 'md',
  },
});

type SurfaceProps = ComponentProps<typeof ButtonSurface>;

export interface ButtonProps extends Omit<
  SurfaceProps,
  'onPress' | 'children' | 'variant' | 'size' | 'disabled'
> {
  /** Press handler. Suppressed when `disabled` or `loading`. */
  onPress?: () => void;
  /** Variant — see `BUTTON_VARIANTS`. */
  variant?: ButtonVariant;
  /** Size — see `BUTTON_SIZES`. */
  size?: ButtonSize;
  /** Disabled state — short-circuits `onPress`, dims surface. */
  disabled?: boolean;
  /** Loading state — replaces label with `<Spinner>`, sets `aria-busy`. */
  loading?: boolean;
  /** Text label (preferred over `children` for typography parity). */
  label?: string;
  /** Web a11y label. */
  'aria-label'?: string;
  /** RN a11y label. */
  accessibilityLabel?: string;
  /** Custom child (e.g. an icon + label) — only honoured when `label` is unset. */
  children?: ReactNode;
}

export const Button = forwardRef<HTMLDivElement, ButtonProps>(function Button(props, ref) {
  const {
    onPress,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    label,
    'aria-label': ariaLabel,
    accessibilityLabel,
    children,
    ...rest
  } = props;

  const inactive = disabled || loading;
  const safePress = inactive ? undefined : onPress;
  const labelColor = VARIANT_STYLES[variant].color;
  const labelFontSize = BUTTON_SIZE_METRICS[size].fontSize;
  const spinnerSize: 'sm' | 'md' = size === 'sm' ? 'sm' : 'md';

  return (
    <ButtonSurface
      ref={ref}
      variant={variant}
      size={size}
      disabled={inactive || undefined}
      role="button"
      aria-label={ariaLabel ?? label}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      accessibilityLabel={accessibilityLabel ?? ariaLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={safePress as SurfaceProps['onPress']}
      {...rest}
    >
      {loading ? <Spinner size={spinnerSize} aria-label="Loading" /> : null}
      {!loading && label ? (
        <Text
          variant="label"
          style={{ color: undefined, fontSize: labelFontSize }}
          color={labelColor}
        >
          {label}
        </Text>
      ) : null}
      {!loading && !label ? children : null}
    </ButtonSurface>
  );
});
