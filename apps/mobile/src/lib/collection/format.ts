// Small formatting helpers for the collection surface. Pure +
// side-effect free so they're trivially testable without
// rendering React. Mirrors the posture of `lib/browse/format.ts`.

/**
 * Format a 0..100 percentage as a short human-readable string
 * (`'42%'`). Values outside 0..100 are clamped — defensive against
 * a `safePct` divide-by-zero edge case feeding a `NaN` through.
 *
 * Always emits an integer percent. The package returns floats but
 * the UI never benefits from "42.7%" precision on a cramped row.
 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const clamped = Math.max(0, Math.min(100, value));
  return `${Math.round(clamped)}%`;
}

/**
 * Format `owned / total` as a fraction string (`'12/100'`). Used
 * in the small footnote next to each progress bar. Negative or
 * malformed values are clamped to zero — same defensive posture as
 * {@link formatPercent}.
 */
export function formatCount(owned: number, total: number): string {
  const safeOwned = Math.max(0, Math.floor(owned));
  const safeTotal = Math.max(0, Math.floor(total));
  return `${safeOwned}/${safeTotal}`;
}

/**
 * Bound a percentage into the 0..100 range used by progress bar
 * widths. Identical math to {@link formatPercent} but returns the
 * raw number so the layout layer can pass it to a styled element
 * without re-parsing the formatted string.
 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
