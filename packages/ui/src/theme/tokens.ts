// Tamagui-shape token bag. `createTokens` from `@tamagui/core`
// expects a `{ color, space, size, radius, zIndex, font* }` object.
// We assemble that here so `createTamagui` (in `src/config.ts`) only
// has to call into pre-shaped data.

import { createTokens } from '@tamagui/core';

import { palette } from '../tokens/colors.js';
import { radius } from '../tokens/radius.js';
import { space } from '../tokens/space.js';
import { fontSizes, fontWeights, letterSpacings, lineHeights } from '../tokens/typography.js';
import { zIndex } from '../tokens/z-index.js';

const colorTokens: Record<string, string> = {
  white: palette.white,
  black: palette.black,
};

for (const [rampName, ramp] of Object.entries(palette)) {
  if (typeof ramp === 'string') continue;
  for (const [stop, value] of Object.entries(ramp)) {
    colorTokens[`${rampName}${stop}`] = value;
  }
}

/** Re-exported for tests that want to assert the flattened shape. */
export const flatColorTokens: Readonly<Record<string, string>> = { ...colorTokens };

/**
 * `size` is Tamagui's "abstract size" scale used by Stack height /
 * width helpers. We map it 1:1 onto the spacing scale so consumers
 * have a single mental model.
 */
const sizeTokens = { ...space };

const radiusTokens = {
  $0: radius.none,
  $1: radius.xs,
  $2: radius.sm,
  $3: radius.md,
  $4: radius.lg,
  $5: radius.xl,
  $6: radius['2xl'],
  $true: radius.md,
} as const;

const zIndexTokens = {
  $0: zIndex.base,
  $1: zIndex.raised,
  $2: zIndex.dropdown,
  $3: zIndex.sticky,
  $4: zIndex.banner,
  $5: zIndex.overlay,
  $6: zIndex.modal,
  $7: zIndex.popover,
  $8: zIndex.toast,
  $9: zIndex.tooltip,
} as const;

export const tamaguiTokens = createTokens({
  color: colorTokens,
  space: { ...space, $true: space.$4 },
  size: { ...sizeTokens, $true: sizeTokens.$4 },
  radius: radiusTokens,
  zIndex: zIndexTokens,
});

/** Plain object containing every typography scale, for tests + consumers. */
export const typographyTokens = {
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacings,
} as const;
