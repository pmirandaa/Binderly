// `<Text>` — typed typography primitive with a closed set of
// variants. Variant resolution is data-driven (see the `variants`
// table) so adding / removing a variant is a one-line change in
// `tokens/typography.ts` + a row here.
//
// We intentionally don't expose every Tamagui style prop as part of
// the public type surface — `<Text>` consumers stick to variants and
// the few semantic colour shortcuts ("muted", "inverse"). Apps that
// need raw style escape hatches use `<Box>` instead.

import { Text as TamaguiText, styled } from '@tamagui/core';

import { TEXT_VARIANTS, type TextVariant } from '../tokens/typography.js';

import type { ComponentProps } from 'react';

const TEXT_VARIANT_STYLES: Record<TextVariant, Record<string, unknown>> = {
  display: {
    fontFamily: '$heading',
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: '$heading',
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  subtitle: {
    fontFamily: '$heading',
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: 0,
  },
  body: {
    fontFamily: '$body',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: 0,
  },
  bodySmall: {
    fontFamily: '$body',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
  caption: {
    fontFamily: '$body',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    letterSpacing: 0.4,
  },
  label: {
    fontFamily: '$body',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0,
  },
  monospace: {
    fontFamily: '$mono',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
};

export const TEXT_VARIANT_NAMES = TEXT_VARIANTS;

export const Text = styled(TamaguiText, {
  name: 'BinderlyText',
  color: '$text',
  variants: {
    variant: TEXT_VARIANT_STYLES,
    tone: {
      default: { color: '$text' },
      muted: { color: '$textMuted' },
      inverse: { color: '$textInverse' },
      primary: { color: '$primary' },
      secondary: { color: '$secondary' },
      success: { color: '$success' },
      warning: { color: '$warning' },
      error: { color: '$error' },
      info: { color: '$info' },
    },
    weight: {
      regular: { fontWeight: '400' },
      medium: { fontWeight: '500' },
      semibold: { fontWeight: '600' },
      bold: { fontWeight: '700' },
    },
  } as const,
  defaultVariants: {
    variant: 'body',
    tone: 'default',
  },
});

export type TextTone =
  | 'default'
  | 'muted'
  | 'inverse'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export type TextProps = ComponentProps<typeof Text>;
export type { TextVariant };

/** Exposed for tests that pin variant ↔ size relationships. */
export const TEXT_VARIANT_FONT_SIZE: Readonly<Record<TextVariant, number>> = {
  display: 40,
  title: 28,
  subtitle: 20,
  body: 16,
  bodySmall: 14,
  caption: 12,
  label: 14,
  monospace: 14,
};
