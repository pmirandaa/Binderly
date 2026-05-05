// Typography tokens — fonts, sizes, weights, line-heights, letter
// spacings. v1 ships system fonts only; the package README documents
// the swap path apps can use to load a custom font.

/**
 * System font stacks. RN's default font fallback already maps to
 * the platform's system UI font (San Francisco / Roboto), so the
 * literal stack only matters on web.
 */
export const fonts = {
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  heading: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export type FontFamilyToken = keyof typeof fonts;

/**
 * Font size scale. Numeric keys mirror Tamagui's `$1`-`$12` size
 * convention so `<Text size="$5">` reads as 16px.
 */
export const fontSizes = {
  $1: 11,
  $2: 12,
  $3: 14,
  $4: 15,
  $5: 16,
  $6: 18,
  $7: 20,
  $8: 24,
  $9: 28,
  $10: 32,
  $11: 40,
  $12: 48,
} as const;

export type FontSizeToken = keyof typeof fontSizes;
export type FontSizeValue = (typeof fontSizes)[FontSizeToken];

export const FONT_SIZE_ORDER: readonly FontSizeToken[] = [
  '$1',
  '$2',
  '$3',
  '$4',
  '$5',
  '$6',
  '$7',
  '$8',
  '$9',
  '$10',
  '$11',
  '$12',
];

/**
 * Numeric font weights as strings (matches CSS spec; RN accepts the
 * same string form).
 */
export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type FontWeightToken = keyof typeof fontWeights;
export type FontWeightValue = (typeof fontWeights)[FontWeightToken];

/**
 * Line-heights — keyed off the same `$1`-`$12` scale as fontSizes.
 * Each entry is the absolute pixel line-height for the matching size,
 * tuned for ~1.2 (display) → ~1.5 (body) ratios.
 */
export const lineHeights = {
  $1: 16,
  $2: 16,
  $3: 20,
  $4: 22,
  $5: 24,
  $6: 26,
  $7: 28,
  $8: 32,
  $9: 36,
  $10: 40,
  $11: 48,
  $12: 56,
} as const;

export type LineHeightToken = keyof typeof lineHeights;
export type LineHeightValue = (typeof lineHeights)[LineHeightToken];

export const letterSpacings = {
  tight: -0.5,
  normal: 0,
  wide: 0.4,
} as const;

export type LetterSpacingToken = keyof typeof letterSpacings;
export type LetterSpacingValue = (typeof letterSpacings)[LetterSpacingToken];

/**
 * Named text variants — every Text component consumer uses one of
 * these. The matching style table lives in `src/components/text.tsx`;
 * the inventory here is the contract.
 */
export const TEXT_VARIANTS = [
  'display',
  'title',
  'subtitle',
  'body',
  'bodySmall',
  'caption',
  'label',
  'monospace',
] as const;

export type TextVariant = (typeof TEXT_VARIANTS)[number];
