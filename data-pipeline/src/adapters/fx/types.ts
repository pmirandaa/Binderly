// Zod schemas + TypeScript types for the Frankfurter API
// (https://frankfurter.dev). Mirrors the JSON shapes documented at
// `/v1/{date}`, `/v1/latest`, and `/v1/{from}..{to}`.
//
// All schemas are tolerant in the same direction the rest of the
// pipeline is: unknown extra fields are ignored; type coercion is
// minimal; required fields are enforced. The adapter validates every
// response body against one of these schemas before returning, so
// downstream code can rely on the shapes statically.

import { z } from 'zod';

/**
 * The canonical base currency for Binderly FX rows. Frankfurter's
 * historical default base is EUR; we always pass `?base=USD` to align
 * with the `fx_rate.base_currency` schema comment ("Always 'USD' for
 * v1"). Pinned as a constant so the adapter and the job can't drift.
 */
export const BINDERLY_FX_BASE_CURRENCY = 'USD' as const;

/**
 * Quote currencies Binderly's display layer needs. Sourced from:
 *   - The seven seeded markets in `0009_pricing_rls.sql` (USD, EUR, GBP, JPY).
 *   - Pablo's spec for `profile.preferences.display_currency` (adds AUD, CAD, MXN).
 *
 * USD itself is the base, so it is intentionally absent here — a row
 * `(USD, USD, 1.0)` would be redundant and the schema doesn't expect it.
 */
export const BINDERLY_FX_QUOTE_CURRENCIES = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'MXN'] as const;

export type BinderlyFxQuoteCurrency = (typeof BINDERLY_FX_QUOTE_CURRENCIES)[number];

/**
 * ISO-8601 calendar date, `YYYY-MM-DD`. Used for both request inputs and
 * response `date` / `start_date` / `end_date` fields. Frankfurter is
 * strict about the format on input.
 */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'expected YYYY-MM-DD');

/**
 * `rates` object: ISO-4217 code → numeric rate. Frankfurter publishes
 * uppercase codes; we tolerate any string but enforce numeric values.
 */
const ratesMapSchema = z.record(z.string(), z.number().finite().positive());

/**
 * Response from `/v1/latest` and `/v1/{date}`.
 *
 * Example payload (curl confirmed):
 *
 *   { "amount": 1.0, "base": "USD", "date": "2026-04-30",
 *     "rates": { "EUR": 0.85455, "GBP": 0.74026, "JPY": 156.56, ... } }
 *
 * Note: when the requested `{date}` falls on a weekend / TARGET2
 * holiday, Frankfurter responds 200 with `date` set to the most recent
 * prior business day — callers MUST key persisted rows on the
 * response's `date` rather than the requested date.
 */
export const frankfurterRatesResponseSchema = z.object({
  amount: z.number().positive(),
  base: z.string().min(1),
  date: isoDateSchema,
  rates: ratesMapSchema,
});

export type FrankfurterRatesResponse = z.infer<typeof frankfurterRatesResponseSchema>;

/**
 * Response from `/v1/{from}..{to}`.
 *
 * Example payload (curl confirmed):
 *
 *   { "amount": 1.0, "base": "USD",
 *     "start_date": "2026-04-28", "end_date": "2026-04-30",
 *     "rates": {
 *       "2026-04-28": { "EUR": 0.85616, "GBP": 0.74242, "JPY": 159.74 },
 *       "2026-04-29": { ... },
 *       "2026-04-30": { ... }
 *     } }
 *
 * The outer `rates` is keyed by date string; each value is the same
 * shape as the per-day `rates` map. Holes (weekends / holidays) are
 * absent from the map; the callsite skips them.
 */
export const frankfurterRangeResponseSchema = z.object({
  amount: z.number().positive(),
  base: z.string().min(1),
  start_date: isoDateSchema,
  end_date: isoDateSchema,
  rates: z.record(isoDateSchema, ratesMapSchema),
});

export type FrankfurterRangeResponse = z.infer<typeof frankfurterRangeResponseSchema>;
