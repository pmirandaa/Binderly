// Responsive breakpoints — used on web only at usage time
// (`@media (min-width: …)`). The tokens travel everywhere so a
// shared layout helper can reach for them on either platform; native
// code never resolves them to media queries.

export const breakpoints = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type BreakpointToken = keyof typeof breakpoints;
export type BreakpointValue = (typeof breakpoints)[BreakpointToken];

export const BREAKPOINT_ORDER: readonly BreakpointToken[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

/**
 * Tamagui-shaped media query map. `createTamagui({ media: … })`
 * accepts entries like `{ sm: { minWidth: 640 } }`. Pre-shaping it
 * here keeps the config file readable.
 */
export const media = {
  sm: { minWidth: breakpoints.sm },
  md: { minWidth: breakpoints.md },
  lg: { minWidth: breakpoints.lg },
  xl: { minWidth: breakpoints.xl },
  '2xl': { minWidth: breakpoints['2xl'] },
} as const;

export type MediaQueryToken = keyof typeof media;
