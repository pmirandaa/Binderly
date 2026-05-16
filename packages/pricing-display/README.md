# `@binderly/pricing-display`

Pure-logic FX-aware price display for Binderly. Takes a price observation (amount + source currency + observation date) and a user's display preference (target currency + format locale), looks up the FX rate that was in effect on the observation date, converts, and returns formatted strings (and structured `ConvertedPrice` objects). No I/O, no async, no DB calls. Same input ⇒ same output, every time. Safe to call from both backend (price-aggregate enrichment paths) and frontend (web card detail + mobile card detail).

## What this package is

- **The single source of truth for "convert at observation date" semantics.** Every monetary value in Binderly is stored in its source currency (PROJECT.md § 13: "store native, convert at display time") and converted at render time using the FX rate of the observation's day. This package owns that conversion.
- **A pure-logic boundary** between the pricing-pipeline tables (`price_observation`, `price_aggregate`, `mv_current_price`, `fx_rate`) and the user-facing display surfaces (web card detail, mobile card detail, future export jobs). Both halves flow in as plain values; the FX-rate lookup is injected as a callback so the package stays I/O-free.
- **Tree-shakable.** Each function exports separately; the barrel only re-exports.

## What this package is NOT

- **Not a fetch / DB / HTTP layer.** The `FxRateLookup` callback is the caller's responsibility (server: Drizzle query against `fx_rate`; client: in-memory cache; tests: fixture map).
- **Not the FX-rate ingestion job.** That's `T-DL-FX-RATES` in `data-pipeline/src/jobs/fx-rates.ts`. We _consume_ the table it populates.
- **Not the price-aggregate rollup.** That's `T-DL-PRICING-ROLLUP`. We accept its output (`price_aggregate`, `mv_current_price` rows) as input.
- **Not a portfolio valuation engine.** "Total collection value in your display currency" is a downstream consumer (PROJECT.md § 16's pro tier, post-MVP). It would call `convertPrice` per row and sum.

## The USD-base FX rule (read this once, then never get it wrong)

Every `fx_rate` row in Binderly is stored **USD-base**: `1 USD = rate quoteCurrency`. USD itself is the implicit base — `(USD, USD, 1.0)` rows do not exist. Per `packages/db/src/schema/price_snapshots.ts` and `data-pipeline/src/adapters/fx/types.ts`.

To convert from CCY-A to CCY-B:

```
amountUsd = amountA / rate(A)        // collapse to USD
amountB   = amountUsd * rate(B)      // expand to target
```

Concretely, for a JPY-priced observation displayed in EUR:

```
1000 JPY → USD: 1000 / 156.56 = 6.387 USD
6.387 USD → EUR: 6.387 * 0.85455 = 5.46 EUR
```

The two short paths fall out of the same equation:

| `input.currency` | `targetCurrency` | rates needed     | math                               |
| ---------------- | ---------------- | ---------------- | ---------------------------------- |
| USD              | X                | rate(X)          | `amountUsd * rate(X)`              |
| X                | USD              | rate(X)          | `amountX / rate(X)`                |
| X                | Y (different)    | rate(X), rate(Y) | `(amountX / rate(X)) * rate(Y)`    |
| X                | X                | none             | identity (rate=1, no FX consulted) |

If you ever find yourself multiplying JPY by `rate(JPY)` to get EUR, stop. The regression test `JPY → EUR — fails the "I forgot which way the rate goes" smoke test` exists to catch exactly that.

## Module map

| File                 | Public surface                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`       | `PriceObservationInput`, `FxRateLookup`, `ConversionOptions`, `ConvertedPrice`, `ConversionResult`, `ConversionFailureReason`, `PriceRangeInput`, `ConvertedPriceRange`, `ConversionRangeResult`, `CurrentPriceRow`, `ConvertedCurrentPrice`, `ConvertedCurrentPriceResult`, `SupportedCurrency`. Also: `SUPPORTED_CURRENCIES`, `FX_BASE_CURRENCY`, `DEFAULT_LOCALE`, `DEFAULT_FALLBACK_WINDOW_DAYS`. |
| `src/format.ts`      | `formatPrice(amount, currency, locale?)` — pure number-to-localized-string formatter. Plus `isWellFormedCurrencyCode` and `isSupportedCurrency` predicates.                                                                                                                                                                                                                                           |
| `src/convert.ts`     | `convertPrice(input, opts) → ConversionResult`. `convertPriceRange(range, opts) → ConversionRangeResult`. `bestEffortConvert(input, opts) → ConvertedPrice` (throws on failure).                                                                                                                                                                                                                      |
| `src/row-helpers.ts` | `convertCurrentPriceRow(row, opts) → ConvertedCurrentPriceResult` — convenience adapter for `mv_current_price` rows.                                                                                                                                                                                                                                                                                  |
| `src/index.ts`       | Public barrel — every external import goes through here.                                                                                                                                                                                                                                                                                                                                              |

## Usage

### Convert a single observation

```ts
import { convertPrice, type FxRateLookup } from '@binderly/pricing-display';

// Caller supplies the lookup. Server uses Drizzle; client uses
// an in-memory cache; tests use a fixture map. Whatever the
// strategy, the contract is the same: return the USD-base rate
// for `targetCurrency` on `date`, or `null` for a miss.
const rateLookup: FxRateLookup = (targetCurrency, date) => {
  const row = fxRateCache.get(`${targetCurrency}|${date.toISOString().slice(0, 10)}`);
  return row ? { rate: row.rate, rateDate: new Date(row.rateDate) } : null;
};

const result = convertPrice(
  {
    amount: 12.5,
    currency: 'USD',
    observedAt: new Date('2026-04-30T00:00:00Z'),
  },
  {
    targetCurrency: 'JPY',
    locale: 'ja-JP',
    rateLookup,
    // fallbackWindowDays defaults to 7
  },
);

if (!result.ok) {
  // Render a "price unavailable" placeholder.
  console.warn(`pricing: ${result.reason} — ${result.message}`);
} else {
  // result.value:
  // {
  //   amount: 1957,
  //   currency: 'JPY',
  //   display: '￥1,957',
  //   rate: 156.56,
  //   rateDate: <2026-04-30 UTC>,
  //   isIdentity: false,
  //   usedFallback: false,
  // }
  renderPriceChip(result.value.display);
}
```

### Convert a price range (low/high)

```ts
import { convertPriceRange } from '@binderly/pricing-display';

const range = convertPriceRange(
  { low: 50, high: 200, currency: 'USD', observedAt: aggregate.periodStart },
  { targetCurrency: profile.preferences.display_currency, rateLookup },
);
if (range.ok) {
  // range.value.low and range.value.high share the same FX rate
  // and rateDate by construction.
  renderRangeChip(range.value.low.display, range.value.high.display);
}
```

### Convert an `mv_current_price` row directly

```ts
import { convertCurrentPriceRow } from '@binderly/pricing-display';

// `row` is the wire shape from the price-history endpoint
// (matches `currentPriceDto` in `@binderly/api-contracts`).
const converted = convertCurrentPriceRow(row, {
  targetCurrency: profile.preferences.display_currency,
  locale: profile.preferences.locale,
  rateLookup,
});
if (converted.ok) {
  // converted.value carries the printingId / gradeTier /
  // market keys round-tripped from the input row, so list
  // rendering can `map` over the results without a manual zip.
}
```

### `bestEffortConvert` (throws on failure)

For server callers that wrap their handler in a try/catch and want straight-line code:

```ts
import { bestEffortConvert } from '@binderly/pricing-display';

const value = bestEffortConvert(
  { amount: 100, currency: 'EUR', observedAt },
  { targetCurrency: 'USD', rateLookup },
);
// `value` is `ConvertedPrice`. Throws `RangeError` for programmer error
// (invalid input, unsupported currency); throws `Error` for missing rate.
```

## Inputs and outputs (contract)

### `convertPrice(input, opts) → ConversionResult`

**Inputs.**

- `input.amount: number` — must be finite (not NaN, not ±Infinity).
- `input.currency: string` — ISO-4217 alpha-3 uppercase (e.g. `'USD'`). Must be in `SUPPORTED_CURRENCIES`.
- `input.observedAt: Date` — must be a valid `Date`. Time-of-day is ignored; the package canonicalizes to UTC midnight.
- `opts.targetCurrency: string` — same shape rules as `input.currency`.
- `opts.locale?: string` — BCP-47 (e.g. `'en-US'`, `'ja-JP'`). Defaults to `'en-US'`. Never reads from system locale state.
- `opts.rateLookup: FxRateLookup` — required.
- `opts.fallbackWindowDays?: number` — defaults to 7. `0` disables fallback. Negative values normalize to `0`. Fractional values floor to whole days.

**Outputs.**

```ts
type ConversionResult =
  | {
      ok: true;
      value: {
        amount: number; // numeric amount in the target currency
        currency: SupportedCurrency;
        display: string; // Intl.NumberFormat output
        rate: number; // composite source→target multiplier
        rateDate: Date; // when the (older) rate was set
        isIdentity: boolean; // input.currency === targetCurrency
        usedFallback: boolean; // rateDate < observedAt's calendar date
      };
    }
  | {
      ok: false;
      reason: 'no-rate' | 'invalid-input' | 'unsupported-currency';
      message: string; // human-readable diagnostic
    };
```

**Failure modes.**

- `'invalid-input'` — `amount` is non-finite, `observedAt` is not a valid Date, or a currency string fails the ISO-4217 alpha-3 shape / membership check (NB: an unsupported source currency is reported as `'invalid-input'`; only the _target_ currency surfaces `'unsupported-currency'`, since the source currency originates in our own pipeline and any unknown value is treated as a programmer error).
- `'unsupported-currency'` — `targetCurrency` is well-formed but not in `SUPPORTED_CURRENCIES`. Catalog gap; UI should surface a "we don't track this currency yet" hint.
- `'no-rate'` — no rate available within the fallback window for the source or target currency. UI should render a "price unavailable" placeholder.

## Edge cases (contract)

- **Identity (source === target).** `rate = 1`, `rateDate = observedAt`, `isIdentity = true`, `usedFallback = false`. The FX-rate callback is **not** consulted.
- **USD as source or target.** Only one leg's rate is needed (USD is the implicit base; rate(USD) = 1 by convention).
- **Cross-currency.** Both legs fall back independently. The reported `rateDate` is the **older** of the two underlying rates (the limiting factor); `usedFallback` is `true` iff either leg used fallback.
- **Fallback walks BACKWARDS only.** Walking forward to a future rate would lie about the historical price. The package rejects future-only rates and returns `'no-rate'`.
- **Time-of-day in `observedAt` is canonicalized to UTC midnight.** A Tokyo collector and a New York collector see the same FX rate applied to the same observation.
- **Lookup returning `rate = 0`** — defensively treated as `'no-rate'` (avoids division-by-zero).
- **Determinism.** Same inputs always produce structurally-equal outputs. No `new Date()`, no `Date.now()`, no system-locale fallback. The only allowed non-determinism is locale-specific `Intl.NumberFormat` output, which is fixed per Node version.

## Tests

```bash
pnpm --filter @binderly/pricing-display test
```

The test suite covers identity for every supported currency, direct USD↔X conversions in both directions, EUR→JPY-via-USD cross composition, exact-date hits, 1-day and 7-day fallback hits, fallback exhaustion, future-rate refusal, unsupported-currency / invalid-input rejection, locale-aware formatting across `en-US`, `de-DE`, `ja-JP`, `en-GB`, JPY's zero-fraction-digits rule, range conversion, the `convertCurrentPriceRow` adapter, and a determinism check that calls `convertPrice` 1,000 times with identical inputs and asserts every output is `deepEqual`.

## Build / typecheck / lint

```bash
pnpm --filter @binderly/pricing-display build      # tsc → dist/src/*.js + *.d.ts
pnpm --filter @binderly/pricing-display typecheck  # tsc --noEmit
pnpm --filter @binderly/pricing-display lint       # eslint --max-warnings=0
```

Same posture as `@binderly/set-completion` and `@binderly/smart-collection-dsl`: ESM only, `main`/`types`/`exports` populated from day one, vitest for tests, ESLint flat-config inheriting from `@binderly/eslint-config/node`, TS extending `@binderly/tsconfig/library`.

## Related modules

- `data-pipeline/src/jobs/fx-rates.ts` — populates the `fx_rate` table this package consumes.
- `data-pipeline/src/adapters/fx/` — the Frankfurter / ECB adapters; pinned to USD base + 6 quote currencies (`EUR`, `GBP`, `JPY`, `AUD`, `CAD`, `MXN`).
- `packages/db/src/schema/price_snapshots.ts` — Drizzle schema for `fx_rate` and `price_aggregate`.
- `packages/db/src/schema/prices.ts` — Drizzle schema for `price_observation` and `market`.
- `packages/api-contracts/src/pricing.ts` — wire-shape DTOs for the price-history endpoint and `mv_current_price`.
- `PROJECT.md` § 13 — pricing strategy, currency model, "convert at display time using the rate of the observation's day".
