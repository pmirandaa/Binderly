// `<Icon>` — registry-pattern icon primitive. We deliberately do
// **not** ship `lucide-react-native` (or `lucide-react`) as a hard
// dep — both pull native peers (react-native-svg, react-native) that
// would weigh down the shared package and bloat the RSC graph on web.
//
// Apps that want lucide install whichever flavour fits their target
// (`lucide-react` for web, `lucide-react-native` for mobile) and pass
// the icon component through the `as` prop:
//
//   import { Star } from 'lucide-react';
//   <Icon as={Star} size="md" color="$primary" />
//
// `<Icon>` provides only the token-aware sizing + colouring wrapper.

import { View, styled } from '@tamagui/core';
import { createElement, forwardRef, type ComponentType, type ReactNode } from 'react';

export const ICON_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export const ICON_SIZE_PX: Readonly<Record<IconSize, number>> = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

const IconBox = styled(View, {
  name: 'BinderlyIcon',
  alignItems: 'center',
  justifyContent: 'center',
  variants: {
    size: {
      xs: { width: ICON_SIZE_PX.xs, height: ICON_SIZE_PX.xs },
      sm: { width: ICON_SIZE_PX.sm, height: ICON_SIZE_PX.sm },
      md: { width: ICON_SIZE_PX.md, height: ICON_SIZE_PX.md },
      lg: { width: ICON_SIZE_PX.lg, height: ICON_SIZE_PX.lg },
      xl: { width: ICON_SIZE_PX.xl, height: ICON_SIZE_PX.xl },
    },
  } as const,
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Minimum prop set every lucide-flavoured icon component accepts.
 * Both `lucide-react` and `lucide-react-native` ship icons that
 * accept these.
 */
export interface IconRendererProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export interface IconProps {
  /**
   * The icon component to render. Pass any lucide
   * (`Star`, `Search`, …) or other component matching
   * `IconRendererProps`.
   */
  as: ComponentType<IconRendererProps>;
  /** Token-driven size. */
  size?: IconSize;
  /**
   * Stroke colour. Pass a Tamagui colour token (`'$primary'`) for
   * theme-aware rendering, or a literal hex / rgb string. Defaults
   * to `currentColor`-style: inherits from the surrounding `<Text>`
   * via `$text`.
   */
  color?: string;
  /** Stroke width — passed straight through to the icon component. */
  strokeWidth?: number;
  /** Web a11y label. Use `'decorative'` only for icons that duplicate adjacent text. */
  'aria-label'?: string | 'decorative';
  /** RN a11y label. */
  accessibilityLabel?: string;
  /** Optional children — useful for wrapping non-lucide nodes inside the sizing box. */
  children?: ReactNode;
}

export const Icon = forwardRef<HTMLDivElement, IconProps>(function Icon(props, ref) {
  const {
    as: As,
    size = 'md',
    color,
    strokeWidth,
    'aria-label': ariaLabel,
    accessibilityLabel,
    children,
  } = props;

  const decorative = ariaLabel === 'decorative';
  const sizePx = ICON_SIZE_PX[size];
  const rendererProps: IconRendererProps = { size: sizePx };
  if (color !== undefined) rendererProps.color = color;
  if (strokeWidth !== undefined) rendererProps.strokeWidth = strokeWidth;

  return (
    <IconBox
      ref={ref}
      size={size}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : ariaLabel}
      aria-hidden={decorative || undefined}
      accessibilityLabel={accessibilityLabel ?? (decorative ? undefined : ariaLabel)}
    >
      {children ?? createElement(As, rendererProps)}
    </IconBox>
  );
});
