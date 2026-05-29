'use client';

// `<ThemeSwatch>` — a small flat preview thumbnail of a theme, used by
// the settings gallery picker (`<ThemePicker>`). T-SH-THEMES.
//
// Pure presentational: paints the theme's background with a surface
// chip, an accent dot, and two text bars so the owner can eyeball the
// palette before selecting. No gating logic lives here (the picker
// owns lock state); the swatch just renders the colours.

import { YStack, XStack } from '@binderly/ui';

import type { Theme } from './registry';
import type { ReactNode } from 'react';

export interface ThemeSwatchProps {
  readonly theme: Theme;
  /** Square edge length in px. */
  readonly size?: number;
}

export function ThemeSwatch({ theme, size = 56 }: ThemeSwatchProps): ReactNode {
  return (
    <YStack
      width={size}
      height={size}
      borderRadius={10}
      borderWidth={1}
      borderColor={theme.border}
      backgroundColor={theme.background}
      padding={6}
      gap={4}
      justifyContent="space-between"
      data-testid={`theme-swatch-${theme.id}`}
      aria-hidden={true}
    >
      <XStack
        height={10}
        borderRadius={3}
        backgroundColor={theme.surface}
        borderWidth={1}
        borderColor={theme.border}
      />
      <XStack gap={4} alignItems="center">
        <YStack width={10} height={10} borderRadius={10} backgroundColor={theme.accent} />
        <YStack flex={1} height={6} borderRadius={3} backgroundColor={theme.textMuted} />
      </XStack>
    </YStack>
  );
}
