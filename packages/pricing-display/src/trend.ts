// Pure trend-direction + percent-change formatting for the
// headline current price.
//
// The `mv_current_price` v2 enrichment (migration `0028` / #FU-5)
// pre-buckets a trend `direction` server-side (±1% dead-band on the
// 30-day trend) and emits signed percent-change strings
// (`trend30dPct` etc.). This module turns those wire values into the
// arrow glyph + signed `%` copy the card-detail surfaces render.
// Living here keeps web (`CardPriceBlock`) and mobile (`PriceBlock`)
// rendering the headline trend identically — neither re-implements
// the sign / arrow / label policy.
//
// Pure: no IO, same inputs ⇒ same output. The package stays zero-dep
// (per `rules/03-shared-packages.md`), so the direction union is
// re-declared here rather than imported from `@binderly/api-contracts`
// — the same posture `CurrentPriceRow` takes in `types.ts`. It is kept
// in lock-step with `priceTrendDirectionSchema`'s
// `PRICE_TREND_DIRECTIONS`; a structurally identical
// `api-contracts` `PriceTrendDirection` passes straight through.

/**
 * Bucketed trend direction for the headline price. Mirrors
 * `PRICE_TREND_DIRECTIONS` in `@binderly/api-contracts`:
 *   - `'up'`      — 30-day trend ≥ +1%.
 *   - `'down'`    — 30-day trend ≤ −1%.
 *   - `'flat'`    — within the ±1% dead-band.
 *   - `'unknown'` — no 30-day reference (too new / no history).
 */
export type PriceTrendDirection = 'up' | 'down' | 'flat' | 'unknown';

const TREND_ARROWS: Record<PriceTrendDirection, string> = {
  up: '\u25B2', // ▲
  down: '\u25BC', // ▼
  flat: '\u2192', // →
  unknown: '',
};

/**
 * The arrow glyph for a trend direction. `'unknown'` returns an
 * empty string — callers should suppress the whole trend affordance
 * in that case (there is nothing meaningful to point at).
 */
export function trendArrow(direction: PriceTrendDirection): string {
  return TREND_ARROWS[direction];
}

const TREND_LABELS: Record<PriceTrendDirection, string> = {
  up: 'Up',
  down: 'Down',
  flat: 'Flat',
  unknown: 'No trend',
};

/**
 * Short, screen-reader-friendly label for a trend direction. Used
 * for accessibility labels where the bare arrow glyph would not read
 * out usefully.
 */
export function trendDirectionLabel(direction: PriceTrendDirection): string {
  return TREND_LABELS[direction];
}

/**
 * Whether a direction carries a renderable trend. `'unknown'` (and
 * `null` / `undefined`) is treated as "no trend to show". A type guard
 * so callers narrow to the renderable `'up' | 'down' | 'flat'` subset
 * (e.g. for indexing a per-direction tone/colour map).
 */
export function hasRenderableTrend(
  direction: PriceTrendDirection | null | undefined,
): direction is 'up' | 'down' | 'flat' {
  return direction === 'up' || direction === 'down' || direction === 'flat';
}

/**
 * Format a signed percent-change value (e.g. the `trend30dPct`
 * `numeric(_, 2)` wire string `"-4.20"`, or a number) as a display
 * string with an explicit sign and two fraction digits:
 *
 *   `"8.40"`  → `"+8.40%"`
 *   `-4.2`    → `"-4.20%"`
 *   `"0"`     → `"0.00%"`   (no `+` on an exact-zero trend)
 *
 * Returns `null` for `null` / `undefined` / non-finite inputs so the
 * caller can suppress the trend affordance rather than render `NaN%`.
 * Pure — same inputs ⇒ same output.
 */
export function formatTrendPercent(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
