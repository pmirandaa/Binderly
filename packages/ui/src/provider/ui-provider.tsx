'use client';

// `<UIProvider>` — the single mounting point for Binderly's design
// system. Wrap the root of every app (Next.js layout, Expo root) with
// this component once; every `<Box>` / `<Text>` / `<Button>` below it
// resolves tokens through Tamagui's runtime.
//
// We mark this file `"use client"` because Tamagui's
// `<TamaguiProvider>` mounts a React context. Server components
// can still freely import `<Box>` / `<Text>` / tokens from
// `@binderly/ui` — those primitives are RSC-safe; only this provider
// needs the directive.

import { TamaguiProvider, type TamaguiProviderProps } from '@tamagui/core';

import { tamaguiConfig } from '../config.js';
import { THEME_NAMES, type ThemeName } from '../theme/index.js';

import type { ReactNode } from 'react';

export interface UIProviderProps {
  /** Tree to render inside the provider. */
  children: ReactNode;
  /**
   * Initial theme. Apps that observe OS-level light/dark switches can
   * pass a derived value here on each render — Tamagui will swap
   * themes without re-mounting children.
   *
   * @default 'light'
   */
  defaultTheme?: ThemeName;
  /**
   * Optional override for whether Tamagui should disable its CSS
   * reset on web. Apps that already ship a CSS reset (Tailwind,
   * normalize.css) pass `disableInjectCSS` to avoid the double
   * reset. Defaults to `false` (we inject our own minimal reset
   * so plain Next.js apps look right out of the box).
   */
  disableInjectCSS?: TamaguiProviderProps['disableInjectCSS'];
  /** Hook to disable Tamagui's root-theme class injection on web. */
  disableRootThemeClass?: TamaguiProviderProps['disableRootThemeClass'];
}

/**
 * Cross-platform Tamagui provider with the Binderly config baked in.
 * Idempotent: mounting more than one in the same tree is supported
 * but unnecessary.
 */
export function UIProvider(props: UIProviderProps): ReactNode {
  const {
    children,
    defaultTheme = 'light',
    disableInjectCSS = false,
    disableRootThemeClass,
  } = props;

  return (
    <TamaguiProvider
      config={tamaguiConfig}
      defaultTheme={defaultTheme}
      disableInjectCSS={disableInjectCSS}
      disableRootThemeClass={disableRootThemeClass}
    >
      {children}
    </TamaguiProvider>
  );
}

export { THEME_NAMES };
export type { ThemeName };
