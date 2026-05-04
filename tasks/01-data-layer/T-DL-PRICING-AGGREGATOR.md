# T-DL-PRICING-AGGREGATOR — Pricing aggregator adapter (Layer 1 — eBay sold + Cardmarket via paid API)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M (~half day)
**Status:** review

---

## Hard dependencies

- **T-DL-SOURCE-INTERFACES** (merged) — `RateLimitedClient`,
  `AdapterError` hierarchy, `AdapterContext`/`AdapterLogger` shapes.
  We reuse the rate-limited HTTP client and the typed-error surface,
  but we are **not** a `SourceAdapter` (that interface is for
  catalog ingestion of sets/cards/printings — see § "Architecture
  fit" below).
- **T-DL-SCHEMA-PRICING** (merged) — `market`, `price_observation`,
  `price_aggregate`, `fx_rate` tables. We write to
  `price_observation` only; aggregation is the next task
  (T-DL-PRICING-ROLLUP) and FX is the display-time concern
  (T-DL-FX-RATES, T-SP-PRICING-DISPLAY).

## Soft dependencies

- **T-DL-EBAY-LISTING-PARSER** (merged) — `parseEbayListing` +
  `resolveListingToPrinting` are the joiner we use to attribute
  aggregator-passthrough eBay sold-listing titles to a `(card_id,
  printing_id)` tuple. Their `ParserCatalogReader` interface is
  consumed verbatim; we extend it with a narrow
  `findPrintingByVariantKey()` for Cardmarket-style pre-attributed
  quotes (see § "Catalog resolution" below).
- **T-DL-FX-RATES** (merged) — irrelevant at ingest time (we store
  in source currency per `rules/01-data-layer.md`); the FX join
  happens in `packages/pricing-display`.
- **T-DL-PRICING-ROLLUP** (pending; depends on this task) — the
  daily `price_observation → price_aggregate` rollup job. Our
  output IS its input. We coordinate on the
  `(printing_id, grade_tier, market, currency)` partitioning
  documented in `data-model.md` § "price_aggregate".
- **T-DL-PRICING-EBAY-BROWSE** (in progress, parallel) —
  folder-disjoint sibling that ingests eBay Browse active listings
  to the same `price_observation` table. We share the schema and
  the listing parser; we do not share code paths.

## Required reading

- `PROJECT.md` § 13 ("Pricing & Affiliate Strategy", especially
  the "Layer 1 — Aggregator" subsection and
  "Currency model: store native, convert at display time")
- `rules/01-data-layer.md` (idempotent ingestion, mandatory
  rate-limited client, market segmentation, source-currency rule,
  no-TCGplayer-scraping rule)
- `context/data-model.md` § "Markets", § "price_observation",
  § "Grade tiers", § "RLS policies"
- `context/legal-and-brand.md` (User-Agent contract, no live
  TCGplayer API calls, kill-switch posture for `raw_metadata`)
- `packages/db/src/schema/prices.ts` (the `price_observation`
  + `market` schemas — column types, the
  `(source, source_listing_id)` UNIQUE with NULLS DISTINCT, and
  the `observation_kind` CHECK)
- `packages/db/src/migrations/0009_pricing_rls.sql` (seeded
  market codes, service-role-only RLS posture)
- `data-pipeline/src/interfaces/adapter.ts` (`AdapterError`,
  `AdapterContext`, `AdapterLogger`)
- `data-pipeline/src/http/rate-limited-client.ts` (mandatory HTTP
  surface for any future live-API hookup)
- `data-pipeline/src/parsers/ebay-listing/index.ts` —
  `parseEbayListing`, `resolveListingToPrinting`,
  `ParserCatalogReader`
- `data-pipeline/src/jobs/fx-rates.ts` + `fx-rates.test.ts` —
  template for a single-purpose ingest job: `RunOptions`, repo
  abstraction, `Report` shape, `InMemoryRepo` pattern, FetchShim
  test scaffold
- `data-pipeline/src/jobs/seed.ts` + `seed/db-upsert.ts` —
  template for the DB-write boundary (`CatalogWriter` posture);
  we mirror that boundary for `PriceObservationRepo`

## Goal

Layer 1 of Binderly's pricing pipeline (PROJECT.md § 13). The
aggregator is a single paid-API vendor that has already done the
heavy lifting — eBay sold-listing ingestion, Cardmarket
trends/quotes, slab + grade detection — and exposes one normalized
endpoint per `(printing × grade tier × market × currency)`. **It
is also our only legitimate Cardmarket source**, since
Cardmarket's own API is closed to new applications.

This task ships the ingestion adapter that, given a date window
and a list of printings to refresh, fetches aggregator quotes,
resolves each to a catalog `printing_id`, and writes append-only
rows into `price_observation` tagged with the correct `market`,
`source`, `observation_kind`, source currency, and `raw_metadata`
provenance.

The adapter ships in **mock mode by default** (`MOCK_PRICING_AGGREGATOR=1`,
default ON; see § "Mock-by-default" below) because Pablo has not
approved paid-API spend during the build phase. The mock surface
is a real, working `PricingAggregatorClient` implementation backed
by synthetic JSON fixtures that exercise both Cardmarket-quote and
eBay-sold-listing code paths end-to-end. The live-API hookup
slots into the same client interface in a follow-up task (see
§ "Live-API follow-up").

## Architecture fit

This is **not** a `SourceAdapter` (the `data-pipeline/src/interfaces/adapter.ts`
contract for catalog ingestion of sets/cards/printings). Pricing
adapters are a parallel ingestion lane that writes to
`price_observation` rather than `set` / `card` / `printing`. Same
posture as `T-DL-EBAY-LISTING-PARSER` and the soon-to-land
`T-DL-PRICING-EBAY-BROWSE`: standalone modules under
`data-pipeline/src/adapters/<vendor>/` with their own client,
runner, and tests, surfacing through the package barrel.

```
              ┌─────────────────────────┐
              │  PricingAggregatorClient│
              │  (live ‖ mock)          │
              └────────────┬────────────┘
                           │ AggregatorQuote[]
                           ▼
              ┌─────────────────────────┐
              │ runPricingAggregatorIngest
              │ (this task)             │
              └────────────┬────────────┘
                           │ NewPriceObservationRow[]
                           ▼
              ┌─────────────────────────┐
              │ PriceObservationRepo    │
              │ (drizzle in prod;       │
              │  in-memory in tests)    │
              └────────────┬────────────┘
                           │ INSERT … ON CONFLICT
                           ▼
              ┌─────────────────────────┐
              │  price_observation      │
              └─────────────────────────┘
```

Catalog resolution is a sub-step of the runner: each
`AggregatorQuote` is either pre-attributed (Cardmarket-style,
carries a `printingVariantKey`) or carries a free-text eBay
listing title that we parse with `parseEbayListing` + join via
`resolveListingToPrinting` to land on a `printing_id`. Quotes
that fail resolution are recorded in `report.errors[]` and
skipped — the runner is best-effort, never aborts on a single
unresolved quote.

## Mock-by-default

Pablo has not approved paid-API spend during the build phase.
The adapter therefore ships with a **fully working mock
implementation** as the default code path:

- The mock implements the same `PricingAggregatorClient`
  interface as the live client and is selected by
  `MOCK_PRICING_AGGREGATOR=1` (default `1` when unset; explicitly
  set `0` when the live client is wired and approved).
- Mock data lives in
  `data-pipeline/src/adapters/pricing-aggregator/fixtures/` as
  static JSON: a small Cardmarket-trends file
  (printing-keyed quotes by grade tier) and a small eBay-sold
  listings file (titles + sold prices + sold dates). Tests load
  these fixtures and exercise the runner + DB-write boundary
  end-to-end.
- The mock is **deterministic**: same call → same output. Tests
  can assert exact row counts and shapes.
- The mock is the integration-test surface for everything that
  depends on this task (T-DL-PRICING-ROLLUP, future
  display-layer tests). They won't have to spin up a live
  vendor.

This is the same posture as `MockAdapter` in
`data-pipeline/src/jobs/seed.fixtures.ts` (used by
`T-DL-SEED-INGEST`'s tests) and the FetchShim pattern in
`data-pipeline/src/jobs/fx-rates.test.ts`.

## Live-API follow-up

Wiring an actual paid API is **out of scope for this task**.
When approved, a separate `T-DL-PRICING-AGGREGATOR-LIVE` (or an
addendum to this task's owns_paths) will:

1. Pin the vendor (PokeTrace and pokemon-api.com are the two
   leading Pokémon-focused candidates per PROJECT.md § 13;
   final selection requires comparing free-tier limits, refresh
   cadence, and Cardmarket coverage).
2. Implement the live `PricingAggregatorClient` against the
   chosen vendor's HTTP surface using the existing
   `RateLimitedClient`, with vendor-specific rate limits and a
   versioned User-Agent matching `context/legal-and-brand.md`.
3. Add fixture-recorded tests for the live client per the
   pattern in `data-pipeline/src/adapters/tcgdex-en/adapter.test.ts`.

The interface contract is stable so the swap is drop-in.

## Schema deviations

None. We write exclusively to existing tables
(`price_observation`, `market`) using the schema shipped by
`T-DL-SCHEMA-PRICING`. No new migration in this PR.

## Deliverables

| Path | Purpose |
|---|---|
| `data-pipeline/src/adapters/pricing-aggregator/index.ts` | Public barrel — re-exports the client interfaces, the mock, the runner, and the public types. |
| `data-pipeline/src/adapters/pricing-aggregator/types.ts` | Zod schemas + inferred TS types: `aggregatorQuoteSchema`, `rawPriceObservationSchema`, `gradeTierSchema` (re-export from listing-parser), `marketCodeSchema`. The `RawPriceObservation` shape is exported through the package barrel for use by `T-DL-PRICING-ROLLUP` and tests. |
| `data-pipeline/src/adapters/pricing-aggregator/client.ts` | `PricingAggregatorClient` interface + a partial real-client scaffold that's wrapped behind `MOCK_PRICING_AGGREGATOR`. The live HTTP surface is a single `fetchQuotes(opts)` method against the (yet-to-be-pinned) paid vendor; a stub implementation throws a documented `LiveClientNotConfiguredError` until § "Live-API follow-up" lands. |
| `data-pipeline/src/adapters/pricing-aggregator/mock.ts` | `MockPricingAggregatorClient` — loads the JSON fixtures, supports `since`/`until`/`printings` filters so tests can exercise the runner's filter handling, and is deterministic. Exported through the public barrel for downstream test reuse. |
| `data-pipeline/src/adapters/pricing-aggregator/fixtures/cardmarket-quotes.json` | Synthetic Cardmarket trend quotes: ~6 entries spanning 3 printings × 2 grade tiers (RAW_NM, PSA_10), market `CARDMARKET_EU`, currency EUR, observation_kind `aggregator_quote`. |
| `data-pipeline/src/adapters/pricing-aggregator/fixtures/ebay-sold-listings.json` | Synthetic aggregator-passthrough eBay sold listings: ~8 entries, mix of slabbed + raw, market `EBAY_US`, currency USD, observation_kind `sold`. Each carries a free-text `listingTitle`. |
| `data-pipeline/src/adapters/pricing-aggregator/canonical-id.ts` | `synthesizeSourceListingId(quote)` — pure function that builds the canonical idempotency id (see § "Idempotency strategy" below). Tested in isolation. |
| `data-pipeline/src/adapters/pricing-aggregator/resolver.ts` | The catalog-resolution helper: combines `findPrintingByVariantKey` (for Cardmarket pre-attributed quotes) with `resolveListingToPrinting` (for eBay sold-listing titles). Defines the small `PricingAggregatorCatalogReader` interface (extends `ParserCatalogReader` with one method). |
| `data-pipeline/src/adapters/pricing-aggregator/repo.ts` | `PriceObservationRepo` interface (`upsertMany`) + `InMemoryPriceObservationRepo` for tests. Mirrors the seed-ingest `CatalogWriter` boundary; the production drizzle implementation lives in this file too as `DrizzlePriceObservationRepo` (consumes a `DbClient` from `@binderly/db`). |
| `data-pipeline/src/adapters/pricing-aggregator/job.ts` | `runPricingAggregatorIngest(opts)` — the runner. Returns a `PricingAggregatorIngestReport` describing what happened. Never throws on per-quote failures; surfaces them in `report.errors[]`. Fatal errors (network outage on the live client, malformed schema, repo failure) bubble out. |
| `data-pipeline/src/adapters/pricing-aggregator/job.test.ts` | Vitest unit tests against `MockPricingAggregatorClient` + `InMemoryPriceObservationRepo` + an in-memory `PricingAggregatorCatalogReader`. Covers happy path (Cardmarket + eBay), idempotent re-run, listing-title fallback resolution, lot-listing rejection, missing-printing path, partial-failure reporting, and the `since`/`printings` filters. |
| `data-pipeline/src/adapters/pricing-aggregator/canonical-id.test.ts` | Round-trip tests for `synthesizeSourceListingId`. |
| `data-pipeline/src/adapters/pricing-aggregator/resolver.test.ts` | Tests for the resolver helper using the in-memory `ParserCatalogReader` pattern from the listing parser's test suite. |
| `data-pipeline/src/adapters/pricing-aggregator/README.md` | Architecture overview, mock-by-default, idempotency strategy, live-API follow-up, and a paste-able human smoke test. |
| `data-pipeline/src/adapters/index.ts` | Append a new section `=== T-DL-PRICING-AGGREGATOR ===` after the existing FX section, with `export * from './pricing-aggregator/index.js';`. Strictly additive; do not touch other sections. |

### Pre-authorized barrel section addition

The sectioned barrel `data-pipeline/src/adapters/index.ts` is the
*only* file outside `owns_paths` that this task edits, and only
to append the task's own section. The format mirrors the existing
sections exactly. T-DL-PRICING-EBAY-BROWSE is dispatched in
parallel and will append its own section in the same file in its
own commit; folder-disjoint and merge-safe per the same pattern
the schema barrel uses.

### Out of `owns_paths` scope

Anything else. Specifically NOT in scope:

- A new `data-pipeline/src/jobs/pricing-aggregator.ts` or
  `data-pipeline/scripts/pricing-aggregator.ts` runner entry —
  the runtime job lives inside the adapter folder
  (`pricing-aggregator/job.ts`); cron / Edge-Function /
  GitHub-Action wiring is a deployment task. (Same posture as
  fx-rates' "Cron / Edge Function / GitHub Actions wiring
  (separate deployment task)" out-of-scope note.)
- Any change to `data-pipeline/package.json` (no new CLI
  pnpm-script entry; consumers invoke
  `runPricingAggregatorIngest` from a future deployment task).
- Any change to `data-pipeline/src/jobs/index.ts`. The adapter
  module is not a top-level job for the same reason — it ships
  a runner that the (future) cron entry imports through the
  adapter barrel.

## Output type — `RawPriceObservation`

This is the public shape the runner emits per resolved quote
(before persistence). Defined as a zod schema in `types.ts`:

```ts
{
  source: string;                  // 'aggregator_<vendor>' (e.g. 'aggregator_mock')
  sourceListingId: string;         // canonical idempotency id; never null at this layer
  observationKind: 'sold' | 'aggregator_quote';
  printingId: string;
  gradeTier: GradeTier;            // re-export from listing parser
  market: string;                  // 'EBAY_US' | 'CARDMARKET_EU' | …
  observedPrice: string;           // numeric(12,2) string ('123.45')
  observedCurrency: string;        // ISO 4217 ('USD' | 'EUR' | …)
  shipping: string | null;         // numeric(12,2) string or null
  parseConfidence: string | null;  // numeric(3,2) string ('0.86') or null
  observedAt: Date;
  observedDate: string;            // YYYY-MM-DD
  rawMetadata: Record<string, unknown>;
}
```

It's structurally identical to `NewPriceObservation` from
`@binderly/db` (just nominally typed in our own module so the
adapter doesn't bake a runtime dep on `@binderly/db`). The
production `DrizzlePriceObservationRepo` type-asserts the shape
when handing it to drizzle's `insert(...).values(...)`.

A compile-time alignment test in `repo.ts` (a `satisfies
NewPriceObservation` line behind a build-time assertion guard)
catches drift.

## Idempotency strategy

The schema has `UNIQUE(source, source_listing_id)` with the
default NULLS DISTINCT (per the schema comment in
`packages/db/src/schema/prices.ts`). For our adapter, we never
write `source_listing_id = NULL` — we synthesize a stable id for
every quote so re-runs upsert in place.

Synthesis rule (`canonical-id.ts`):

| Quote kind | Synthetic id |
|---|---|
| `ebay_sold_listing` with vendor-supplied `listingId` | `${vendor}:ebay:${listingId}` |
| `ebay_sold_listing` without vendor `listingId` (rare; aggregator-curated) | `${vendor}:ebay-syn:${printingId}:${gradeTier}:${observedDate}:${pricePennies}` — collapses dupes within the same day at the same price; new sales of the same day at a different price get distinct ids. |
| `cardmarket_quote` (always pre-attributed by aggregator) | `${vendor}:cm:${printingId}:${gradeTier}:${market}:${currency}:${observedDate}` — single row per (printing × grade × market × currency × day). |

`vendor` is the configured aggregator name (`mock`,
`poketrace`, etc.) and is also reflected in the
`price_observation.source` column (`aggregator_<vendor>`).

This makes:

- Daily mock re-runs deterministic — same fixtures → same rows.
- Cardmarket trends idempotent at day granularity (the source
  publishes one trend value per printing per day).
- eBay sold listings keyed on the platform's stable item id
  when present.

The `(source, source_listing_id)` upsert uses `excluded.*` to
overwrite the price/currency/raw_metadata if the aggregator
restates a previously-ingested observation (e.g. corrected sold
price). The schema comment explicitly contemplates this.

## Catalog resolution

Each `AggregatorQuote` lands at the runner with one of two
resolution paths:

1. **Pre-attributed (Cardmarket-style).** The aggregator already
   knows which `printing` the quote pertains to (it's their
   secret sauce). The quote carries `printingVariantKey` (e.g.
   `en-swsh9-018-HOLO`). The runner calls
   `findPrintingByVariantKey(variantKey)` on the catalog reader.
   If the printing exists → use its `id`. If missing (catalog
   gap) → record a `missing_printing` error and skip.

2. **Listing-title (eBay sold passthrough).** The aggregator
   forwards the eBay listing title verbatim. The runner calls
   `parseEbayListing(title)` then `resolveListingToPrinting(parsed,
   reader)` (`T-DL-EBAY-LISTING-PARSER`). The result carries a
   `printingId` (or null) plus a confidence score we persist
   as `parseConfidence`. Lots (`isLot=true`) are dropped before
   write — they are by definition not single-card price
   observations (`rules/01-data-layer.md` "Pricing is
   market-segmented; never average across markets" — same
   spirit: never count a 50-card lot as one card's price).

The `PricingAggregatorCatalogReader` interface extends
`ParserCatalogReader` with one method:

```ts
interface PricingAggregatorCatalogReader extends ParserCatalogReader {
  findPrintingByVariantKey(variantKey: string): Promise<PricingCatalogPrinting | null>;
}

interface PricingCatalogPrinting {
  readonly id: string;
  readonly cardId: string;
  readonly variantKey: string;
}
```

A `DrizzlePricingAggregatorCatalogReader` ships in `repo.ts`
alongside the repo (both consume the same `DbClient`); tests
use a hand-rolled in-memory reader that mirrors the listing
parser's test pattern.

## Currency and market

Per `rules/01-data-layer.md` ("Prices are stored in source
currency. … Conversion happens at display time using `fx_rate`
for the observation's date") and PROJECT.md § 13:

- `observed_currency` is **always** the aggregator's reported
  source currency for that quote — `USD` for `EBAY_US`, `EUR`
  for `CARDMARKET_EU`. **No FX conversion at ingest.**
- `market` is one of the seven seeded codes (`EBAY_US`,
  `EBAY_DE`, `EBAY_UK`, `EBAY_JP`, `CARDMARKET_EU`,
  `TCGPLAYER_DERIVED`, `OTHER`). The runner asserts the
  `market` it's about to write exists in the seeded set
  (`packages/db/src/migrations/0009_pricing_rls.sql`); an
  unknown market is a fatal error (mis-coded fixture or
  vendor change). The mock uses only `EBAY_US` and
  `CARDMARKET_EU`.
- `TCGPLAYER_DERIVED` is reachable via aggregator only and is
  out-of-scope for the v1 mock fixtures (the seeded
  `notes` field documents this); the schema is ready for it
  whenever an aggregator vendor supplies it.

## Rate-limit posture (live client)

When the live client is wired, it must use `RateLimitedClient`
configured for the chosen vendor. Defaults documented now so
the follow-up task picks them up:

| Knob | Default | Rationale |
|---|---|---|
| `requestsPerSecond` | 1 | PokeTrace free tier is ~250 req/day; pokemon-api.com publishes no explicit RPS. 1 RPS sustained is conservative. |
| `burst` | 5 | Allow short pulse for batch refreshes. |
| `userAgent` | `binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly; pricing-aggregator)` | Per `context/legal-and-brand.md`. |
| `retries` | `{ max: 4, baseDelayMs: 500, factor: 2 }` | `RateLimitedClient` defaults; respect upstream Retry-After. |

The mock client ignores all of these — it's in-memory.

## Reporting

`runPricingAggregatorIngest` returns a
`PricingAggregatorIngestReport`:

```ts
{
  source: string;                       // 'aggregator_<vendor>'
  rangeRequested: { since?: string; until?: string; printings?: number };
  quotesFetched: number;
  observationsResolved: number;         // post-resolution, pre-write
  observationsWritten: number;          // repo.upsertMany return total
  durationMs: number;
  errors: ReadonlyArray<PricingAggregatorIngestError>;
}

interface PricingAggregatorIngestError {
  kind: 'parse_failed' | 'unresolved_listing' | 'missing_printing'
      | 'lot_dropped' | 'unknown_market' | 'repo_write_failed';
  sourceListingId?: string;
  variantKey?: string;
  listingTitle?: string;
  message: string;
}
```

Errors are non-fatal per quote; the runner records them and
continues. Fatal errors (the client throws, the repo throws on
the batch write, an unknown market value escapes the synthesis
guard) bubble out and the caller exits non-zero (this is the
runtime contract — there is no CLI script in this PR; the
contract documents how a future cron should behave).

## Acceptance criteria

- [ ] `parseEbayListing` + `resolveListingToPrinting` re-export
      cleanly from `data-pipeline/src/parsers/ebay-listing/index.js`
      with no circular import (sanity).
- [ ] `MockPricingAggregatorClient.fetchQuotes()` returns the
      union of `cardmarket-quotes.json` + `ebay-sold-listings.json`
      filtered by `since` / `until` (date range, inclusive) and
      `printings` (variant-key allow-list when supplied).
- [ ] `synthesizeSourceListingId` returns the documented form for
      each of the three branches (vendor-listing-id,
      vendor-syn-listing-id, cardmarket synth).
- [ ] Cardmarket pre-attributed quotes resolve via
      `findPrintingByVariantKey` and write rows with
      `observation_kind = 'aggregator_quote'`,
      `market = 'CARDMARKET_EU'`, `observed_currency = 'EUR'`.
- [ ] eBay sold-listing-passthrough quotes resolve via
      `parseEbayListing` + `resolveListingToPrinting` and write
      rows with `observation_kind = 'sold'`,
      `market = 'EBAY_US'`, `observed_currency = 'USD'`, and
      `parseConfidence` set to a `numeric(3,2)`-formatted
      string of the joiner's confidence score.
- [ ] eBay quotes whose listing parses as a lot
      (`isLot === true`) are skipped with a
      `lot_dropped` error in the report; no row is written.
- [ ] Quotes whose Cardmarket `printingVariantKey` doesn't exist
      in the catalog are skipped with a `missing_printing`
      error; no row is written.
- [ ] Quotes whose listing title fails to resolve are skipped
      with an `unresolved_listing` error.
- [ ] Re-running the runner against the same fixtures + repo is
      idempotent: row count is stable, `upsertMany` overwrites
      in place. (`InMemoryPriceObservationRepo` keeps a
      `(source, sourceListingId)`-keyed `Map`.)
- [ ] An unknown market code in a quote raises an
      `unknown_market` error (recorded; non-fatal); the rest
      still write.
- [ ] `since` filter narrows the result set; `printings` filter
      narrows the result set; both compose.
- [ ] The runner's `PricingAggregatorIngestReport` has the
      shape declared in § "Reporting" above and reports
      `observationsWritten === sum of repo writes`.
- [ ] Tests live at
      `data-pipeline/src/adapters/pricing-aggregator/*.test.ts`
      and pass under
      `pnpm --filter @binderly/data-pipeline test`.
- [ ] The package barrel surfaces `RawPriceObservation`,
      `PriceObservationRepo`, `InMemoryPriceObservationRepo`,
      `PricingAggregatorClient`, `MockPricingAggregatorClient`,
      `runPricingAggregatorIngest`, the report types, the
      catalog reader interface, and the canonical-id helper.
- [ ] `data-pipeline/src/adapters/index.ts` carries one new
      `=== T-DL-PRICING-AGGREGATOR ===` section appended after
      the existing FX section. No other section is modified.
- [ ] No new DB migration. No edits to `package.json`, no edits
      to `data-pipeline/src/jobs/index.ts`, no edits to
      `data-pipeline/src/index.ts`.
- [ ] All five gates pass:
      `pnpm --filter @binderly/data-pipeline format:check`,
      `lint`, `typecheck`, `test`, `build`.
- [ ] Status flipped from `in_progress` to `review` in
      `dependencies.yaml` before opening the PR.
- [ ] PR body documents the mock-by-default decision, the
      synthetic-id format, and the canonical-key shape used for
      idempotency.

## Out of scope

- The live paid-API hookup (separate task; see § "Live-API
  follow-up").
- A pnpm CLI entry / cron / Edge Function wiring (deployment
  task).
- The daily `price_observation → price_aggregate` rollup
  (T-DL-PRICING-ROLLUP — already a stub task in
  `dependencies.yaml`).
- FX conversion (`packages/pricing-display`,
  T-SP-PRICING-DISPLAY).
- The `mv_current_price` materialized view
  (T-DL-PRICING-CURRENT-VIEW).
- TCGplayer ingestion (closed to new developers; explicitly
  forbidden by `rules/01-data-layer.md` and
  `context/legal-and-brand.md`).
- Cardmarket direct-API integration (closed; we go through the
  aggregator only — same hard rule).
- Layer 2 (eBay Browse active listings) —
  `T-DL-PRICING-EBAY-BROWSE`, parallel sibling task.
- Layer 3 (eBay Marketplace Insights — gated approval; future).

## Branch & PR

- Branch: `agent/T-DL-PRICING-AGGREGATOR`
- PR title:
  `T-DL-PRICING-AGGREGATOR: Pricing aggregator adapter (mock-by-default; eBay sold + Cardmarket via paid API stub)`
- Commit format: Conventional Commits (`docs(tasks): elaborate
  T-DL-PRICING-AGGREGATOR` for Phase 1; `feat(data-pipeline):
  …` for the implementation commit).

## Escalation triggers

Append to `open-questions.md` and STOP if:

- Pablo decides to approve the live paid-API spend during this
  task — surface so the live-client implementation moves into
  scope rather than a follow-up.
- The aggregator-vendor selection produces a coverage gap (e.g.
  no Cardmarket data on free tier) that invalidates the
  Layer-1 architecture as described in PROJECT.md § 13.
- The schema's `(source, source_listing_id)` UNIQUE turns out
  to be insufficient for a quote shape we haven't anticipated
  (e.g. an aggregator that publishes multiple distinct quotes
  for the same `(printing, day)` keyed by sub-day timestamp).
  Current synthesis rule collapses to one row per day; if the
  rollup needs sub-day granularity we'd revisit.
- The `market` table seed is missing a code the chosen
  aggregator emits — escalate to add a row via a new schema
  task; do NOT silently pick `OTHER` for a known marketplace.

## Notes from execution

_(sub-agent appends here at end. Empty until then.)_
