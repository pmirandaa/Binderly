import { palette, type SemanticColorScheme, type SemanticColorSlot } from '../tokens/colors.js';

const { neutral, teal, violet, green, amber, red, blue } = palette;

/**
 * Dark theme — every semantic slot must resolve to a concrete colour.
 * Distinctness from `lightTheme` is asserted in the theme test
 * (background, surface, text, etc. must all differ).
 */
export const darkTheme = {
  // Surfaces
  background: neutral['950'],
  surface: neutral['900'],
  surfaceElevated: neutral['800'],
  surfaceMuted: neutral['800'],

  // Text
  text: neutral['50'],
  textMuted: neutral['300'],
  textInverse: neutral['900'],

  // Borders + focus
  border: neutral['800'],
  borderStrong: neutral['700'],
  focusRing: teal['300'],

  // Primary
  primary: teal['400'],
  primaryHover: teal['300'],
  primaryPress: teal['200'],
  primaryDisabled: teal['800'],
  onPrimary: neutral['950'],

  // Secondary
  secondary: violet['400'],
  secondaryHover: violet['300'],
  secondaryPress: violet['200'],
  secondaryDisabled: violet['800'],
  onSecondary: neutral['950'],

  // Status
  success: green['400'],
  successSurface: green['900'],
  warning: amber['400'],
  warningSurface: amber['900'],
  error: red['400'],
  errorSurface: red['900'],
  info: blue['400'],
  infoSurface: blue['900'],
} as const satisfies Record<SemanticColorSlot, string> & SemanticColorScheme;

export type DarkTheme = typeof darkTheme;
