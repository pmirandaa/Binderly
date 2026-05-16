// Shared test fixtures for `@binderly/pricing-display`. The
// adapter posture mirrors the public `FxRateLookup` callback so
// fixtures can be plugged into the real `convertPrice` /
// `convertCurrentPriceRow` entry points without any wrapping.
//
// Excluded from production builds via `tsconfig.json`'s
// `exclude` and from coverage via `vitest.config.ts`'s
// `coverage.exclude`.

import type { FxRateLookup } from './types.js';

/**
 * Build a deterministic `FxRateLookup` from a fixture map keyed
 * by `(currency, YYYY-MM-DD)`. Returns `null` for any
 * combination that isn't in the map — exactly matching the
 * documented `FxRateLookup` contract.
 *
 * The map is the canonical "this is what's in the `fx_rate`
 * table" — every lookup the SUT performs is faithfully
 * answered or refused. No fallback, no walks; the package
 * does the walking.
 */
export function makeFixtureLookup(
  fixtures: ReadonlyArray<{ currency: string; date: string; rate: number }>,
): FxRateLookup {
  const index = new Map<string, number>();
  for (const f of fixtures) {
    index.set(`${f.currency}|${f.date}`, f.rate);
  }
  return (currency, date) => {
    const dateKey = isoDateUtc(date);
    const hit = index.get(`${currency}|${dateKey}`);
    if (hit === undefined) return null;
    return { rate: hit, rateDate: parseIsoDateUtc(dateKey) };
  };
}

/**
 * Convenience: produce a UTC-midnight `Date` from `YYYY-MM-DD`.
 */
export function utcDate(yyyymmdd: string): Date {
  return parseIsoDateUtc(yyyymmdd);
}

function isoDateUtc(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function parseIsoDateUtc(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split('-').map((s) => Number(s));
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`utcDate: malformed YYYY-MM-DD ${JSON.stringify(yyyymmdd)}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * A canonical week of FX rates centered on 2026-04-30. Picked
 * from the same time window as the Frankfurter-adapter test
 * fixtures so the numbers feel real.
 *
 * Base = USD; rates are `1 USD = N quoteCurrency`.
 */
export const CANONICAL_WEEK = [
  // 2026-04-24 (Friday)
  { currency: 'EUR', date: '2026-04-24', rate: 0.85901 },
  { currency: 'GBP', date: '2026-04-24', rate: 0.74489 },
  { currency: 'JPY', date: '2026-04-24', rate: 158.74 },
  { currency: 'AUD', date: '2026-04-24', rate: 1.5505 },
  { currency: 'CAD', date: '2026-04-24', rate: 1.3801 },
  { currency: 'MXN', date: '2026-04-24', rate: 17.3201 },

  // 2026-04-27 (Monday — Frankfurter skips weekends)
  { currency: 'EUR', date: '2026-04-27', rate: 0.86012 },
  { currency: 'GBP', date: '2026-04-27', rate: 0.74601 },
  { currency: 'JPY', date: '2026-04-27', rate: 159.04 },
  { currency: 'AUD', date: '2026-04-27', rate: 1.5512 },
  { currency: 'CAD', date: '2026-04-27', rate: 1.3812 },
  { currency: 'MXN', date: '2026-04-27', rate: 17.3304 },

  // 2026-04-28
  { currency: 'EUR', date: '2026-04-28', rate: 0.85616 },
  { currency: 'GBP', date: '2026-04-28', rate: 0.74242 },
  { currency: 'JPY', date: '2026-04-28', rate: 159.74 },
  { currency: 'AUD', date: '2026-04-28', rate: 1.5489 },
  { currency: 'CAD', date: '2026-04-28', rate: 1.3795 },
  { currency: 'MXN', date: '2026-04-28', rate: 17.3001 },

  // 2026-04-29
  { currency: 'EUR', date: '2026-04-29', rate: 0.85702 },
  { currency: 'GBP', date: '2026-04-29', rate: 0.74128 },
  { currency: 'JPY', date: '2026-04-29', rate: 158.95 },
  { currency: 'AUD', date: '2026-04-29', rate: 1.5491 },
  { currency: 'CAD', date: '2026-04-29', rate: 1.3811 },
  { currency: 'MXN', date: '2026-04-29', rate: 17.3192 },

  // 2026-04-30 (the canonical "today" for these tests)
  { currency: 'EUR', date: '2026-04-30', rate: 0.85455 },
  { currency: 'GBP', date: '2026-04-30', rate: 0.74026 },
  { currency: 'JPY', date: '2026-04-30', rate: 156.56 },
  { currency: 'AUD', date: '2026-04-30', rate: 1.5478 },
  { currency: 'CAD', date: '2026-04-30', rate: 1.3789 },
  { currency: 'MXN', date: '2026-04-30', rate: 17.2945 },
] as const;
