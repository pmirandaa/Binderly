// Top-level Tamagui config. `createTamagui()` glues the tokens, the
// themes, the media-query map, and the type-augmentation seed
// together. The output is consumed by:
//
//   - `src/provider/ui-provider.tsx` (mounts <TamaguiProvider config>).
//   - `tamagui.config.ts` at the package root, which is the file
//     bundlers (Next.js + Expo Tamagui plugins) expect at
//     `@binderly/ui/tamagui.config`.
//
// Tamagui's docs require a default export from the file to drive the
// type-augmentation. We provide both default + named exports so RSC
// imports and bundler imports both find what they want.

import { createTamagui } from '@tamagui/core';

import { themes } from './theme/index.js';
import { tamaguiTokens } from './theme/tokens.js';
import { media } from './tokens/breakpoints.js';
import {
  fontSizes,
  fontWeights,
  fonts as fontStacks,
  letterSpacings,
  lineHeights,
} from './tokens/typography.js';

const baseFont = {
  family: fontStacks.body,
  size: fontSizes,
  lineHeight: lineHeights,
  weight: fontWeights,
  letterSpacing: letterSpacings,
};

const headingFont = {
  ...baseFont,
  family: fontStacks.heading,
};

const monoFont = {
  ...baseFont,
  family: fontStacks.mono,
};

export const tamaguiConfig = createTamagui({
  tokens: tamaguiTokens,
  themes,
  media,
  fonts: {
    body: baseFont,
    heading: headingFont,
    mono: monoFont,
  },
  defaultFont: 'body',
  shorthands: {},
  settings: {
    allowedStyleValues: 'somewhat-strict',
    autocompleteSpecificTokens: 'except-special',
  },
});

export type TamaguiConfig = typeof tamaguiConfig;

declare module '@tamagui/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig;
