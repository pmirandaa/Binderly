# T-DL-FX-RATES — Daily FX rate ingestion (Frankfurter) for display-time conversion

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** S (~half day)
**Status:** pending

---

## Hard dependencies

- T-DL-SCHEMA-PRICING (merged — `fx_rate` table + RLS already on `main`)

## Soft dependencies

- T-DL-SEED-INGEST (concurrent in iter 6 — both tasks may create
  `data-pipeline/src/jobs/index.ts`; coordinate via the additive-barrel
  pattern documented in `data-pipeline/src/adapters/index.ts`).

## Required reading

- `PROJECT.md` § 13 ("Currency model: store native, convert at display time")
- `rules/01-data-layer.md` ("Prices are stored in source currency. … Conversion
  happens at display time using `fx_rate` for the observation's date.")
- `context/conventions.md`
- `packages/db/src/schema/price_snapshots.ts` (`fx_rate` table shape)
- `packages/db/src/migrations/0008_pricing_tables.sql` (DDL — confirms PK)
- `packages/db/src/migrations/0009_pricing_rls.sql` (RLS posture — service-role-write only)
- `data-pipeline/src/http/rate-limited-client.ts` (mandatory HTTP surface)
- `data-pipeline/src/adapters/tcgdex-en/{adapter,adapter.test}.ts` (FetchShim
  test pattern; conservative single-host adapter shape)
- Frankfurter API: <https://frankfurter.dev> — `GET /v1/{date}` (single date),
  `GET /v1/{from}..{to}` (range), `GET /v1/latest` (most recent business day),
  `GET /v1/currencies` (supported list).

## Goal

Populate `fx_rate` daily so the display layer (`packages/pricing-display`,
T-SP-PRICING-DISPLAY) can convert prices from the observation's source
currency into the user's display currency. Phase-1 quick win that unblocks
the entire pricing surface — no observations are useful to a UK user
without USD→GBP, EUR→GBP, JPY→GBP… on hand.

We pull from **Frankfurter** (free, no auth, ECB-aligned, JSON) and upsert
into the existing `fx_rate` table. Backfilling support is included so we
can hydrate historical rates the moment Phase 2 ships price data.

## Source rationale

| Candidate | Auth | Format | Coverage | Verdict |
| --- | --- | --- | --- | --- |
| **Frankfurter** (`api.frankfurter.dev/v1`) | None | JSON | EUR/GBP/JPY/AUD/CAD/MXN all present (confirmed via `/v1/currencies`) | **Picked** |
| ECB direct (`eurofxref-daily.xml`) | None | XML | EUR-base only; weekend/holiday gaps; XML | Rejected (XML, EUR-base mismatch) |
| open.er-api.com | None | JSON | Broader (1000s of currencies) | Reserved as fallback if Frankfurter ever drops a currency we need |

Note: the long-standing `api.frankfurter.app` host now serves empty 200s in
prod (curl confirmed); the canonical host is `api.frankfurter.dev/v1`.

### Market coverage

The `market` table seeds (in `0009_pricing_rls.sql`) cover four currencies:
`USD, EUR, GBP, JPY` (eBay US/DE/UK/JP, Cardmarket, TCGplayer-derived,
Other). Profile.preferences.display_currency may also be `AUD, CAD, MXN`
— Pablo specified the seven Binderly markets explicitly. Frankfurter
publishes all seven. Pinning to a single base = `USD` keeps the row count
bounded (6 rows/day) and lets the display layer derive any cross-currency
rate transitively (`EUR→GBP = (USD→GBP) / (USD→EUR)`), which is the same
posture documented on `fx_rate.baseCurrency` ("Always 'USD' for v1 …
The display layer derives any cross-currency rate transitively through
the base").

## Schema deviation note

The task brief assumed `fx_rate` UNIQUE on
`(rate_date, base_currency, quote_currency, source)`. The merged schema
(`0008_pricing_tables.sql` + `price_snapshots.ts`) actually carries the
PK on `(rate_date, base_currency, quote_currency)` — `source` is a
metadata column, not part of the key. Implication: if someone re-runs
the job with a different `source` value (e.g. switches to ECB), the
upsert overwrites in place rather than creating a parallel row. This is
the documented intent (the schema comment explicitly says
`'frankfurter', 'ecb', 'openexchangerates'` are alternative sources for
the same row). Documented here so the orchestrator doesn't flag it
during review. **No schema changes in this PR.**

## Deliverables

| Path | Purpose |
| --- | --- |
| `data-pipeline/src/adapters/fx/index.ts` | Public barrel (re-exports the client + types). |
| `data-pipeline/src/adapters/fx/types.ts` | Zod schemas for Frankfurter `latest` / `historical` / `range` responses + supported-currency list constant. |
| `data-pipeline/src/adapters/fx/frankfurter.ts` | `FrankfurterClient` — thin wrapper around `RateLimitedClient` with `getLatest()`, `getHistorical(date)`, `getRange(from, to)`. Validates with zod, surfaces `NotFoundError` for too-old dates. |
| `data-pipeline/src/adapters/fx/frankfurter.test.ts` | FetchShim tests: happy path (latest, historical, range), 404, malformed JSON, 429 retry. |
| `data-pipeline/src/jobs/fx-rates.ts` | `runFxRatesIngest(opts)` — orchestrates Frankfurter fetch + upsert. Defines `FxRateRepo` interface and `FxRatesReport` shape. |
| `data-pipeline/src/jobs/fx-rates.test.ts` | Unit tests with `InMemoryFxRateRepo`: `--latest`, `--date`, `--from-date/--to-date`, idempotent re-run, weekend fallback, partial failure. |
| `data-pipeline/src/jobs/index.ts` | Barrel — `export * from './fx-rates.js';` (additive; coordinate with T-DL-SEED-INGEST). |
| `data-pipeline/scripts/fx-rates.ts` | CLI entry — argv parser → `runFxRatesIngest` → JSON report on stdout, exit code 0/1. |
| `data-pipeline/src/index.ts` | Append `export * from './jobs/index.js';` once. |
| `data-pipeline/src/adapters/index.ts` | Append `=== T-DL-FX-RATES ===` section with `export * from './fx/index.js';`. |
| `data-pipeline/package.json` | Add `"fx-rates": "tsx scripts/fx-rates.ts"` script + `tsx` devDependency. |
| `data-pipeline/README.md` | Mention the FX-rates job + CLI usage in a new short section. |

## Design decisions

### `FxRateRepo` boundary

The job depends on a tiny interface, not on Drizzle directly:

```ts
interface FxRateRepo {
  upsertMany(rows: NewFxRate[]): Promise<number>; // returns rows written
}
```

The CLI wires the production implementation (Drizzle `db.insert(fxRateTable)
  .values(rows)
  .onConflictDoUpdate({ target: [rateDate, baseCurrency, quoteCurrency], set: { rate, source, fetchedAt } })`).
Tests inject `InMemoryFxRateRepo`. This mirrors the seed-ingest task's
expected boundary and means the job is unit-testable without a live
Postgres.

### Date semantics & weekend handling

ECB doesn't publish on weekends or TARGET2 holidays. When you GET
`/v1/2026-05-02` (a Saturday), Frankfurter returns the most recent prior
business day's rates with the actual `date` set in the response body
(e.g. `"date": "2026-05-01"`). The job stores rows keyed on Frankfurter's
returned `date`, NOT the requested date. Consequence: `--latest` on a
Sunday is a no-op if Friday's rates are already in the table. The display
layer's "fall back to most recent prior date" rule (per
`price_snapshots.ts` schema comment) handles the user-side query.

### Source value

Every row this job writes carries `source = 'frankfurter'`. Documented as
the literal constant `FRANKFURTER_SOURCE` in `frankfurter.ts`.

### Rate-limiting & politeness

- 1 rps sustained, burst 5 (Frankfurter publishes no rate limit; this is
  conservative).
- User-Agent: `binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly)`.

### CLI

```
pnpm --filter @binderly/data-pipeline fx-rates --latest
pnpm --filter @binderly/data-pipeline fx-rates --date 2026-04-30
pnpm --filter @binderly/data-pipeline fx-rates --from-date 2026-04-01 --to-date 2026-04-30
```

Exactly one of `--latest | --date | --from-date+--to-date` must be
specified. The CLI emits a single line of JSON (the `FxRatesReport`) to
stdout on success and exits non-zero on any unrecoverable error.

### Schedule (out of scope, documented for downstream)

The runner is what this PR ships; cron wiring is a deployment task.
Expected production schedule: **daily, 09:00 UTC**, after ECB publishes
(~16:00 CET ≈ 14:00–15:00 UTC the prior business day). 09:00 UTC the
following day gives ample buffer.

## Acceptance criteria

- [ ] `FrankfurterClient.getLatest()` returns a validated
      `FrankfurterRatesResponse` with `base = 'USD'`, `date` set, and
      one entry per requested symbol.
- [ ] `FrankfurterClient.getHistorical('2026-04-30')` happy path passes
      under FetchShim.
- [ ] `FrankfurterClient.getRange(from, to)` returns a validated
      `FrankfurterRangeResponse` keyed by ISO date.
- [ ] 404 from Frankfurter (e.g. date too old) bubbles `NotFoundError`.
- [ ] Malformed JSON surfaces `PermanentError` (via `RateLimitedClient.json`).
- [ ] 429 with `Retry-After: 0` is retried; exhaustion surfaces
      `RateLimitError`.
- [ ] `runFxRatesIngest({ latest: true })` writes 6 rows
      (`USD→{EUR,GBP,JPY,AUD,CAD,MXN}`) to an `InMemoryFxRateRepo`.
- [ ] `runFxRatesIngest({ date: '2026-04-30' })` writes 6 rows for that
      single date.
- [ ] `runFxRatesIngest({ fromDate: '2026-04-28', toDate: '2026-04-30' })`
      writes one set per business day in the range.
- [ ] Re-running with the same inputs is idempotent (no duplicate rows;
      upsert in place).
- [ ] If Frankfurter omits a requested currency for a given date, the
      report records it under `errors[]` and the rest still write.
- [ ] `FxRatesReport` shape: `{ source, rangeRequested, datesFetched,
      ratesFetched, ratesUpserted, durationMs, errors[] }`.
- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint
      format:check test` clean.
- [ ] No new DB migration; no edits outside `owns_paths` + the
      pre-authorized exceptions documented above.

## Out of scope

- Cron / Edge Function / GitHub Actions wiring (separate deployment task).
- ECB / open.er-api.com adapter (reserved as fallback; not implemented now).
- Conversion logic itself (lives in `packages/pricing-display`,
  T-SP-PRICING-DISPLAY).
- Cross-currency derivation (display-time concern).
- Backfill of multi-year history (the runner supports it; the actual
  hydration window is a deployment-time decision).

## Branch & PR

- Branch: `agent/T-DL-FX-RATES`
- PR title: `T-DL-FX-RATES: Daily FX rate ingestion (Frankfurter)`
- Commit format: Conventional Commits

## Escalation triggers

Append to `open-questions.md` and STOP if:

- Frankfurter drops a Binderly-supported currency (live `/v1/currencies`
  check should catch this on every run; the runner will record an error
  and continue, but persistent absence is escalation-worthy).
- The `fx_rate` table shape changes underneath (e.g. someone adds
  `source` to the PK after merge); the runner currently relies on the
  documented `(rate_date, base_currency, quote_currency)` PK.

## Notes from execution

_(empty until the sub-agent runs)_
