// Public types for `@binderly/pricing-display`.
//
// The package is a pure-logic boundary between two halves of the
// pricing pipeline:
//
//   1. The append-only price observation log (`price_observation`,
//      `price_aggregate`, `mv_current_price`) — every monetary
//      value is stored in its **source currency** (PROJECT.md § 13:
//      "store native, convert at display time").
//   2. The user's display preference
//      (`profile.preferences.display_currency` +
//      `profile.preferences.locale`) — what the user actually sees.
//
// Conversion happens at *render time* using the FX rate of the
// observation's day. The lookup is injected as a callback so the
// package stays I/O-free; callers (server: Drizzle query;
// client: in-memory cache; tests: fixture map) provide the
// strategy.
//
// All `numeric(_, 2)` columns serialize over the wire as decimal
// strings via the postgres-js driver. The DTO row helpers in
// `row-helpers.ts` accept either form (string or number); the
// public `convertPrice` and `formatPrice` entry points take
// `number` to keep the math obvious.
//
// USD-base FX (PROJECT.md § 13 + `packages/db/src/schema/
// price_snapshots.ts`): every `fx_rate` row is `1 USD = rate
// quoteCurrency`. To convert CCY-A → CCY-B we need both
// rate(A) and rate(B):
//
//   amountUsd = amountA / rate(A)
//   amountB   = amountUsd * rate(B)
//
// USD itself is the implicit base (rate = 1; never stored).

// ============================================================
// Supported-currency catalog
// ============================================================

/**
 * The canonical USD base currency for the FX subsystem
 * (`fx_rate.base_currency`, mirrored from
 * `data-pipeline/src/adapters/fx/types.ts`'s
 * `BINDERLY_FX_BASE_CURRENCY`). Pinned as a constant so the
 * conversion math and the "is this the implicit base?"
 * branches can't drift.
 */
export const FX_BASE_CURRENCY = 'USD' as const;

/**
 * Currencies the pricing-display package is willing to format
 * and convert. Sourced from:
 *
 *   - The USD base (`FX_BASE_CURRENCY`).
 *   - The six quote currencies the FX-rate ingest job is
 *     configured to populate
 *     (`BINDERLY_FX_QUOTE_CURRENCIES` =
 *     ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'MXN']).
 *
 * Unknown ISO-4217 codes (`'BTC'`, `'XYZ'`) are rejected with
 * `reason: 'unsupported-currency'` rather than silently
 * proxied through to `Intl.NumberFormat` (which would format
 * them with a generic prefix and mislead the user). Adding a
 * currency requires updating both this list AND the FX-rate
 * adapter's `BINDERLY_FX_QUOTE_CURRENCIES`.
 */
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'MXN'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Default BCP-47 locale used by `formatPrice` and `convertPrice`
 * when the caller does not pass `locale`. `'en-US'` matches the
 * documented default for `profile.preferences.locale` (see
 * `context/data-model.md` § profile.preferences) — the same
 * fallback the api-contracts schema applies on read.
 */
export const DEFAULT_LOCALE = 'en-US';

/**
 * Default fallback window for `convertPrice`. If the rate for
 * `observedAt` is missing, the package walks backwards up to
 * this many days looking for the most recent earlier rate
 * (PROJECT.md § 13: "Missing rate for a date → fall back to
 * most recent prior date and flag the display 'approx.'").
 *
 * Seven days is the working-week-plus-weekend window the FX
 * cron is sized for: Frankfurter publishes Mon–Fri; a
 * three-day weekend (US Memorial Day, etc.) plus the cron's
 * own latency caps real-world gaps at ~5 days. Seven gives
 * head-room without silently masking a multi-week outage.
 */
export const DEFAULT_FALLBACK_WINDOW_DAYS = 7;

// ============================================================
// Inputs
// ============================================================

/**
 * One price quote in its source currency. Mirrors the wire
 * shape of `price_observation` / `price_aggregate` /
 * `mv_current_price` but narrowed to the three fields the
 * display math actually needs.
 *
 * - `amount` — the monetary value. `number` (not the wire-form
 *   decimal string) so the math is obvious; the
 *   `convertCurrentPriceRow` adapter in `row-helpers.ts`
 *   parses the string form for callers handing us a
 *   `CurrentPriceDto` directly.
 * - `currency` — ISO-4217 alpha-3 code. Validated against
 *   `SUPPORTED_CURRENCIES`; unknown codes return
 *   `reason: 'unsupported-currency'`.
 * - `observedAt` — the day the price was real. Used to key
 *   the FX lookup. Time-of-day is intentionally ignored:
 *   `fx_rate` is keyed on calendar date.
 */
export interface PriceObservationInput {
  /** Monetary value in `currency`. Must be a finite, non-NaN number. */
  readonly amount: number;
  /** ISO-4217 alpha-3 code (e.g. `'USD'`, `'JPY'`). */
  readonly currency: string;
  /** When the price was observed. Time-of-day is ignored. */
  readonly observedAt: Date;
}

/**
 * Pure FX-rate lookup callback. Returns the USD-base rate for
 * `targetCurrency` on `date`, or `null` when no rate is
 * available for that exact date.
 *
 * Critical contract:
 *
 *   - Returns `null` (not throws) for a missing rate. The
 *     fallback walk is the package's responsibility; the
 *     lookup is a pure key-value query.
 *   - When `targetCurrency === 'USD'` the lookup MAY return
 *     `null` — the conversion functions short-circuit USD
 *     to `{ rate: 1, rateDate: date }` without consulting the
 *     callback (USD is the implicit base; `fx_rate` doesn't
 *     store `(USD, USD)` rows).
 *   - The returned `rateDate` MUST equal `date` (no
 *     server-side fallback inside the lookup). The package
 *     uses the returned `rateDate` as the authoritative date
 *     for the rate.
 *
 * Server callers wire this to a Drizzle `select(...)
 * .from(fxRateTable).where(...)` indexed on
 * `(rateDate, quoteCurrency)`. Client callers wire it to an
 * in-memory `Map`. Tests wire it to a hand-built fixture.
 */
export type FxRateLookup = (
  targetCurrency: string,
  date: Date,
) => { rate: number; rateDate: Date } | null;

/**
 * Options for `convertPrice` / `convertPriceRange` /
 * `convertCurrentPriceRow`.
 */
export interface ConversionOptions {
  /** Currency the user wants prices displayed in. ISO-4217. */
  readonly targetCurrency: string;
  /**
   * BCP-47 locale used by `Intl.NumberFormat` for the
   * `display` field. Defaults to `DEFAULT_LOCALE`
   * (`'en-US'`) — never read from the host's system locale,
   * so output is deterministic given the same inputs.
   */
  readonly locale?: string;
  /** Required FX-rate lookup callback. */
  readonly rateLookup: FxRateLookup;
  /**
   * If the rate for `observedAt` is missing, walk backwards
   * up to N days for the most recent earlier rate. Defaults
   * to `DEFAULT_FALLBACK_WINDOW_DAYS` (7). Set to 0 to
   * disable fallback entirely (only the exact-date rate is
   * tried). Negative values are treated as 0.
   */
  readonly fallbackWindowDays?: number;
}

// ============================================================
// Outputs
// ============================================================

/**
 * The successful conversion shape. All fields are required —
 * there's no "partially converted" state.
 */
export interface ConvertedPrice {
  /** Numeric amount in `currency`. */
  readonly amount: number;
  /** Target ISO-4217 currency code. */
  readonly currency: SupportedCurrency;
  /**
   * `Intl.NumberFormat(locale, { style: 'currency', currency })
   * .format(amount)` output. Currency-appropriate fraction
   * digits (e.g. JPY → 0, USD → 2) are applied automatically
   * by Intl.
   */
  readonly display: string;
  /**
   * The effective FX rate from the input's currency to
   * `currency` on `rateDate`. `1` for the identity case
   * (input.currency === targetCurrency).
   */
  readonly rate: number;
  /**
   * The date the rate is dated to. Equals `observedAt`'s
   * calendar date when the exact-date rate was available;
   * earlier when fallback was used.
   */
  readonly rateDate: Date;
  /** True iff `input.currency === opts.targetCurrency` (no FX consulted). */
  readonly isIdentity: boolean;
  /** True iff the rate's `rateDate` is earlier than `observedAt`'s calendar date. */
  readonly usedFallback: boolean;
}

/**
 * Reason codes for a failed conversion. Discriminated union
 * with `ConversionResult`.
 *
 * - `'no-rate'` — the FX lookup (with fallback) returned no
 *   rate for the input or target currency within the window.
 *   Caller should render a "price unavailable" placeholder.
 * - `'invalid-input'` — `amount` is NaN/Infinite, `observedAt`
 *   is an invalid Date, or a currency string fails the
 *   ISO-4217 alpha-3 shape check. Programmer error.
 * - `'unsupported-currency'` — a currency string is
 *   well-formed but isn't in `SUPPORTED_CURRENCIES`. Catalog
 *   gap, not a bug — caller should surface a "we don't track
 *   this currency yet" hint.
 */
export type ConversionFailureReason = 'no-rate' | 'invalid-input' | 'unsupported-currency';

/**
 * Result envelope for `convertPrice` and friends. Matches the
 * `{ ok: true; value } | { ok: false; reason; message }`
 * posture used by every other shared package boundary in the
 * monorepo (see `@binderly/smart-collection-dsl`'s parser).
 */
export type ConversionResult =
  | { readonly ok: true; readonly value: ConvertedPrice }
  | { readonly ok: false; readonly reason: ConversionFailureReason; readonly message: string };

// ============================================================
// Range + row-shape adapter inputs
// ============================================================

/**
 * Low/high pair for `convertPriceRange`. Both prices share a
 * `currency` and an `observedAt` (matching the wire shape of
 * `price_aggregate.low_price` / `high_price`).
 */
export interface PriceRangeInput {
  readonly low: number;
  readonly high: number;
  readonly currency: string;
  readonly observedAt: Date;
}

/**
 * Successful range output — both legs converted, paired with
 * the FX-rate metadata (which is identical for both since
 * they share `observedAt` and `currency`).
 */
export interface ConvertedPriceRange {
  readonly low: ConvertedPrice;
  readonly high: ConvertedPrice;
}

export type ConversionRangeResult =
  | { readonly ok: true; readonly value: ConvertedPriceRange }
  | { readonly ok: false; readonly reason: ConversionFailureReason; readonly message: string };

/**
 * Narrowed projection of `currentPriceDto` (from
 * `@binderly/api-contracts`) — the row shape of
 * `mv_current_price`. Re-declared (not imported) to keep the
 * package zero-dep per `rules/03-shared-packages.md`. The
 * structural overlap means a caller can pass a
 * `CurrentPriceDto` directly.
 *
 * Only the four fields the display math touches are required:
 * the central-tendency price, its currency, the period it
 * covers (used as `observedAt`), and the printing/grade keys
 * for round-tripping (`convertCurrentPriceRow` returns them
 * untouched).
 */
export interface CurrentPriceRow {
  readonly printingId: string;
  readonly gradeTier: string;
  readonly market: string;
  readonly currency: string;
  /** ISO-8601 calendar date string `YYYY-MM-DD`. */
  readonly periodStart: string;
  /**
   * Wire form is a decimal string (`numeric(12,2)` over
   * postgres-js); we accept either for ergonomic parity with
   * server-side callers. Null = "no data this day" — the
   * helper returns `{ ok: false, reason: 'no-rate' }`.
   */
  readonly medianPrice: string | number | null;
}

/**
 * Successful current-price-row conversion. Extends
 * `ConvertedPrice` with the printing/grade/market keys so the
 * caller can fan the result back into a UI list without an
 * extra zip.
 */
export interface ConvertedCurrentPrice extends ConvertedPrice {
  readonly printingId: string;
  readonly gradeTier: string;
  readonly market: string;
}

export type ConvertedCurrentPriceResult =
  | { readonly ok: true; readonly value: ConvertedCurrentPrice }
  | { readonly ok: false; readonly reason: ConversionFailureReason; readonly message: string };
