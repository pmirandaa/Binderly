// `<XStack>` / `<YStack>` — horizontal and vertical layout primitives
// from `@tamagui/core`. Re-exported with Binderly defaults baked in
// via `styled()`; consumers always read tokens from
// `@binderly/ui` and never reach into `@tamagui/core` themselves.

import { Stack as TamaguiStack, styled } from '@tamagui/core';

import type { ComponentProps } from 'react';

export const XStack = styled(TamaguiStack, {
  name: 'BinderlyXStack',
  flexDirection: 'row',
});

export const YStack = styled(TamaguiStack, {
  name: 'BinderlyYStack',
  flexDirection: 'column',
});

export const Stack = TamaguiStack;

export type XStackProps = ComponentProps<typeof XStack>;
export type YStackProps = ComponentProps<typeof YStack>;
export type StackProps = ComponentProps<typeof Stack>;
