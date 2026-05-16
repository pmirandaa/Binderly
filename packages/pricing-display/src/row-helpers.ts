// `convertCurrentPriceRow` — convenience adapter for converting an
// `mv_current_price` row directly. Backend enrichment paths
// (T-BE-EDGE-FUNCTIONS price-history endpoint, the card-detail
// SSR loader in `apps/web/src/app/...`) read the materialized
// view, then need to fan it out per (printing × grade × market)
// converted into the user's display currency. This helper saves
// them from manually projecting the row shape into
// `PriceObservationInput` every time AND handles the wire-form
// `string | number | null` quirks of `numeric(12, 2)` columns.
//
// Pure. No I/O. Same posture as the rest of the package — the
// caller still supplies `rateLookup`.

import { convertPrice } from './convert.js';

import type { ConversionOptions, ConvertedCurrentPriceResult, CurrentPriceRow } from './types.js';

/**
 * Convert one row from `mv_current_price` (or the structurally-
 * compatible `currentPriceDto` from `@binderly/api-contracts`)
 * into the user's display currency.
 *
 * Behaviour:
 *
 *   - `medianPrice === null` short-circuits to
 *     `{ ok: false, reason: 'no-rate', message: ... }`. The
 *     materialized view emits null when the daily rollup found
 *     zero observations after outlier filtering — semantically
 *     "no data for this slice", which the UI renders as a
 *     "—" / "price unavailable" placeholder. Reusing the
 *     `'no-rate'` reason keeps consumers' switch-statements
 *     small (UI shows the same chip whether the gap was
 *     missing FX or missing observations).
 *   - `medianPrice` as a wire-form decimal string is parsed
 *     with `Number(...)`. Non-finite results
 *     (`Number('not-a-number')`) propagate through to
 *     `convertPrice`'s validator and surface as
 *     `'invalid-input'`.
 *   - `periodStart` is parsed as `YYYY-MM-DD` and treated as
 *     UTC midnight (`new Date('2026-04-30')` parses to UTC
 *     midnight per ECMA-262 § 21.4.3.2). Timezone math is
 *     deliberately not the helper's job.
 *   - The printing/grade/market keys round-trip onto the
 *     output unchanged — callers can hand the result straight
 *     back to a list-rendering helper without zipping against
 *     the source row.
 */
export function convertCurrentPriceRow(
  row: CurrentPriceRow,
  opts: ConversionOptions,
): ConvertedCurrentPriceResult {
  if (row.medianPrice === null) {
    return {
      ok: false,
      reason: 'no-rate',
      message:
        `convertCurrentPriceRow: row for printing ${row.printingId} / grade ${row.gradeTier} / ` +
        `market ${row.market} has medianPrice === null (no data this period)`,
    };
  }

  const amount = typeof row.medianPrice === 'number' ? row.medianPrice : Number(row.medianPrice);

  const observedAt = parsePeriodStart(row.periodStart);
  if (observedAt === null) {
    return {
      ok: false,
      reason: 'invalid-input',
      message:
        `convertCurrentPriceRow: invalid periodStart ${JSON.stringify(row.periodStart)} ` +
        `(expected YYYY-MM-DD)`,
    };
  }

  const result = convertPrice({ amount, currency: row.currency, observedAt }, opts);
  if (!result.ok) {
    return { ok: false, reason: result.reason, message: result.message };
  }
  return {
    ok: true,
    value: {
      ...result.value,
      printingId: row.printingId,
      gradeTier: row.gradeTier,
      market: row.market,
    },
  };
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * Parse a `YYYY-MM-DD` string to a `Date` at UTC midnight.
 * Returns `null` for any non-matching string. We don't fall
 * through to `new Date(input)` because that would silently
 * accept a wider input space (`'2026'`, `'2026-13-40'`,
 * `'2026/04/30'`) and let bogus rows squeak through.
 */
function parsePeriodStart(periodStart: string): Date | null {
  if (typeof periodStart !== 'string') return null;
  const match = ISO_DATE_RE.exec(periodStart);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Reject calendar over/under-flow (e.g. month=13, day=32). We
  // round-trip the parsed components through `Date.UTC` and
  // compare to the input — JS will silently roll over a day=32
  // in February into March 4, which we treat as malformed input.
  const utcMs = Date.UTC(year, month - 1, day);
  const candidate = new Date(utcMs);
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}
