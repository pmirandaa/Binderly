# Pricing Aggregator Adapter

Layer 1 of Binderly's pricing pipeline (PROJECT.md § 13). Ingests
quotes from a paid Pokémon-focused pricing aggregator that has
already done the work to ingest eBay sold listings, Cardmarket
trends, and TCGplayer prices, parse listing titles, detect slab
brand and grade, and expose normalized data per
`(printing × grade tier × market × currency)`. Writes append-only
rows into `price_observation`.

> **Heads-up:** Cardmarket's own API is closed to new
> applications. The aggregator is also Binderly's only legitimate
> Cardmarket source. See PROJECT.md § 13.

## Runtime modes

The adapter ships with a fully working **mock** as the default
code path because Pablo has not approved paid-API spend during
the build phase. The mock is selected by
`MOCK_PRICING_AGGREGATOR=1` (default ON when unset).

| Env value                       | Behaviour                      |
| ------------------------------- | ------------------------------ |
| (unset)                         | Mock client (default)          |
| `MOCK_PRICING_AGGREGATOR=1`     | Mock client                    |
| `MOCK_PRICING_AGGREGATOR=true`  | Mock client                    |
| `MOCK_PRICING_AGGREGATOR=0`     | Live client (currently throws) |
| `MOCK_PRICING_AGGREGATOR=false` | Live client (currently throws) |

The live client is a documented stub that throws
`LiveClientNotConfiguredError`. A separate follow-up task
(`T-DL-PRICING-AGGREGATOR-LIVE`) will pin the vendor and wire
the live HTTP surface against `RateLimitedClient`.

## Mock fixtures

JSON files under `./fixtures/` shape the deterministic mock
output:

- `cardmarket-quotes.json` — Cardmarket-trend-style quotes with
  `kind: 'cardmarket_quote'` and a pre-attributed
  `printingVariantKey`. Used to exercise the variant-key
  catalog lookup.
- `ebay-sold-listings.json` — Aggregator-passthrough eBay sold
  listings with `kind: 'ebay_sold_listing'` and a free-text
  `listingTitle`. Used to exercise the listing-parser + joiner
  path.

Each row is validated against `aggregatorQuoteSchema` at module
load — a typo in the JSON surfaces immediately, not in
production.

## Output shape

Each successfully-resolved quote produces a `RawPriceObservation`
that maps 1:1 to `NewPriceObservation` from `@binderly/db`:

```ts
{
  source: 'aggregator_mock',
  sourceListingId: 'mock:cm:<printingId>:RAW_NM:CARDMARKET_EU:EUR:2026-04-30',
  observationKind: 'aggregator_quote', // or 'sold' for eBay
  printingId: '...',
  gradeTier: 'RAW_NM',
  market: 'CARDMARKET_EU',
  observedPrice: '180.00',
  observedCurrency: 'EUR',
  shipping: null,
  parseConfidence: null, // 0..1 numeric string for eBay; null for Cardmarket
  observedAt: <Date>,
  observedDate: '2026-04-30',
  rawMetadata: { ... },
}
```

## Idempotency

The schema's `UNIQUE (source, source_listing_id)` constraint
upserts in place. The runner synthesizes a stable
`source_listing_id` per quote so re-runs produce no duplicates:

| Quote shape                          | Synthetic id                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| eBay sold listing with vendor id     | `${vendor}:ebay:${listingId}`                                                   |
| eBay sold listing without listing id | `${vendor}:ebay-syn:${printingId}:${gradeTier}:${observedDate}:${pricePennies}` |
| Cardmarket quote                     | `${vendor}:cm:${printingId}:${gradeTier}:${market}:${currency}:${observedDate}` |

## Catalog resolution

- **Cardmarket quotes** → `findPrintingByVariantKey(printingVariantKey)`
  on the catalog reader. If the printing is missing, the runner
  records a `missing_printing` error and skips.
- **eBay sold quotes** → `parseEbayListing(listingTitle)` then
  `resolveListingToPrinting(parsed, reader)` (the
  `T-DL-EBAY-LISTING-PARSER` joiner). Lots (`isLot=true`) are
  dropped with a `lot_dropped` error; unresolved listings get
  an `unresolved_listing` error.

## Currency

Stored in source currency. **No FX conversion at ingest** per
`rules/01-data-layer.md`. The display layer
(`packages/pricing-display`) converts via `fx_rate` for the
observation's `observed_date`.

## Running

There is no pnpm CLI script in this PR — cron / Edge Function /
GitHub Actions wiring is a deployment task. The runner is
`runPricingAggregatorIngest` and is invoked from a future cron
entry like:

```ts
import {
  createMockPricingAggregatorClient,
  DrizzlePriceObservationRepo,
  DrizzlePricingAggregatorCatalogReader,
  isMockAggregatorEnabled,
  runPricingAggregatorIngest,
} from '@binderly/data-pipeline';
import { createDbClient } from '@binderly/db';

const db = createDbClient(process.env.DATABASE_URL!);
const client = isMockAggregatorEnabled() ? createMockPricingAggregatorClient() : /* future */ null;

const report = await runPricingAggregatorIngest({
  client,
  catalog: new DrizzlePricingAggregatorCatalogReader(db),
  repo: new DrizzlePriceObservationRepo(db),
});
console.log(JSON.stringify(report));
```

## Human smoke test

Once a future task wires a real CLI:

```sh
# Local Supabase Postgres (per packages/db/scripts/migrate.ts pattern)
SUPABASE_DB_URL=postgres://postgres:postgres@localhost:54322/postgres \
  pnpm --filter @binderly/db db:migrate
# Run the pricing-aggregator runner (future):
MOCK_PRICING_AGGREGATOR=1 \
  SUPABASE_DB_URL=postgres://postgres:postgres@localhost:54322/postgres \
  pnpm --filter @binderly/data-pipeline pricing-aggregator
# Expected: a JSON report on stdout listing observationsResolved
# > 0, observationsWritten == observationsResolved, no errors
# beyond the known fixture's "Eldritch Horror" unresolved-listing
# entry (1 expected error).
```

## Tests

```sh
pnpm --filter @binderly/data-pipeline test \
  --run src/adapters/pricing-aggregator
```

Covers: synthesizeSourceListingId, mock fixtures, filter
semantics, resolver branches, and end-to-end runner happy path

- error reporting + idempotent re-run.
