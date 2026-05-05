// Corner radii. `pill` and `circle` resolve to the same large value;
// the names exist so call sites read intuitively (`pill` for a
// horizontal pill button, `circle` for an avatar).

export const radius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  pill: 9999,
  circle: 9999,
} as const;

export type RadiusToken = keyof typeof radius;
export type RadiusValue = (typeof radius)[RadiusToken];

/** Strictly-monotone subset (excludes `pill` / `circle` which alias). */
export const RADIUS_LINEAR_ORDER: readonly RadiusToken[] = [
  'none',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
];
