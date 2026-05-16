// `convertPrice`, `convertPriceRange`, and `bestEffortConvert` —
// the FX-aware conversion entry points.
//
// These are pure functions over `(observation, fxRateTable, options)
// → ConvertedPrice` (or a result envelope). No I/O, no async, no
// `new Date()`, no system-locale reads. Same inputs ⇒ same output.
//
// The conversion math (PROJECT.md § 13 + the
// `packages/db/src/schema/price_snapshots.ts` schema comment):
//
//   `fx_rate` rows are USD-base — `1 USD = rate quoteCurrency`.
//   USD itself is the implicit base (rate = 1; never stored).
//
//   To convert CCY-A → CCY-B we need both rate(A) and rate(B):
//
//     amountUsd = amountA / rate(A)        // collapse to USD
//     amountB   = amountUsd * rate(B)      // expand to target
//
//   The two short paths fall out of the same equation:
//
//     A === USD: amountUsd = amountA, amountB = amountA * rate(B)
//     B === USD: amountUsd = amountA / rate(A), amountB = amountUsd
//     A === B  : identity, rate = 1, no FX consulted
//
// Fallback rule (PROJECT.md § 13: "Missing rate for a date → fall
// back to most recent prior date and flag the display 'approx.'"):
// each leg of a cross-currency conversion falls back independently;
// if either rate is unavailable on `observedAt` we walk backwards
// up to `fallbackWindowDays` (default 7). Both legs share the
// SAME walk: we step day-by-day from `observedAt` and require
// EITHER rate to be present at each candidate date BEFORE moving
// on. The reported `rateDate` is the older of the two legs (the
// limiting factor), and `usedFallback` is `true` iff that date is
// earlier than `observedAt`.
//
// We never walk *forward* from `observedAt` — historical pricing
// pages would show today's rates applied to an old observation,
// which is exactly the lie the "convert at observation date" rule
// exists to prevent.

import { formatPrice, isSupportedCurrency, isWellFormedCurrencyCode } from './format.js';
import {
  DEFAULT_FALLBACK_WINDOW_DAYS,
  DEFAULT_LOCALE,
  FX_BASE_CURRENCY,
  type ConversionOptions,
  type ConversionRangeResult,
  type ConversionResult,
  type ConvertedPrice,
  type FxRateLookup,
  type PriceObservationInput,
  type PriceRangeInput,
  type SupportedCurrency,
} from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Convert a single price observation into the user's display
 * currency. Returns a discriminated-union result envelope so
 * the caller can branch on `ok` and never sees a thrown
 * exception for the expected failure modes ("no rate",
 * "unsupported currency", "garbage input"). The
 * `bestEffortConvert` companion below throws instead, for
 * callers that want exception-flow.
 *
 * Pure. Same inputs ⇒ same output.
 */
export function convertPrice(
  input: PriceObservationInput,
  opts: ConversionOptions,
): ConversionResult {
  const inputErr = validateObservationInput(input);
  if (inputErr !== null) {
    return { ok: false, reason: 'invalid-input', message: inputErr };
  }

  const targetErr = validateTargetCurrency(opts.targetCurrency);
  if (targetErr !== null) {
    return { ok: false, reason: targetErr.reason, message: targetErr.message };
  }

  const sourceCurrency = input.currency;
  const targetCurrency = opts.targetCurrency;

  if (sourceCurrency === targetCurrency) {
    return {
      ok: true,
      value: buildIdentity(input, opts.locale),
    };
  }

  const window = normalizeFallbackWindow(opts.fallbackWindowDays);
  const conversion = lookupCrossRate({
    rateLookup: opts.rateLookup,
    sourceCurrency,
    targetCurrency: targetCurrency as SupportedCurrency,
    observedAt: input.observedAt,
    fallbackWindowDays: window,
  });

  if (conversion === null) {
    return {
      ok: false,
      reason: 'no-rate',
      message:
        `no FX rate available to convert ${sourceCurrency} → ${targetCurrency} ` +
        `for ${isoDate(input.observedAt)} (looked back up to ${window} day(s))`,
    };
  }

  const convertedAmount = input.amount * conversion.effectiveRate;
  return {
    ok: true,
    value: {
      amount: convertedAmount,
      currency: targetCurrency as SupportedCurrency,
      display: formatPrice(convertedAmount, targetCurrency, opts.locale ?? DEFAULT_LOCALE),
      rate: conversion.effectiveRate,
      rateDate: conversion.rateDate,
      isIdentity: false,
      usedFallback: conversion.usedFallback,
    },
  };
}

/**
 * Range form of `convertPrice` — converts both ends of a
 * `(low, high)` pair using the SAME FX rate (since both share
 * `currency` and `observedAt`). Saves the caller from
 * dispatching two `convertPrice` calls and reconciling the
 * `rate` / `rateDate` / `usedFallback` flags between them.
 *
 * If either input fails validation or no rate is available,
 * the WHOLE range fails — there's no meaningful "we converted
 * the high but not the low" state.
 */
export function convertPriceRange(
  range: PriceRangeInput,
  opts: ConversionOptions,
): ConversionRangeResult {
  const lowResult = convertPrice(
    { amount: range.low, currency: range.currency, observedAt: range.observedAt },
    opts,
  );
  if (!lowResult.ok) {
    return { ok: false, reason: lowResult.reason, message: `low: ${lowResult.message}` };
  }
  // Reuse the rate path for the high leg by calling convertPrice
  // again — the lookup is pure, so calling it twice with the
  // same `(currency, date)` pair is a deterministic no-cost
  // O(1) re-query in practice and keeps the failure semantics
  // identical (no chance of "low used fallback, high didn't").
  const highResult = convertPrice(
    { amount: range.high, currency: range.currency, observedAt: range.observedAt },
    opts,
  );
  if (!highResult.ok) {
    return { ok: false, reason: highResult.reason, message: `high: ${highResult.message}` };
  }
  return {
    ok: true,
    value: { low: lowResult.value, high: highResult.value },
  };
}

/**
 * Throws-on-failure variant of `convertPrice`. Useful for
 * server callers that already wrap their request handler in a
 * try/catch and want to write straight-line code, and for
 * tests that just want to assert the happy path.
 *
 * Throws `RangeError` for `'invalid-input'` and
 * `'unsupported-currency'` (programmer error / catalog gap),
 * `Error` for `'no-rate'` (data gap — the runtime equivalent
 * of "render a 'price unavailable' chip").
 */
export function bestEffortConvert(
  input: PriceObservationInput,
  opts: ConversionOptions,
): ConvertedPrice {
  const result = convertPrice(input, opts);
  if (result.ok) return result.value;
  if (result.reason === 'no-rate') {
    throw new Error(`bestEffortConvert: ${result.message}`);
  }
  throw new RangeError(`bestEffortConvert: ${result.message}`);
}

// ============================================================
// Internals
// ============================================================

interface CrossRateOutcome {
  /**
   * The composite rate from `sourceCurrency` to
   * `targetCurrency`. Multiplying `amountSource` by this
   * yields `amountTarget`.
   */
  readonly effectiveRate: number;
  /**
   * The OLDER of the two underlying `fx_rate.rate_date` values
   * (or the single value when one leg is USD). The "older"
   * choice is conservative: if rate(EUR) was set on D and
   * rate(JPY) on D-3, the conversion is only as good as
   * D-3 — we don't pretend it's fresher.
   */
  readonly rateDate: Date;
  /** True iff `rateDate` is earlier than `observedAt`'s calendar date. */
  readonly usedFallback: boolean;
}

interface CrossRateArgs {
  readonly rateLookup: FxRateLookup;
  readonly sourceCurrency: string;
  readonly targetCurrency: SupportedCurrency;
  readonly observedAt: Date;
  readonly fallbackWindowDays: number;
}

function lookupCrossRate(args: CrossRateArgs): CrossRateOutcome | null {
  const { sourceCurrency, targetCurrency } = args;

  // USD-base shortcut: only one leg's rate is needed.
  if (sourceCurrency === FX_BASE_CURRENCY) {
    const targetLeg = lookupSingleLeg(
      args.rateLookup,
      targetCurrency,
      args.observedAt,
      args.fallbackWindowDays,
    );
    if (targetLeg === null) return null;
    return {
      effectiveRate: targetLeg.rate,
      rateDate: targetLeg.rateDate,
      usedFallback: targetLeg.usedFallback,
    };
  }
  if (targetCurrency === FX_BASE_CURRENCY) {
    const sourceLeg = lookupSingleLeg(
      args.rateLookup,
      sourceCurrency,
      args.observedAt,
      args.fallbackWindowDays,
    );
    if (sourceLeg === null) return null;
    if (sourceLeg.rate === 0) {
      // Defensive: avoid division-by-zero. A zero quote rate
      // would only happen if the lookup is buggy (real FX rates
      // are strictly positive); treat it as "no rate" so the
      // caller renders a placeholder rather than `Infinity`.
      return null;
    }
    return {
      effectiveRate: 1 / sourceLeg.rate,
      rateDate: sourceLeg.rateDate,
      usedFallback: sourceLeg.usedFallback,
    };
  }

  // Cross-currency: need rate(source) AND rate(target). Fall
  // each leg back independently, then reconcile.
  const sourceLeg = lookupSingleLeg(
    args.rateLookup,
    sourceCurrency,
    args.observedAt,
    args.fallbackWindowDays,
  );
  if (sourceLeg === null) return null;
  if (sourceLeg.rate === 0) return null;
  const targetLeg = lookupSingleLeg(
    args.rateLookup,
    targetCurrency,
    args.observedAt,
    args.fallbackWindowDays,
  );
  if (targetLeg === null) return null;

  const effectiveRate = (1 / sourceLeg.rate) * targetLeg.rate;
  const olderRateDate =
    sourceLeg.rateDate.getTime() <= targetLeg.rateDate.getTime()
      ? sourceLeg.rateDate
      : targetLeg.rateDate;
  return {
    effectiveRate,
    rateDate: olderRateDate,
    usedFallback: sourceLeg.usedFallback || targetLeg.usedFallback,
  };
}

interface SingleLegOutcome {
  readonly rate: number;
  readonly rateDate: Date;
  readonly usedFallback: boolean;
}

/**
 * Look up the USD-base rate for `currency` on `observedAt`,
 * walking backwards up to `fallbackWindowDays` if the exact
 * date is missing. Returns `null` if the entire window is
 * empty.
 */
function lookupSingleLeg(
  rateLookup: FxRateLookup,
  currency: string,
  observedAt: Date,
  fallbackWindowDays: number,
): SingleLegOutcome | null {
  const observedDate = atUtcMidnight(observedAt);
  for (let offset = 0; offset <= fallbackWindowDays; offset++) {
    const candidate = new Date(observedDate.getTime() - offset * MS_PER_DAY);
    const hit = rateLookup(currency, candidate);
    if (hit !== null) {
      // Trust the lookup's reported `rateDate`; we use
      // `offset > 0` (NOT `hit.rateDate < observedAt`) as the
      // fallback signal so a lookup that returns the requested
      // date verbatim is internally consistent.
      return {
        rate: hit.rate,
        rateDate: hit.rateDate,
        usedFallback: offset > 0,
      };
    }
  }
  return null;
}

function buildIdentity(input: PriceObservationInput, locale: string | undefined): ConvertedPrice {
  const currency = input.currency as SupportedCurrency;
  return {
    amount: input.amount,
    currency,
    display: formatPrice(input.amount, currency, locale ?? DEFAULT_LOCALE),
    rate: 1,
    rateDate: atUtcMidnight(input.observedAt),
    isIdentity: true,
    usedFallback: false,
  };
}

function validateObservationInput(input: PriceObservationInput): string | null {
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
    return `amount must be a finite number (got ${String(input.amount)})`;
  }
  if (typeof input.currency !== 'string' || input.currency.length === 0) {
    return `currency must be a non-empty string (got ${JSON.stringify(input.currency)})`;
  }
  if (!isWellFormedCurrencyCode(input.currency)) {
    return `currency must be ISO-4217 alpha-3 uppercase (got ${JSON.stringify(input.currency)})`;
  }
  if (!isSupportedCurrency(input.currency)) {
    return `currency ${JSON.stringify(input.currency)} is not in SUPPORTED_CURRENCIES`;
  }
  if (!(input.observedAt instanceof Date) || Number.isNaN(input.observedAt.getTime())) {
    return `observedAt must be a valid Date (got ${String(input.observedAt)})`;
  }
  return null;
}

function validateTargetCurrency(
  currency: string,
): { reason: 'invalid-input' | 'unsupported-currency'; message: string } | null {
  if (typeof currency !== 'string' || currency.length === 0) {
    return {
      reason: 'invalid-input',
      message: `targetCurrency must be a non-empty string (got ${JSON.stringify(currency)})`,
    };
  }
  if (!isWellFormedCurrencyCode(currency)) {
    return {
      reason: 'invalid-input',
      message: `targetCurrency must be ISO-4217 alpha-3 uppercase (got ${JSON.stringify(currency)})`,
    };
  }
  if (!isSupportedCurrency(currency)) {
    return {
      reason: 'unsupported-currency',
      message: `targetCurrency ${JSON.stringify(currency)} is not in SUPPORTED_CURRENCIES`,
    };
  }
  return null;
}

function normalizeFallbackWindow(window: number | undefined): number {
  if (window === undefined) return DEFAULT_FALLBACK_WINDOW_DAYS;
  if (!Number.isFinite(window)) return DEFAULT_FALLBACK_WINDOW_DAYS;
  if (window < 0) return 0;
  // Truncate fractional values: walking 1.5 days is not a thing.
  return Math.floor(window);
}

/**
 * Strip time-of-day from a `Date`, returning a new `Date` at
 * `00:00:00.000Z` on the same UTC calendar day. We standardize
 * on UTC because:
 *
 *   - `fx_rate.rate_date` is `date` (no timezone).
 *   - `price_observation.observed_date` is documented as
 *     "`(observed_at AT TIME ZONE 'UTC')::date` when the
 *     source's local listing date isn't available".
 *   - Display-time conversion shouldn't shift the calendar
 *     day a price was observed on based on the viewer's local
 *     timezone — a Tokyo collector and a New York collector
 *     should see the same FX rate applied to the same
 *     observation.
 */
function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date: Date): string {
  return atUtcMidnight(date).toISOString().slice(0, 10);
}
