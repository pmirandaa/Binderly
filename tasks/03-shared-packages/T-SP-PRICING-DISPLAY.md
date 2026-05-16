# T-SP-PRICING-DISPLAY — Pricing display package — FX-aware price formatting (lookup rate of observation date)

**Stage:** 03-shared-packages
**Agent role:** backend
**Effort:** M
**Status:** in_review

## Hard dependencies

- T-DL-FX-RATES — populates `fx_rate` (USD-base; `EUR`, `GBP`, `JPY`, `AUD`, `CAD`, `MXN` quotes); the daily rate this package consumes.
- T-BE-API-CONTRACTS — `currentPriceDto`, `priceAggregateDto`, `fxRateDto`, `currencyCodeSchema`. Structurally compatible with the package's `CurrentPriceRow` / `PriceObservationInput` projections; not a runtime import (per `rules/03-shared-packages.md` "no `zod` in shared-package consumer graphs").

## Soft dependencies

- `T-DL-PRICING-CURRENT-VIEW` — `mv_current_price` row shape. Already merged; the package's `CurrentPriceRow` is a structural projection of `currentPriceDto`.

## Required reading

- `PROJECT.md` § 8, § 10 (Core App Features — card detail price section), § 13 (Pricing & Affiliate Strategy — currency model, "store native, convert at display time").
- `rules/03-shared-packages.md` — the stage rules (no I/O, no platform imports, tree-shakable, ≥90% line coverage on pure logic).
- `context/data-model.md` § "Pricing tables", "fx_rate", "price_aggregate", "mv_current_price", "profile.preferences" (the `display_currency` and `locale` keys this package consumes).
- `packages/db/src/schema/price_snapshots.ts` and `prices.ts` — actual Drizzle schemas that emit the rows the display layer renders.
- `data-pipeline/src/adapters/fx/types.ts` — `BINDERLY_FX_BASE_CURRENCY` (always `'USD'`) and `BINDERLY_FX_QUOTE_CURRENCIES` (the six quote currencies the FX cron populates).
- `packages/api-contracts/src/pricing.ts` — `currentPriceDto`, `priceAggregateDto`, `fxRateDto`.
- `packages/set-completion/` and `packages/smart-collection-dsl/` — package posture template (ESM-only, `main`/`types`/`exports` from day 1, vitest, ESLint flat-config inheriting `@binderly/eslint-config/node`).

## Goal

Ship `@binderly/pricing-display`, the pure-logic FX-aware price-display package. The package is the single boundary between the pricing-pipeline tables (`price_observation`, `price_aggregate`, `mv_current_price`, `fx_rate`) — which always store native source currency per `PROJECT.md` § 13 — and the user-facing display surfaces (web card detail, mobile card detail, future portfolio-valuation paths, edge-function enrichment paths). It accepts `(amount, currency, observedAt)` plus a target display currency / locale, looks up the USD-base FX rate that was in effect on the observation's day (with bounded backwards fallback when that exact day is missing), and returns both a structured `ConvertedPrice` and the localized formatted string. No I/O, no async, no DB calls, no `Date.now()` — same inputs always produce the same outputs. Ships the close-out 4-of-4 of Stage 03 shared packages (UI tokens, set-completion, smart-DSL, pricing-display).

## Deliverables

- `packages/pricing-display/package.json` — `@binderly/pricing-display` workspace manifest. ESM only, `main`/`types`/`exports` populated from day one, `files: ["dist", "README.md"]`, scripts mirror `set-completion`'s shape, devDeps mirror `set-completion`'s pinned versions.
- `packages/pricing-display/tsconfig.json` — extends `@binderly/tsconfig/library.json`; outputs to `dist/`; excludes `*.test.ts` and `test-fixtures.ts`.
- `packages/pricing-display/vitest.config.ts` — vitest config; coverage via `@vitest/coverage-v8`; excludes `index.ts` and `test-fixtures.ts` from coverage.
- `packages/pricing-display/eslint.config.js` — ESLint flat config; inherits `@binderly/eslint-config/node`; relaxes `no-explicit-any` and `no-console` for `*.test.ts`.
- `packages/pricing-display/src/types.ts` — `PriceObservationInput`, `FxRateLookup`, `ConversionOptions`, `ConvertedPrice`, `ConversionResult`, `ConversionFailureReason`, `PriceRangeInput`, `ConvertedPriceRange`, `ConversionRangeResult`, `CurrentPriceRow`, `ConvertedCurrentPrice`, `ConvertedCurrentPriceResult`, `SupportedCurrency`. Constants: `SUPPORTED_CURRENCIES`, `FX_BASE_CURRENCY`, `DEFAULT_LOCALE`, `DEFAULT_FALLBACK_WINDOW_DAYS`.
- `packages/pricing-display/src/format.ts` — `formatPrice(amount, currency, locale?)` plus `isWellFormedCurrencyCode` and `isSupportedCurrency` predicates. Throws `RangeError` for bad input (this is the "I have already validated" entry point; the result-envelope entry points catch).
- `packages/pricing-display/src/convert.ts` — `convertPrice(input, opts)`, `convertPriceRange(range, opts)`, and `bestEffortConvert(input, opts)`. Owns the USD-base composition math, the bounded backwards fallback walk, and the cross-currency rate-date reconciliation rule (older leg wins).
- `packages/pricing-display/src/row-helpers.ts` — `convertCurrentPriceRow(row, opts)`. Convenience adapter for `mv_current_price` rows; handles the `string | number | null` wire-form quirks of `numeric(12, 2)` columns.
- `packages/pricing-display/src/index.ts` — public barrel.
- `packages/pricing-display/src/test-fixtures.ts` — `makeFixtureLookup`, `utcDate`, `CANONICAL_WEEK` (a deterministic week of FX rates centered on 2026-04-30). Excluded from build and coverage.
- `packages/pricing-display/src/{format,convert,row-helpers,index}.test.ts` — sibling tests; ≥80 tests total per the AC.
- `packages/pricing-display/README.md` — usage example, the USD-base FX rule called out plainly with the cross-currency math, the failure-mode table, and the link out to the related modules.
- `pnpm-lock.yaml` — auto-regenerated by `pnpm install` after registering the new workspace.
- `dependencies.yaml` — flip the `T-SP-PRICING-DISPLAY` entry: `status: pending` → `status: review`, `stub: true` → `stub: false`.
- `tasks/03-shared-packages/T-SP-PRICING-DISPLAY.md` — this elaborated task file (replaces the prior STUB).

## Acceptance criteria

- [ ] `pnpm install` succeeds with no NEW deprecation warnings beyond the existing inherited list.
- [ ] `pnpm --filter @binderly/pricing-display build` succeeds and emits ESM `dist/src/*.js` + `*.d.ts` files matching the `exports` map.
- [ ] `pnpm --filter @binderly/pricing-display typecheck` passes.
- [ ] `pnpm --filter @binderly/pricing-display test` passes with **at least 80 tests** covering: identity for each supported currency; direct USD↔X conversion; cross conversion (EUR→JPY via USD); exact-date hit; 1-day fallback hit; 7-day fallback hit (default-window edge); fallback exhausted → `'no-rate'`; future-only rates ignored (NEVER walks forward); unsupported target currency → `'unsupported-currency'`; invalid input (NaN, empty currency, lowercase, non-Date observedAt) → `'invalid-input'`; `formatPrice` across `en-US`, `de-DE`, `ja-JP`, `en-GB`; JPY's 0-fraction-digit rule; `convertPriceRange` low/high; `convertCurrentPriceRow` happy path; determinism check (1,000 calls with the same inputs assert deepEqual).
- [ ] `pnpm --filter @binderly/pricing-display lint` reports zero errors and zero warnings.
- [ ] `package.json` mirrors `@binderly/set-completion`'s posture: `"type": "module"`, `"main"` and `"types"` populated, `"exports"` map present, `"files": ["dist", ...]`, scripts include `build` / `typecheck` / `test` / `test:watch`.
- [ ] Module organization under `src/` matches the deliverables list above; each unit-tested in its own `*.test.ts` sibling.
- [ ] `README.md` documents the USD-base FX rule plainly, including the cross-currency composition formula.
- [ ] No changes outside `packages/pricing-display/` other than the pre-authorized `pnpm-lock.yaml`, the `dependencies.yaml` flip, and this task file.
- [ ] `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w build` from the worktree root all pass.

## Out of scope

- Fetching FX rates. The `FxRateLookup` callback is the caller's responsibility; the package never makes network calls.
- Storage / persistence of converted prices. Conversion happens at render time per `PROJECT.md` § 13; cached results are a downstream concern.
- The price-aggregate rollup job (T-DL-PRICING-ROLLUP), the FX-rate cron (T-DL-FX-RATES), and the materialized-view refresh (T-DL-PRICING-CURRENT-VIEW) — all merged upstream.
- UI components (chips, graphs, range bars). Those live in `apps/web` / `apps/mobile` and call this package.
- Portfolio total valuation (`Σ convertPrice(item) for item in collection`). Downstream consumer; lives in the future "Pro tier valuation" task.
- Currency conversion for non-Frankfurter currencies. Adding a currency requires updating both `SUPPORTED_CURRENCIES` here AND `BINDERLY_FX_QUOTE_CURRENCIES` in the FX adapter — out of scope for this task.

## Branch & PR

- Branch: `agent/T-SP-PRICING-DISPLAY`
- PR title: `T-SP-PRICING-DISPLAY: Pricing display package — FX-aware price formatting (lookup rate of observation date)`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and surface to orchestrator if:

- The FX-rate adapter / `fx_rate` schema diverges from what this package assumes (USD-base, the six quotes), invalidating the `SUPPORTED_CURRENCIES` constant.
- A consumer requires a currency outside the canonical set (e.g. Pablo wants CLP for Chile testing).
- The display-time conversion strategy in `PROJECT.md` § 13 changes (e.g. moves to ingest-time conversion or per-user historical conversion).
- A required dependency turns out to be wrong/missing.
- A change is needed outside `packages/pricing-display/` beyond the pre-authorized files.

## Notes from execution

- Picked `SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'MXN']` (USD base + the six Frankfurter quotes from `BINDERLY_FX_QUOTE_CURRENCIES`). The dispatch brief mentioned "six supported currencies"; the actual ingestible set is seven (base + six quotes). Identity tests cover all seven; the `'unsupported-currency'` reason is reserved for catalog gaps (e.g. `'BTC'`).
- Cross-currency `rateDate` reconciliation: when each leg of an X→Y conversion falls back independently, the reported `rateDate` is the **older** of the two underlying `fx_rate.rate_date` values. Rationale documented inline in `convert.ts` — the older date is the limiting factor, so reporting it is honest about freshness.
- Source-currency validation reports `'invalid-input'` (not `'unsupported-currency'`) for currencies outside `SUPPORTED_CURRENCIES`. Rationale: source-currency values originate inside our own pricing pipeline (`price_observation.observed_currency` is set by the adapter); an out-of-set value is a programmer/data error rather than a UI catalog gap. Only the *target* currency surfaces `'unsupported-currency'` (it's the user's choice that may not match our coverage).
- `bestEffortConvert` distinguishes between programmer-error failures (`'invalid-input'`, `'unsupported-currency'` → `RangeError`) and runtime data-gap failures (`'no-rate'` → `Error`). Lets server callers `instanceof RangeError` to surface 400s vs 503s without re-parsing the message.
- `fallbackWindowDays` accepts fractional input (floors to whole days) and negative input (normalizes to 0). Documented + tested.
- Determinism is enforced by avoiding `new Date()` and `Date.now()` entirely; the test that mutates `Date.now` to confirm output is independent is exhibit A.
- 144 tests ship; 80-test floor cleared with headroom. Coverage target ≥ 90% line coverage on pure logic per `rules/03-shared-packages.md` is met by exhaustive case enumeration in `format.test.ts` and `convert.test.ts`.
