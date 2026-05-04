# T-DL-PRICING-EBAY-BROWSE — eBay Browse API adapter (Layer 2 — active listings, free, no approval)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** L (~full day)
**Status:** in_progress

---

## Hard dependencies

- T-DL-SOURCE-INTERFACES (merged — `SourceAdapter`, `AdapterError`,
  `RateLimitedClient` all on `main`)
- T-DL-SCHEMA-PRICING (merged — `price_observation` table + RLS already
  on `main`)
- T-DL-EBAY-LISTING-PARSER (merged — `parseEbayListing()` +
  `resolveListingToPrinting()` on `main`)

## Soft dependencies

- T-DL-PRICING-AGGREGATOR (concurrent in iter 7 — both tasks may add the
  same `RawPriceObservation` shape to `data-pipeline/src/types.ts`. We
  coordinate via the additive-types pattern documented in the
  reconciliation note below; both tasks also append to the sectioned
  barrel `data-pipeline/src/adapters/index.ts`.)
- T-DL-FX-RATES (merged — landed earlier this iteration; we mirror the
  job/CLI shape and the `FxRateRepo` boundary pattern.)
- T-DL-PRICING-ROLLUP (downstream — consumes our `price_observation`
  rows; not a blocker.)

## Required reading

- `PROJECT.md` § 13 ("Pricing & Affiliate Strategy", especially
  sub-sections "Layer 2 — eBay Browse API", "Currency model", "Markets:
  eBay primary, Cardmarket secondary")
- `rules/01-data-layer.md` (idempotent ingestion, market-segmented
  pricing, store native currency, mandatory `RateLimitedClient`)
- `context/data-model.md` § "Pricing tables", § "Grade tiers", §
  "Markets", § "price_observation"
- `context/legal-and-brand.md` (User-Agent contract; eBay ToS posture)
- `context/conventions.md`
- `packages/db/src/schema/prices.ts` (`price_observation` shape — the
  ground truth for the ingest target)
- `packages/db/src/migrations/0008_pricing_tables.sql` (DDL — confirms
  the `(source, source_listing_id)` UNIQUE constraint and the
  `observation_kind IN ('sold','active_listing','aggregator_quote')`
  CHECK)
- `data-pipeline/src/interfaces/adapter.ts` (`AdapterContext`,
  `AdapterError` discriminated union, typed errors)
- `data-pipeline/src/http/rate-limited-client.ts` (mandatory HTTP
  surface; `fetchImpl` injection point for tests)
- `data-pipeline/src/parsers/ebay-listing/index.ts` (parser barrel —
  `parseEbayListing`, `resolveListingToPrinting`, `ParserCatalogReader`,
  `gradeToTier`, `conditionToTier`)
- `data-pipeline/src/parsers/ebay-listing/joiner.ts` (the joiner's
  confidence-quality factor — informs our threshold choice)
- `data-pipeline/src/adapters/fx/{frankfurter.ts,frankfurter.test.ts}`
  (template: thin client wrapping `RateLimitedClient`, host pinning,
  zod-validated responses, FetchShim test pattern)
- `data-pipeline/src/jobs/fx-rates.ts` (template: runner + repo
  boundary + report shape; we mirror this 1:1)
- `data-pipeline/scripts/fx-rates.ts` (template: CLI wiring + Drizzle
  upsert with `onConflictDoUpdate`)
- `data-pipeline/src/jobs/seed.fixtures.ts` (`MockAdapter` /
  `FetchShim` patterns — we adopt the same posture for our mock client)
- eBay Browse API: <https://developer.ebay.com/api-docs/buy/browse/overview.html>
  — `GET /buy/browse/v1/item_summary/search` (the only endpoint we
  hit), `Authorization: Bearer <APPLICATION_TOKEN>`, marketplace ID
  header `X-EBAY-C-MARKETPLACE-ID: EBAY_US`.
- eBay OAuth client-credentials: <https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html>
  — `POST /identity/v1/oauth2/token` with `grant_type=client_credentials`
  and `scope=https://api.ebay.com/oauth/api_scope`.

## Goal

Ingest *active eBay listings* into `price_observation` so the daily
rollup (`T-DL-PRICING-ROLLUP`) and downstream display (`T-SP-PRICING-DISPLAY`)
have an independent, growing-from-day-one signal alongside the
aggregator (Layer 1, sold listings). Per `PROJECT.md` § 13, Layer 2 is
"asking-price data — less reliable than sold prices, but it's *ours*:
independently collected, growing in coverage and history every day from
launch. After 12 months we have a year of data the aggregator can't
take from us."

We hit the **eBay Browse API** (`api.ebay.com/buy/browse/v1`) — open,
free, no approval required, ~5000 calls/day on the free Application
Token tier. Each listing returned by the search endpoint is funneled
through the merged eBay listing parser (`parseEbayListing` →
`resolveListingToPrinting`) to obtain a `printing_id` plus a
canonical `grade_tier`, then written to `price_observation` keyed on
`(source = 'ebay_browse', source_listing_id = item_id)` for
idempotent upsert.

Out of scope: the daily cron schedule (deployment task), live
end-to-end smoke against `api.ebay.com` (Pablo runs that locally),
and aggregation of the observations we write (lives in
`T-DL-PRICING-ROLLUP`).

## Source rationale

| Candidate                        | Auth                | Cost                              | Sold?           | Verdict                                            |
| -------------------------------- | ------------------- | --------------------------------- | --------------- | -------------------------------------------------- |
| **eBay Browse**                  | OAuth client-creds  | Free; ~5000 calls/day             | No (active)     | **Picked** — the documented Layer 2 source         |
| eBay Marketplace Insights        | Gated approval      | Approval-gated                    | Yes (90 days)   | Layer 3 / post-launch (`PROJECT.md` § 13)          |
| eBay Finding API (legacy)        | Decommissioned 2025 | n/a                               | n/a             | Off the table                                      |
| Scraping eBay search HTML        | None                | Free                              | n/a             | Forbidden by ToS / brittle / `legal-and-brand.md`  |

Browse is the canonical Layer-2 source per `PROJECT.md` § 13. No
genuine alternatives exist for "free + active listings + no approval".

## API surface

**Auth — OAuth client-credentials grant.** One-time setup per
environment:

1. Create an eBay developer account at
   <https://developer.ebay.com/my/keys>.
2. Create a "Production" keyset; record `App ID (Client ID)` and
   `Cert ID (Client Secret)`.
3. Set env vars `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` on every
   environment that runs the job.
4. The runtime exchanges them for a short-lived Application Token via:

   ```http
   POST https://api.ebay.com/identity/v1/oauth2/token
   Authorization: Basic base64(EBAY_CLIENT_ID:EBAY_CLIENT_SECRET)
   Content-Type: application/x-www-form-urlencoded

   grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope
   ```

   Response: `{ access_token, expires_in, token_type: 'Application Access Token' }`.
   Tokens are valid 7200 s; we cache in-process and refresh ~120 s
   before expiry.

**Search — `GET /buy/browse/v1/item_summary/search`.** Headers:

```http
Authorization: Bearer <access_token>
X-EBAY-C-MARKETPLACE-ID: EBAY_US
Accept: application/json
```

Query params we use:

- `q` — free-text query (e.g. `"Charizard SWSH9 Brilliant Stars"`).
- `category_ids=183454` — "Pokémon Individual Cards" (constrains the
  result set so generic toys / sealed product don't pollute).
- `filter=conditionIds:{1000|1500|2000|2500|3000|4000|5000|6000|7000},
   buyingOptions:{FIXED_PRICE|AUCTION},
   itemLocationCountry:US,
   priceCurrency:USD` — restrict to listings with parseable
  conditions in the US market priced in USD. (V1 is US-only; future
  iterations expand to UK/DE/JP via the same code path with a
  marketplace-id swap.)
- `limit=200` (max), `offset=N`.

Response shape (relevant fields, full zod schema in
`data-pipeline/src/adapters/pricing-ebay-browse/types.ts`):

```jsonc
{
  "total": 12345,
  "limit": 200,
  "offset": 0,
  "itemSummaries": [
    {
      "itemId": "v1|123456789|0",
      "title": "PSA 10 Charizard VMAX Brilliant Stars 020/172 Holo",
      "price": { "value": "299.99", "currency": "USD" },
      "shippingOptions": [{ "shippingCost": { "value": "4.99", "currency": "USD" } }],
      "itemLocation": { "country": "US" },
      "itemCreationDate": "2026-04-12T18:42:11.000Z",
      "itemWebUrl": "https://www.ebay.com/itm/...",
      "seller": { "username": "examplecards" },
      "condition": "Used",
      "image": { "imageUrl": "https://i.ebayimg.com/..." },
      "buyingOptions": ["FIXED_PRICE"]
    }
  ]
}
```

## `RawPriceObservation` shape (shared with PRICING-AGGREGATOR)

Both this task and `T-DL-PRICING-AGGREGATOR` need an
adapter-emitted shape. We define it once in
`data-pipeline/src/types.ts` and both adapters import it. The shape
mirrors `NewPriceObservation` from `@binderly/db` column-for-column
so the runner can map straight into a Drizzle insert without a second
translation pass — same posture as `FxRateRow` ↔ `NewFxRate` in
`T-DL-FX-RATES`.

```ts
export const rawPriceObservationSchema = z.object({
  source: z.string().min(1),                  // 'ebay_browse', 'aggregator_<name>', ...
  sourceListingId: z.string().min(1).nullable(),
  printingId: z.string().uuid(),
  observationKind: z.enum(['sold', 'active_listing', 'aggregator_quote']),
  market: z.string().min(1),                  // 'EBAY_US' | 'CARDMARKET_EU' | ...
  gradeTier: gradeTierSchema,                 // re-exported from parsers/ebay-listing
  observedPrice: z.string(),                  // numeric(12,2) — string round-trip
  observedCurrency: z.string().regex(/^[A-Z]{3}$/),
  shipping: z.string().nullable(),            // numeric(12,2)
  parseConfidence: z.number().min(0).max(1).nullable(),
  observedAt: z.date(),
  observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rawMetadata: z.record(z.unknown()).nullable(),
}).strict();
export type RawPriceObservation = z.infer<typeof rawPriceObservationSchema>;
```

**Coordination with PRICING-AGGREGATOR.** Both PRs may attempt to add
the same shape. We follow the schema-barrel reconciliation playbook
documented for prior parallel tasks:

- **If our PR lands first:** AGGREGATOR rebases onto `main` and drops
  its duplicate definition (it just imports ours).
- **If AGGREGATOR's PR lands first:** we rebase onto `main` and drop
  our definition. The shape above is intentionally generic; small
  cosmetic diffs between the two PRs (field ordering, comment
  wording) reconcile cleanly.
- The PR body explicitly flags that this file is shared so the
  orchestrator can pick the merge order. If diffs are non-trivial
  the orchestrator may ask one author to land a docs-only "the
  shape is X" commit first, then both adapters rebase.

## Idempotency strategy

The `price_observation` table carries
`UNIQUE (source, source_listing_id)` (default NULLS DISTINCT) per
`packages/db/src/schema/prices.ts`. We populate `source_listing_id`
with eBay's `itemId` (always present, always stable for a listing's
lifetime). Re-running the job on a query whose listings haven't
changed is a no-op — every row hits the unique constraint and the
upsert overwrites in place. The runner uses Drizzle's
`onConflictDoUpdate` on `(source, source_listing_id)` mirroring the
FX-rates pattern.

For listings that are *removed* upstream (sold / pulled / expired):
we don't issue deletes — `price_observation` is append-only by
design, and the rollup job naturally ages out by `observed_date`
windowing.

## Listing → printing join

Every `itemSummary` flows through:

```text
itemSummary.title  ──►  parseEbayListing(title)   ─►  ParsedListing
                                                          │
                                                          ▼
                       resolveListingToPrinting(parsed, catalogReader)
                                                          │
                                                          ▼
                                       JoinerResult { cardId, printingId, confidence }
```

**Confidence threshold: 0.5.** Listings with `JoinerResult.confidence
< 0.5` are dropped before write (counted in the report under
`droppedLowConfidence`). Rationale:

- `confidence = parsed.confidenceScore × joinQualityFactor` (joiner's
  formula).
- `joinQualityFactor` ∈ `{1.0 canonical-key hit, 0.6 name+set hit,
   0.4 name-only, 0.3 no variant match, 0.0 lot / unresolved}`.
- Picking 0.5 admits *every canonical-key hit* whose parser confidence
  is ≥ 0.5 (the bulk of well-formed listings) and admits
  *name-fallback hits* only when the parser is highly confident
  (≥ 0.83). Name-only hits without a set keyword are admitted only
  when parser confidence is ≥ 1.25, which clamps to 1.0 — i.e. they
  are effectively never admitted, which is the desired conservative
  posture for the noisy long-tail.
- Lot listings ALWAYS drop (joiner returns `confidence = 0`).

The threshold is a single constant
(`PRICING_EBAY_BROWSE_MIN_CONFIDENCE = 0.5`) exported from
`adapter.ts`, so a future tuning task is one constant change. The
value is documented for re-evaluation after a week of production
data — `open-questions.md` Q-NEXT (TBD on first PR review).

**Grade-tier resolution.** `parsedListing.grading.gradeTier` is the
canonical enum we want (e.g. `PSA_10`, `BGS_9_5`). When the parser
emits `gradeTier = null`:

- If `condition` is non-null (raw card with parsed condition), use
  `conditionToTier(condition)` → `RAW_NM | RAW_LP | …`.
- Else default to `RAW_UNKNOWN`. (The schema requires `grade_tier
  NOT NULL`, so we never skip — we use `RAW_UNKNOWN` rather than
  drop the row, since the rollup's `parse_confidence < 0.7` filter
  will exclude these from aggregates anyway.)

**`ParserCatalogReader` implementation.** The runner constructs a
Drizzle-backed reader over `card` / `printing` / `set` from
`@binderly/db`. The unit-test path uses an in-memory implementation
modelled on `joiner.test.ts`'s `makeReader`; the CLI wires the
production implementation. Boundary kept tiny so this task doesn't
need to touch `@binderly/db`'s public API.

## Market & currency mapping

For v1 we only fetch `X-EBAY-C-MARKETPLACE-ID: EBAY_US`. Mapping:

| eBay marketplace | Binderly `market.code` | Currency |
| ---------------- | ---------------------- | -------- |
| `EBAY_US`        | `EBAY_US`              | USD      |
| `EBAY_GB`        | `EBAY_UK`              | GBP      |
| `EBAY_DE`        | `EBAY_DE`              | EUR      |
| `EBAY_JP`        | `EBAY_JP`              | JPY      |

The mapping table lives in `adapter.ts` so adding non-US markets
post-MVP is a one-line addition. **Cross-currency rejection**: if a
listing's `price.currency` doesn't match the marketplace's expected
currency (e.g. an EBAY_US listing priced in GBP — rare, surfaces in
the global-shipping pool), we record the row as-is in source currency
(per `rules/01-data-layer.md` "store native currency, never convert
at ingest"). The display layer handles cross-currency rendering via
`fx_rate`.

## Rate-limiting

eBay Browse free tier: ~5,000 calls/day on the Application Token.
That works out to ~1 call / 17 seconds sustained. To leave
significant headroom for retries, parallel queries, and the OAuth
token endpoint:

- `requestsPerSecond: 1`
- `burst: 5`

This is well below the documented 5 requests/second the API itself
will accept on a fresh token; the bottleneck is the *daily quota*,
not the per-second rate. The job's `--max-queries` flag bounds the
per-run quota usage so a runaway query loop can't burn the whole
day's allowance.

## `MOCK_PRICING_EBAY_BROWSE` env var

Tests and CI run with `MOCK_PRICING_EBAY_BROWSE=1` (the default in
`vitest.config.ts`'s `env` block). When set:

- The HTTP client is replaced by `MockEbayBrowseClient`, which
  serves canned `itemSummaries` from in-test fixtures (no
  `RateLimitedClient`, no `globalThis.fetch`).
- The OAuth token exchange is short-circuited to a synthetic token.
- The CLI also honors the flag for sandbox / smoke runs without
  credentials (Pablo can `MOCK_PRICING_EBAY_BROWSE=1 pnpm
  pricing-ebay-browse --set en-swsh9` and observe the job's
  end-to-end shape against deterministic fixtures).

When *unset*, the runtime hits live `api.ebay.com`. Production
deployments leave it unset.

## Deliverables

| Path | Purpose |
| --- | --- |
| `data-pipeline/src/adapters/pricing-ebay-browse/index.ts` | Public barrel — re-exports adapter + client + types. |
| `data-pipeline/src/adapters/pricing-ebay-browse/types.ts` | Zod schemas for the OAuth token response, the search response (`itemSummary[]`), and our internal listing → observation conversion result. Also re-exports `gradeTierSchema` for adapter callers. |
| `data-pipeline/src/adapters/pricing-ebay-browse/oauth.ts` | `EbayOAuthClient` — handles client-credentials token exchange with in-process caching + skew protection. Hits `api.ebay.com/identity/v1/oauth2/token` via a dedicated `RateLimitedClient` (the auth host is the same as the API host but conceptually separate). |
| `data-pipeline/src/adapters/pricing-ebay-browse/client.ts` | `EbayBrowseClient` — thin wrapper around `RateLimitedClient` for `api.ebay.com`. Exposes `searchItemSummaries({ query, marketplace, limit, offset })`. Validates with zod, surfaces `NotFoundError` for legitimate 404s. Handles the `Authorization: Bearer` header by calling into `EbayOAuthClient`. |
| `data-pipeline/src/adapters/pricing-ebay-browse/mock.ts` | `MockEbayBrowseClient` — programmable in-memory `EbayBrowseClient` swap-in for tests + `MOCK_PRICING_EBAY_BROWSE=1` mode. Same shape as `MockAdapter` from `seed.fixtures.ts`. |
| `data-pipeline/src/adapters/pricing-ebay-browse/adapter.ts` | `EbayBrowseAdapter` — orchestrates client + parser + joiner. Exposes `streamObservationsForQuery({ query, marketplace, limit })` returning an async iterable of `RawPriceObservation`. Internally pages through search results, parses titles, joins to printings, applies the confidence threshold, and emits. Defines `PRICING_EBAY_BROWSE_SOURCE = 'ebay_browse'` and `PRICING_EBAY_BROWSE_MIN_CONFIDENCE = 0.5`. |
| `data-pipeline/src/adapters/pricing-ebay-browse/oauth.test.ts` | FetchShim tests: token-fetch happy path, in-process caching, refresh-before-expiry, 401 → `PermanentError`, 429 retry. |
| `data-pipeline/src/adapters/pricing-ebay-browse/client.test.ts` | FetchShim tests: search happy path, pagination, 404, 429 retry, malformed JSON, schema-mismatch. |
| `data-pipeline/src/adapters/pricing-ebay-browse/adapter.test.ts` | Integration test against `MockEbayBrowseClient` + in-memory `ParserCatalogReader`: confidence-threshold drop, lot-listing skip, raw-card → `RAW_NM` mapping, slabbed-listing → `PSA_10` mapping, market mapping, currency captured natively, shipping captured. |
| `data-pipeline/src/jobs/pricing-ebay-browse.ts` | `runPricingEbayBrowseIngest(opts)` — orchestrates a run: enumerates queries from a set or an explicit query list, drives `EbayBrowseAdapter.streamObservationsForQuery` per query, batches `RawPriceObservation` rows into `PriceObservationRepo.upsertMany`, returns a `PricingEbayBrowseReport`. Defines `PriceObservationRepo` interface + `InMemoryPriceObservationRepo` test helper (mirrors `FxRateRepo`). |
| `data-pipeline/src/jobs/pricing-ebay-browse.test.ts` | Unit tests with `InMemoryPriceObservationRepo` + `MockEbayBrowseClient`: full-set ingest, idempotent re-run, partial-failure (some queries 404, some succeed), low-confidence drops, reporter shape. |
| `data-pipeline/src/jobs/index.ts` | Append `=== T-DL-PRICING-EBAY-BROWSE ===` section with `export * from './pricing-ebay-browse.js';` (additive sectioned barrel — coordinate with PRICING-AGGREGATOR; same pattern as the existing FX-RATES + SEED-INGEST sections). |
| `data-pipeline/src/types.ts` | Append `RawPriceObservation` type + zod schema (only one of {us, AGGREGATOR} lands it; document who in PR body). |
| `data-pipeline/src/adapters/index.ts` | Add `=== T-DL-PRICING-EBAY-BROWSE ===` section with `export * from './pricing-ebay-browse/index.js';` (do NOT touch the AGGREGATOR section). |
| `data-pipeline/scripts/pricing-ebay-browse.ts` | CLI entry — argv parser → `runPricingEbayBrowseIngest` → JSON report on stdout, exit 0/1. Honors `MOCK_PRICING_EBAY_BROWSE=1`. Wires Drizzle-backed `PriceObservationRepo` and `ParserCatalogReader` against `@binderly/db`. |
| `data-pipeline/package.json` | Add `"pricing-ebay-browse": "tsx scripts/pricing-ebay-browse.ts"` script entry. |
| `data-pipeline/README.md` | Append a "Layer 2 — eBay Browse pricing" section with the OAuth setup steps + CLI usage + smoke-test invocation. |

### Pre-authorized path deviations

`owns_paths` in `dependencies.yaml` is expanded in the same docs commit
as this elaboration to: `[data-pipeline/src/adapters/pricing-ebay-browse/,
data-pipeline/src/jobs/pricing-ebay-browse.ts,
data-pipeline/scripts/pricing-ebay-browse.ts]`. That mirrors the
T-DL-FX-RATES precedent (`[data-pipeline/src/jobs/fx-rates.ts,
data-pipeline/src/adapters/fx/]`).

The implementation PR also performs the following *additive-only*
edits, pre-authorized here:

- `data-pipeline/src/adapters/index.ts` — add our section (sectioned
  barrel; AGGREGATOR's section untouched).
- `data-pipeline/src/jobs/index.ts` — add our section (sectioned
  barrel; FX / SEED untouched).
- `data-pipeline/src/types.ts` — append `RawPriceObservation` (shared
  with AGGREGATOR; reconcile at merge if both PRs added it).
- `data-pipeline/package.json` — add the `"pricing-ebay-browse"`
  script (one line; trivial conflict resolution if AGGREGATOR also
  adds a script).
- `data-pipeline/README.md` — append a new section at the end of the
  jobs list (additive).

Anything outside this list is a deviation that goes through
`open-questions.md`.

## Acceptance criteria

### Adapter / client / OAuth

- [ ] `EbayOAuthClient.getApplicationToken()` exchanges
      `(EBAY_CLIENT_ID, EBAY_CLIENT_SECRET)` for a Bearer token via
      `POST /identity/v1/oauth2/token` (FetchShim).
- [ ] The OAuth token is cached in-process across calls and refreshed
      ~120 s before `expires_in`.
- [ ] OAuth 401 (bad credentials) bubbles `PermanentError` (not
      retried).
- [ ] `EbayBrowseClient.searchItemSummaries({ query: 'Charizard',
      marketplace: 'EBAY_US', limit: 50, offset: 0 })` returns a
      validated response under FetchShim, with the
      `X-EBAY-C-MARKETPLACE-ID` and `Authorization` headers set.
- [ ] Search 404 bubbles `NotFoundError` (so the runner can treat as
      "no results"). Search 429 + `Retry-After: 0` retries; exhaustion
      surfaces `RateLimitError`.
- [ ] Schema-mismatched response bodies surface `PermanentError`.
- [ ] `MockEbayBrowseClient` is a drop-in replacement (same TS
      surface) and is wired automatically when
      `process.env.MOCK_PRICING_EBAY_BROWSE === '1'`.

### Adapter (parse/join/emit)

- [ ] `EbayBrowseAdapter.streamObservationsForQuery({ query: '...',
      marketplace: 'EBAY_US' })` against the mock client + in-memory
      catalog reader emits `RawPriceObservation` rows whose
      `printingId` matches the canonical-key-resolved printing.
- [ ] Listings whose joiner confidence < 0.5 are dropped from the
      stream (asserted by counting and sampling input vs output).
- [ ] `parsedListing.isLot === true` listings always drop (joiner
      returns confidence 0).
- [ ] Slabbed listing with `gradeTier = 'PSA_10'` round-trips into
      `RawPriceObservation.gradeTier`.
- [ ] Raw-NM listing (no slab, condition parsed) round-trips into
      `RawPriceObservation.gradeTier = 'RAW_NM'`.
- [ ] Listing with neither slab nor parsed condition emits
      `gradeTier = 'RAW_UNKNOWN'` (rather than dropping the row).
- [ ] `RawPriceObservation.market` is correctly mapped per the
      marketplace table (`EBAY_US` for `EBAY_US`, etc.).
- [ ] `observedPrice` and `observedCurrency` are taken verbatim from
      the listing's `price.value/.currency` (no FX conversion).
- [ ] `shipping` is taken from `shippingOptions[0].shippingCost.value`
      when present, else null.
- [ ] `rawMetadata` carries `{ title, itemWebUrl, seller,
      itemCreationDate, condition, image }` for debug + takedown.
- [ ] `observedAt` is set to the current clock (via injectable `now`)
      since active listings have no canonical "moment of observation
      other than now"; `observedDate` is `(observedAt UTC)::date`.

### Runner / repo / report

- [ ] `runPricingEbayBrowseIngest({ queries: ['Charizard SWSH9'],
      adapter, repo })` writes one row per emitted observation.
- [ ] `runPricingEbayBrowseIngest({ setKey: 'en-swsh9', catalogReader,
      ... })` enumerates queries from the set's cards (one query per
      card by name + set name). Bounded by `--max-queries`.
- [ ] Re-running with the same upstream listings is idempotent:
      `repo.upsertMany` row count stays steady; no duplicate
      observations under `(source, source_listing_id)`.
- [ ] If a query 404s upstream, the report records it under
      `errors[]` and the rest still write.
- [ ] `PricingEbayBrowseReport` shape:
      `{ source, queriesRequested, queriesSucceeded, listingsFetched,
        listingsParsed, droppedLowConfidence, droppedLot,
        observationsUpserted, durationMs, errors[] }`.
- [ ] `InMemoryPriceObservationRepo` keys on `(source,
      sourceListingId)` and replaces in place on conflict.

### CLI

- [ ] `pnpm --filter @binderly/data-pipeline pricing-ebay-browse
      --set en-swsh9 --max-queries 5 --url <pg>` runs end-to-end with
      `MOCK_PRICING_EBAY_BROWSE=1` and writes synthetic observations
      to the target Postgres (or `--dry-run` for stdout-only).
- [ ] `pnpm --filter @binderly/data-pipeline pricing-ebay-browse
      --query "Charizard PSA 10" --dry-run` prints a JSON report on
      stdout.
- [ ] CLI exits 1 on any unrecoverable error and 0 on partial /
      complete success.
- [ ] Missing env vars (`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`) when
      `MOCK_PRICING_EBAY_BROWSE` is not set surface a helpful error
      message and exit 1.

### Repo gates

- [ ] `pnpm --filter @binderly/data-pipeline format:check` clean.
- [ ] `pnpm --filter @binderly/data-pipeline lint` clean (max-warnings 0).
- [ ] `pnpm --filter @binderly/data-pipeline typecheck` clean.
- [ ] `pnpm --filter @binderly/data-pipeline test` clean (no skipped
      tests).
- [ ] `pnpm --filter @binderly/data-pipeline build` clean.
- [ ] No new DB migration; no edits outside `owns_paths` + the
      pre-authorized exceptions documented above.
- [ ] No raw `fetch()` to `api.ebay.com` — every call goes through
      `RateLimitedClient` (asserted by code review + lint posture).

## Out of scope

- The daily cron schedule / GitHub Actions / Edge Function wiring
  (separate deployment task — the runner is what this PR ships).
- Aggregating observations into `price_aggregate` (`T-DL-PRICING-ROLLUP`).
- Display-time currency conversion (`packages/pricing-display`,
  `T-SP-PRICING-DISPLAY`).
- eBay Marketplace Insights (Layer 3, post-launch / approval-gated).
- eBay UK / DE / JP marketplaces (schema supports them; v1 ships
  `EBAY_US` only and the marketplace-id table makes adding others a
  one-line config change).
- A daily-quota tracker (the in-process limiter doesn't persist across
  job restarts; production cron schedule + `--max-queries` gate keep
  us well below 5,000 calls/day for a single set per day).
- Live integration test against `api.ebay.com` (Pablo runs the
  smoke test locally with credentials per the README; CI is mock-only).

## Branch & PR

- Branch: `agent/T-DL-PRICING-EBAY-BROWSE`
- PR title: `T-DL-PRICING-EBAY-BROWSE: eBay Browse API adapter (Layer 2 — active listings)`
- Commit format: Conventional Commits

## Escalation triggers

Append to `open-questions.md` and STOP if:

- The eBay Browse search response shape changes such that the existing
  zod schema can't validate (the API has been stable since 2018; very
  unlikely).
- The free Application Token quota drops below ~1000 calls/day (would
  invalidate the rate-limit floor; current docs say 5000).
- `parseEbayListing` / `resolveListingToPrinting` change their
  signatures (would force re-coordination with EBAY-LISTING-PARSER).
- The `RawPriceObservation` shape we and AGGREGATOR each landed
  diverge enough that a clean merge isn't possible (orchestrator
  intervenes).
- `price_observation` table shape changes underneath
  (`T-DL-SCHEMA-PRICING` is merged + frozen, but documenting the
  trigger anyway).

## Notes from execution

_(Sub-agent appends here at end. Empty until then.)_
