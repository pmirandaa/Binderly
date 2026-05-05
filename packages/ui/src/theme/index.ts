export { darkTheme, type DarkTheme } from './dark.js';
export { lightTheme, type LightTheme } from './light.js';
export { flatColorTokens, tamaguiTokens, typographyTokens } from './tokens.js';

import { darkTheme } from './dark.js';
import { lightTheme } from './light.js';

/** Theme name union — the only valid argument to `<UIProvider theme="…">`. */
export const THEME_NAMES = ['light', 'dark'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/**
 * Map every theme name to its semantic-slot map. Tamagui's
 * `createTamagui({ themes })` expects exactly this shape.
 */
export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

export type Themes = typeof themes;
