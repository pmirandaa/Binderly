// `<Box>` — the typed layout primitive. Re-exports `View` from
// `@tamagui/core` with no overrides; we own the named import so
// consumers don't have to know `@tamagui/core` exists, and so we can
// extend later without a breaking-change ripple.

import { View } from '@tamagui/core';

import type { ComponentProps } from 'react';

export const Box = View;

export type BoxProps = ComponentProps<typeof Box>;
