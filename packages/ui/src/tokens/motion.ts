// Animation tokens — durations (ms) and easings (CSS cubic-bezier
// strings). RN's `Animated` API accepts both: durations as
// milliseconds and easings via `Easing.bezier(...)` parsed from the
// same coefficients.

export const durations = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
  slowest: 480,
} as const;

export type DurationToken = keyof typeof durations;
export type DurationValue = (typeof durations)[DurationToken];

export const DURATION_ORDER: readonly DurationToken[] = [
  'instant',
  'fast',
  'normal',
  'slow',
  'slowest',
];

/**
 * Easings expressed as CSS cubic-bezier strings. The four-tuple
 * coefficients (parsed from the string) are what RN's
 * `Easing.bezier()` consumes on native.
 */
export const easings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
  decelerate: 'cubic-bezier(0, 0, 0, 1)',
  accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
  linear: 'linear',
} as const;

export type EasingToken = keyof typeof easings;
export type EasingValue = (typeof easings)[EasingToken];
