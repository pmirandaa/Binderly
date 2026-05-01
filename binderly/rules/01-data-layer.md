# Stage 01 — Data Layer rules

This stage produces the schema, the source adapters, and the
standardization pipeline that turns raw card data into our canonical
`set` / `card` / `printing` rows. Everything downstream depends on it.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 7 (Sources), § 8 (Master Set)
- `context/data-model.md`
- `context/tcg-domain.md` ← non-negotiable for adapters and the master-set
  engine
- `context/conventions.md`
- `context/legal-and-brand.md` for source ToS notes

## Hard rules

- **Catalog tables are write-protected to clients.** Only the service
  role and the data-pipeline can write `set`, `card`, `printing`,
  `price`, `price_snapshot`. RLS enforces this.
- **Idempotent ingestion.** Every adapter and every pipeline job must be
  safe to re-run. Use the canonical_key / variant_key as the upsert key.
  Never insert without checking.
- **No image hotlinking.** Adapters store the source URL in
  `image_source_url` only. The image pipeline downloads, optimizes,
  uploads to R2, and writes `image_small_url` / `image_large_url`. UI
  never points at a non-R2 image.
- **Variant classification goes through the central decision tree.** No
  adapter assigns `variant_class` directly — they emit raw source data
  and the standardizer (`data-pipeline/src/variant-classify.ts`)
  classifies. This makes the rules testable in one place.
- **Conflicts are surfaced, not silenced.** When sources disagree on a
  field beyond a tolerance, write to `data_conflict`. Pick the primary's
  value as the working value, but record the disagreement.
- **Rate limits are mandatory.** Every external HTTP call goes through
  `data-pipeline/src/http/rate-limited-client.ts` (built in
  T-DL-SOURCE-INTERFACES). No raw `fetch` to third-party APIs.
- **No TCGplayer scraping, ever.** TCGplayer's API is closed to new
  developers and their ToS forbids scraping. Pricing data comes via
  the aggregator (Layer 1) and eBay Browse (Layer 2). See
  `context/legal-and-brand.md`.
- **Pricing is market-segmented; never average across markets.**
  `EBAY_US` and `CARDMARKET_EU` reflect different buyer pools and
  must remain distinct rows in `price_observation` and
  `price_aggregate`. The `market.tier` field controls primary vs
  secondary surface in the UI; data ingestion does not care about tier.
- **Prices are stored in source currency.** No FX conversion at
  ingest. `price_observation.observed_currency` is mandatory.
  Conversion happens at display time using `fx_rate` for the
  observation's date (per Pablo's spec). The display package
  (`packages/pricing-display`) is the only place currency conversion
  happens — never in adapters, never in aggregates.

## Conventions specific to this stage

- Adapters live in `data-pipeline/src/adapters/<source>/` and export a
  single object implementing `SourceAdapter`. No side effects on import.
- Each adapter has a `mappings/` subfolder with rarity / type / variant
  mapping tables. These are testable JSON or TS const objects.
- Tests for adapters use recorded HTTP fixtures (msw or nock). No live
  network during `pnpm test`.
- Migrations: SQL only, in `packages/db/src/migrations/`, sequential
  numbering. RLS in its own migration file per logical change.

## Common pitfalls

- TCGdex returns null for fields that pokemontcg.io fills — don't
  assume one source has everything.
- pokemontcg.io rate limit is generous but not infinite. Backoff on 429.
- Bulbapedia content is CC-BY-NC-SA — use it only for *factual
  validation*, not as a content source.
- Japanese set codes vary by source. Standardize on TCGdex's codes.
- "Promo" in some sources is a card flag; in others it's a separate set.
  We treat it as a separate set (see `context/tcg-domain.md`).
- Number formatting: never strip leading zeros from `card.number`. "TG01"
  is not "TG1".

## Done when

- All catalog tables exist with the columns and indexes specified in
  `context/data-model.md`.
- RLS policies in place and tested.
- Adapters for TCGdex EN, pokemontcg.io, Bulbapedia, and TCGdex JP
  produce normalized output and pass their tests against fixtures.
- The resolver can pick a primary, validate against secondaries, and
  surface conflicts.
- The image pipeline can ingest a sample set end-to-end into R2.
- The master-set rules engine flips `include_in_master_set` correctly
  for each test case in `context/tcg-domain.md` § 3.
- A seed ingest of 2–3 representative sets (one modern EN, one vintage
  EN, one modern JP) produces inspectable, correct rows.
