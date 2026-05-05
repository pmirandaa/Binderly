import { palette, type SemanticColorScheme, type SemanticColorSlot } from '../tokens/colors.js';

const { neutral, teal, violet, green, amber, red, blue, white } = palette;

/**
 * Light theme — the app's default. Every semantic slot must resolve
 * to a concrete colour string; the theme test cross-checks
 * `keyof lightTheme === SemanticColorSlot`.
 */
export const lightTheme = {
  // Surfaces
  background: neutral['50'],
  surface: white,
  surfaceElevated: white,
  surfaceMuted: neutral['100'],

  // Text
  text: neutral['900'],
  textMuted: neutral['600'],
  textInverse: white,

  // Borders + focus
  border: neutral['200'],
  borderStrong: neutral['400'],
  focusRing: teal['400'],

  // Primary
  primary: teal['500'],
  primaryHover: teal['600'],
  primaryPress: teal['700'],
  primaryDisabled: teal['200'],
  onPrimary: white,

  // Secondary
  secondary: violet['500'],
  secondaryHover: violet['600'],
  secondaryPress: violet['700'],
  secondaryDisabled: violet['200'],
  onSecondary: white,

  // Status
  success: green['600'],
  successSurface: green['100'],
  warning: amber['600'],
  warningSurface: amber['100'],
  error: red['600'],
  errorSurface: red['100'],
  info: blue['600'],
  infoSurface: blue['100'],
} as const satisfies Record<SemanticColorSlot, string> & SemanticColorScheme;

export type LightTheme = typeof lightTheme;
