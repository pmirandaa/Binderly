// Brand tokens used by the OG renderer.
//
// `next/og` (Satori) compiles inline styles only — no external
// stylesheets, no CSS-in-JS runtime — so we cannot pull tokens
// out of `@binderly/ui` at render time without dragging the
// whole Tamagui runtime through Satori's CSS subset (which it
// does not understand). Instead we hardcode the small subset
// the OG card needs, sourced literally from
// `packages/ui/src/tokens/colors.ts` so a future palette swap
// can be done in two places.
//
// Colours kept in sync manually — `og.brand.test.ts` cross-
// checks the values against `flatColorTokens` to fail loudly if
// the design system drifts ahead of this file.

export const BRAND = {
  // packages/ui/src/tokens/colors.ts — `teal.500`
  primary: '#0FA3A3',
  // packages/ui/src/tokens/colors.ts — `teal.700`
  primaryDark: '#106A6A',
  // packages/ui/src/tokens/colors.ts — `violet.500`
  secondary: '#7B5DFF',
  // packages/ui/src/tokens/colors.ts — `neutral.950`
  background: '#020617',
  // packages/ui/src/tokens/colors.ts — `neutral.900`
  surface: '#0F172A',
  // packages/ui/src/tokens/colors.ts — `neutral.50`
  text: '#F8FAFC',
  // packages/ui/src/tokens/colors.ts — `neutral.400`
  textMuted: '#94A3B8',
  // packages/ui/src/tokens/colors.ts — `neutral.300`
  textDim: '#CBD5E1',
} as const;

/**
 * The CSS gradient string used by the card background. Linear
 * gradient from background → primary-dark → secondary so the
 * card has a subtle brand-coloured glow without competing with
 * the foreground content.
 */
export const BRAND_BACKGROUND_GRADIENT = `linear-gradient(135deg, ${BRAND.background} 0%, ${BRAND.primaryDark} 60%, ${BRAND.secondary} 100%)`;
