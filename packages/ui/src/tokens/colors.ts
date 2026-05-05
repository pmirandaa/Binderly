// Palette + semantic colour slots for the Binderly design system.
//
// The palette is the literal pool of colour values. Themes
// (`src/theme/light.ts`, `src/theme/dark.ts`) map _semantic slots_
// onto palette entries. Components reference semantic slots only
// (`$primary`, `$surface`, …) so swapping the palette never touches
// component code.
//
// Brand colours: Q-008 in `open-questions.md` tracks the final brand
// decision. The teal-leaning primary (`#0FA3A3`) and violet-leaning
// secondary (`#7B5DFF`) are v1 defaults chosen for adequate WCAG-AA
// contrast on both shipping themes.

/**
 * Stop keys used in every monochrome / brand ramp. Mirrors Tailwind /
 * Radix conventions so designers reading the file get immediate
 * intuition.
 */
export const COLOR_STOPS = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
] as const;

export type ColorStop = (typeof COLOR_STOPS)[number];

type ColorRamp = Readonly<Record<ColorStop, string>>;

/** Neutral grey ramp — used for text, surfaces, borders. */
export const neutral: ColorRamp = {
  '50': '#F8FAFC',
  '100': '#F1F5F9',
  '200': '#E2E8F0',
  '300': '#CBD5E1',
  '400': '#94A3B8',
  '500': '#64748B',
  '600': '#475569',
  '700': '#334155',
  '800': '#1E293B',
  '900': '#0F172A',
  '950': '#020617',
};

/** Brand teal — primary call-to-action. */
export const teal: ColorRamp = {
  '50': '#ECFEFF',
  '100': '#CFFAFE',
  '200': '#A5F3FC',
  '300': '#67E8F9',
  '400': '#22D3EE',
  '500': '#0FA3A3',
  '600': '#0E8585',
  '700': '#106A6A',
  '800': '#0F5454',
  '900': '#0E4444',
  '950': '#062525',
};

/** Brand violet — secondary surface accent. */
export const violet: ColorRamp = {
  '50': '#F5F3FF',
  '100': '#EDE9FE',
  '200': '#DDD6FE',
  '300': '#C4B5FD',
  '400': '#A78BFA',
  '500': '#7B5DFF',
  '600': '#6D45F0',
  '700': '#5B30D6',
  '800': '#4828A8',
  '900': '#3A2387',
  '950': '#241353',
};

/** Status: success (green ramp). */
export const green: ColorRamp = {
  '50': '#F0FDF4',
  '100': '#DCFCE7',
  '200': '#BBF7D0',
  '300': '#86EFAC',
  '400': '#4ADE80',
  '500': '#22C55E',
  '600': '#16A34A',
  '700': '#15803D',
  '800': '#166534',
  '900': '#14532D',
  '950': '#052E16',
};

/** Status: warning (amber ramp). */
export const amber: ColorRamp = {
  '50': '#FFFBEB',
  '100': '#FEF3C7',
  '200': '#FDE68A',
  '300': '#FCD34D',
  '400': '#FBBF24',
  '500': '#F59E0B',
  '600': '#D97706',
  '700': '#B45309',
  '800': '#92400E',
  '900': '#78350F',
  '950': '#451A03',
};

/** Status: error (red ramp). */
export const red: ColorRamp = {
  '50': '#FEF2F2',
  '100': '#FEE2E2',
  '200': '#FECACA',
  '300': '#FCA5A5',
  '400': '#F87171',
  '500': '#EF4444',
  '600': '#DC2626',
  '700': '#B91C1C',
  '800': '#991B1B',
  '900': '#7F1D1D',
  '950': '#450A0A',
};

/** Status: info (blue ramp). */
export const blue: ColorRamp = {
  '50': '#EFF6FF',
  '100': '#DBEAFE',
  '200': '#BFDBFE',
  '300': '#93C5FD',
  '400': '#60A5FA',
  '500': '#3B82F6',
  '600': '#2563EB',
  '700': '#1D4ED8',
  '800': '#1E40AF',
  '900': '#1E3A8A',
  '950': '#172554',
};

export const palette = {
  white: '#FFFFFF',
  black: '#000000',
  neutral,
  teal,
  violet,
  green,
  amber,
  red,
  blue,
} as const;

export type Palette = typeof palette;

/**
 * Every semantic slot a component may reference. Both the light and
 * dark themes MUST declare every key; the `theme.test.ts` cross-check
 * pins this contract.
 */
export const SEMANTIC_COLOR_SLOTS = [
  // Surfaces
  'background',
  'surface',
  'surfaceElevated',
  'surfaceMuted',
  // Text
  'text',
  'textMuted',
  'textInverse',
  // Borders
  'border',
  'borderStrong',
  'focusRing',
  // Primary
  'primary',
  'primaryHover',
  'primaryPress',
  'primaryDisabled',
  'onPrimary',
  // Secondary
  'secondary',
  'secondaryHover',
  'secondaryPress',
  'secondaryDisabled',
  'onSecondary',
  // Status
  'success',
  'successSurface',
  'warning',
  'warningSurface',
  'error',
  'errorSurface',
  'info',
  'infoSurface',
] as const;

export type SemanticColorSlot = (typeof SEMANTIC_COLOR_SLOTS)[number];

export type SemanticColorScheme = Readonly<Record<SemanticColorSlot, string>>;
