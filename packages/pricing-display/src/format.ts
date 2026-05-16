// `formatPrice` — pure number-to-localized-currency-string formatter.
//
// A thin, validated wrapper over `Intl.NumberFormat`. Lives in its
// own module so the formatting policy (which locales are
// supported, which currencies short-circuit, what fraction-digit
// behaviour applies) is changeable in one place. The
// conversion-side functions in `convert.ts` call this AFTER they
// have already validated currency / amount, so the validation here
// is a defence-in-depth check — `formatPrice` is also a public
// export, used by call sites that do not need any FX (e.g. the
// "you paid X for this card" acquisition-price display in
// collection-item, which is already in the user's chosen
// currency).
//
// Determinism: `Intl.NumberFormat(locale, …)` output is fixed for
// a given Node version + locale + currency. The package never
// reads `process.env.LANG` or any system-locale state — callers
// always pass the locale explicitly (or accept the documented
// `DEFAULT_LOCALE` fallback). Same inputs ⇒ same output.

import { DEFAULT_LOCALE, SUPPORTED_CURRENCIES, type SupportedCurrency } from './types.js';

/**
 * Validate an ISO-4217 alpha-3 currency code shape — three
 * uppercase Latin letters. Permissive in spirit (we don't enforce
 * the closed ISO list here; that's `assertSupportedCurrency`'s
 * job) but rejects the common typo classes (lowercase, empty
 * string, four letters, leading whitespace).
 *
 * Mirrors `currencyCodeSchema` in `@binderly/api-contracts`'s
 * `common.ts` — re-implemented (not imported) per the
 * pure-logic-package "no `zod` runtime in the consumer graph"
 * rule from `rules/03-shared-packages.md`.
 */
const ISO_4217_ALPHA3_RE = /^[A-Z]{3}$/u;

export function isWellFormedCurrencyCode(code: string): boolean {
  return ISO_4217_ALPHA3_RE.test(code);
}

const SUPPORTED_CURRENCY_SET: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES);

/**
 * `true` iff `code` is one of the currencies the package is
 * willing to convert and format. Callers that want a tighter
 * type narrowing can use the `SupportedCurrency` predicate
 * version below.
 */
export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return SUPPORTED_CURRENCY_SET.has(code);
}

/**
 * Format a numeric amount as a localized currency string.
 *
 * Pure. Same inputs ⇒ same output (modulo the well-known
 * Node-version-pinned `Intl` behaviour).
 *
 * Behaviour:
 *
 *   - `currency` is validated against `isWellFormedCurrencyCode`
 *     and `isSupportedCurrency`. Either failure throws a
 *     `RangeError` — `formatPrice` is the "I have already
 *     validated" entry point; the structured-result entry points
 *     (`convertPrice` and friends) catch the bad-input case and
 *     return `{ ok: false, reason: 'invalid-input' }` instead.
 *   - `amount` MUST be a finite number. Non-finite values
 *     (`NaN`, `+Infinity`, `-Infinity`) throw `RangeError` —
 *     `Intl.NumberFormat` would otherwise emit `'NaN'` /
 *     `'∞'` strings which are useless on a price chip.
 *   - Currency-appropriate fraction digits are applied
 *     automatically by `Intl` (USD → 2, JPY → 0, KWD → 3, etc.).
 *     We never override `minimum/maximumFractionDigits`.
 *   - `locale` defaults to `DEFAULT_LOCALE` (`'en-US'`). An
 *     unknown locale falls through to `Intl.NumberFormat`'s own
 *     resolution (which also defaults to `'en'` family rather
 *     than throwing); we don't second-guess that.
 *
 * Round-tripping through this function is NOT exact for
 * fractional amounts (USD `0.005` formats to `'$0.01'` per
 * banker's rounding) — callers that need byte-exact accounting
 * should keep the underlying `numeric` string and only call
 * `formatPrice` at render time.
 */
export function formatPrice(amount: number, currency: string, locale?: string): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`formatPrice: amount must be finite (got ${String(amount)})`);
  }
  if (!isWellFormedCurrencyCode(currency)) {
    throw new RangeError(
      `formatPrice: currency must be ISO-4217 alpha-3 uppercase (got ${JSON.stringify(currency)})`,
    );
  }
  if (!isSupportedCurrency(currency)) {
    throw new RangeError(
      `formatPrice: currency ${JSON.stringify(currency)} is not in SUPPORTED_CURRENCIES`,
    );
  }
  const resolvedLocale = locale ?? DEFAULT_LOCALE;
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
  }).format(amount);
}
