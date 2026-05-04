# @binderly/data-pipeline

The catalog ingestion engine. Source adapters, the resolver that merges
primary / validation / filler tiers into a single canonical record, the
variant classifier, the canonical-key generator, and the rate-limited HTTP
client every adapter shares.

This package is Node-only and never reaches the browser. Downstream
consumers are CLI scripts and Edge Functions that write the catalog
tables (`set`, `card`, `printing`).

## Why this exists

Pokémon TCG data is scattered across half a dozen sources, each with its
own variant taxonomy, rarity vocabulary, and rate-limit etiquette. We
present a single canonical view of the catalog (the `set` / `card` /
`printing` tables — see `context/data-model.md` and the drizzle schemas in
`packages/db/src/schema/`). The data-pipeline does the reconciliation.

## Pipeline composition

```
                    ┌──────────────────┐
                    │  SourceAdapter   │   one per (source, language)
                    │   (interface)    │
                    └────────┬─────────┘
                             │ emits
                             ▼
                    Raw{Set,Card,Printing}
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   primary tier         validation tier        filler tier
        │                    │                    │
        └────────┐   ┌───────┘   ┌────────────────┘
                 ▼   ▼           ▼
              ┌────────────────────┐
              │  resolveCanonical  │  records DataConflicts on disagreement
              └─────────┬──────────┘
                        ▼
              Canonical{Set,Card,Printing}
                        │
            ┌───────────┼─────────────┐
            ▼           ▼             ▼
   canonical-keys  variant-classify  normalize/{rarity,type,…}
                        │
                        ▼
              Insert via @binderly/db
```

The resolver pulls from the **primary** source first. **Validation**
sources cross-check field values; significant disagreement surfaces a
`DataConflict` for ops review (does NOT throw). **Filler** sources fill
fields the primary left null/undefined.

## Module map

| File                              | Purpose                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                    | `Raw*` and `Canonical*` shared types + zod schemas.                                                             |
| `src/interfaces/adapter.ts`       | `SourceAdapter` interface, `AdapterContext`, `AdapterError` discriminated union.                                |
| `src/canonical-keys.ts`           | Pure `canonicalSetKey`, `canonicalCardKey`, `printingVariantKey` helpers.                                       |
| `src/variant-classify.ts`         | Pure variant decision tree (tcg-domain.md § 8). Returns variant_class/flags/code/include_in_master_set_default. |
| `src/normalize/rarity.ts`         | Per-source rarity → canonical rarity enum.                                                                      |
| `src/normalize/type.ts`           | Pokémon type and trainer-subtype normalization.                                                                 |
| `src/normalize/language.ts`       | Language code normalization.                                                                                    |
| `src/normalize/set-code.ts`       | Set code normalization (lowercase, strip spaces).                                                               |
| `src/http/rate-limited-client.ts` | `RateLimitedClient` — per-host token bucket, retries, backoff, Retry-After.                                     |
| `src/resolver/resolver.ts`        | `resolveCanonical` — merges adapters, surfaces conflicts.                                                       |

## How to add a new adapter

1. Add a folder `src/adapters/<source>/` with the source's mapping tables
   (`mappings/rarity.ts`, `mappings/type.ts`, etc.) and an `index.ts`
   exporting an object that implements `SourceAdapter`.
2. Use `RateLimitedClient` for every external HTTP call. Per-source
   limits live in the adapter's constructor.
3. Emit `Raw{Set,Card,Printing}` shapes — do **not** assign
   `variant_class` directly. The variant classifier owns that taxonomy
   to keep edge-case rules in one testable place.
4. Register the per-source rarity / type mappings in
   `src/normalize/rarity.ts` and friends.
5. Add fixture-based tests under `src/adapters/<source>/__fixtures__/`.

## Where rate limits live

Each adapter passes its host-specific configuration to
`RateLimitedClient`:

```ts
new RateLimitedClient({
  host: 'api.tcgdex.net',
  requestsPerSecond: 10,
  burst: 5,
  userAgent: 'Binderly/0.1 (contact: legal@binderly.app)',
  retries: { max: 4, baseDelayMs: 500, factor: 2 },
  timeout: 15_000,
});
```

Floors by source (see `context/legal-and-brand.md`):

- **TCGdex** — generous, but be polite. 10 req/s, burst 5.
- **pokemontcg.io** — 1000 req/day on free tier. 5 req/s, burst 3.
- **Bulbapedia** — MediaWiki etiquette. 1 req/s, burst 1.
- **PSA cert pages** — strictly ≤ 1 req/s.

The client honors `Retry-After` on `429` and `503` and applies
exponential backoff on other 5xx. `4xx` (other than `429`) does not
retry.

## How to seed

The seed-ingest job (`src/jobs/seed.ts`, exposed as
`pnpm --filter @binderly/data-pipeline seed`) glues every Phase-1
module together. It fans out across primary adapters, resolves each
canonical set via the resolver, classifies variants, decides
master-set membership, upserts to the catalog tables, and pipes
each printing's image through the image pipeline.

```sh
# Required env (defaults work against infra/docker-compose.yml):
export DATABASE_URL='postgres://postgres:postgres@localhost:54322/postgres'
export BINDERLY_DATA_PIPELINE_UA='Binderly/0.1 (contact: legal@binderly.app)'
export S3_ENDPOINT_URL='http://localhost:9000'
export MINIO_ROOT_USER='minio'
export MINIO_ROOT_PASSWORD='minio12345'
export IMAGES_BUCKET='images'
# Optional:
export BINDERLY_PTCGIO_API_KEY=...
export IMAGES_PUBLIC_URL_PREFIX='http://localhost:9000/images'

# Single source, single set (smoke test):
pnpm --filter @binderly/data-pipeline seed --source tcgdex-en --set en-swsh9

# Smoke test with no DB writes / no R2 uploads:
pnpm --filter @binderly/data-pipeline seed --dry-run --no-images --limit-sets 1

# Full run:
pnpm --filter @binderly/data-pipeline seed
```

End-of-run report is printed to stdout and persisted to
`data-pipeline/scripts/output/seed-run-<ISO_TIMESTAMP>.json`. The
`scripts/output/` directory is git-ignored except for `.gitkeep`.

The job is idempotent at the row level: re-running against the same
catalog re-upserts the same `canonical_key` rows, and the image
pipeline short-circuits via `printing_image (source, original_sha256)`
dedup so already-transcoded images cost zero CPU + zero R2 PUTs.

See `tasks/01-data-layer/T-DL-SEED-INGEST.md` for the full spec
(run-shape diagram, concurrency model, idempotency strategy,
failure handling, reporting contract).

## What this package is NOT

- It does not download images outside of the seed-ingest job. The
  image pipeline (`src/images/`) is invoked by `runSeedIngest`; other
  callers must wire it themselves.
- It does not own the master-set rules engine. That lives at
  `data-pipeline/src/master-set/` (T-DL-MASTER-SET-RULES) and reads the
  variant classifier output as input.

## Jobs (cron-runnable runners)

The `src/jobs/` folder holds the cron-runnable runners that consume the
adapters and write to `@binderly/db`. Each ships a CLI under `scripts/`
for ad-hoc / local invocation.

### `fx-rates` — daily FX-rate ingest (T-DL-FX-RATES)

Pulls from the [Frankfurter](https://frankfurter.dev) FX API and upserts
into `fx_rate`. Source = `frankfurter`; base = `USD`; quotes = `EUR,
GBP, JPY, AUD, CAD, MXN`. Runs idempotently via the table's
`(rate_date, base_currency, quote_currency)` PK.

```sh
# Yesterday's rates (most common — daily cron)
pnpm --filter @binderly/data-pipeline fx-rates --latest

# A specific historical date
pnpm --filter @binderly/data-pipeline fx-rates --date 2026-04-30

# A backfill range (uses Frankfurter's range endpoint)
pnpm --filter @binderly/data-pipeline fx-rates \
  --from-date 2026-04-01 --to-date 2026-04-30
```

DB connection precedence: `--url <conn>` > `DATABASE_URL` >
`SUPABASE_DB_URL`. The CLI prints a single line of JSON
(the `FxRatesReport`) to stdout on success.

ECB doesn't publish on weekends or TARGET2 holidays. Frankfurter
silently remaps weekend / holiday requests to the most recent prior
business day; the runner stores rows keyed on Frankfurter's returned
`date`, which is what the display layer's "fall back to most recent
prior date" rule already expects.

### `pricing-ebay-browse` — Layer 2 active-listing ingest (T-DL-PRICING-EBAY-BROWSE)

Hits eBay's [Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html)
(`api.ebay.com/buy/browse/v1/item_summary/search`), parses each
listing title via `parseEbayListing()`, joins to a printing via
`resolveListingToPrinting()`, and upserts the resolved
`RawEbayBrowsePriceObservation` rows into `price_observation` keyed on
`(source = 'ebay_browse', source_listing_id = itemId)`. Per
`PROJECT.md` § 13, this is the _independent_ (Layer 2) data trail —
free, no approval required, growing in coverage and history every
day from launch.

#### One-time setup — eBay developer credentials

1. Create a developer account at <https://developer.ebay.com/my/keys>.
2. Create a "Production" keyset and record:
   - `App ID (Client ID)` → `EBAY_CLIENT_ID`
   - `Cert ID (Client Secret)` → `EBAY_CLIENT_SECRET`
3. Export them in any environment that runs the job:

   ```sh
   export EBAY_CLIENT_ID='YourCompany-Binderly-PRD-...'
   export EBAY_CLIENT_SECRET='PRD-...-...'
   ```

The runtime exchanges them for a short-lived Application Token via
the OAuth client-credentials grant; the token is cached in-process
and refreshed ~120 s before expiry.

#### CLI usage

```sh
# Ingest active listings for one canonical set (one query per card)
pnpm --filter @binderly/data-pipeline pricing-ebay-browse \
  --set en-swsh9 --max-queries 10 --url <postgres://...>

# Ingest a single free-text query
pnpm --filter @binderly/data-pipeline pricing-ebay-browse \
  --query "Charizard VMAX 020/172 Brilliant Stars" --url <postgres://...>

# Sandbox / no-credentials smoke test (synthetic fixtures, in-memory repo)
MOCK_PRICING_EBAY_BROWSE=1 \
  pnpm --filter @binderly/data-pipeline pricing-ebay-browse \
  --set en-swsh9 --max-queries 3
```

Modes:

- **Live** (`MOCK_PRICING_EBAY_BROWSE` unset, `EBAY_CLIENT_ID` /
  `EBAY_CLIENT_SECRET` exported): hits `api.ebay.com` with a real
  Application Token; writes to the configured Postgres unless
  `--dry-run`.
- **Mock** (`MOCK_PRICING_EBAY_BROWSE=1`): synthetic fixtures (a
  PSA 10, a BGS 9.5, a raw NM, and one lot listing per query); no
  credentials, no network, no Postgres needed.
- **Dry run** (`--dry-run` + URL): real catalog reads; in-memory
  repo (no observations written).

Flags:

- `--query "<text>"` — repeatable; or `--set <canonical-set-key>`
  (e.g. `en-swsh9`). Mutually exclusive.
- `--marketplace EBAY_US` (default) | `EBAY_GB` | `EBAY_DE` |
  `EBAY_JP`.
- `--max-queries N` — cap on queries dispatched per run (daily
  quota guard rail).
- `--page-size N` (≤ 200), `--max-pages-per-query N`,
  `--max-listings-per-query N`.
- `--url <conn>` (or `DATABASE_URL` / `SUPABASE_DB_URL`).

The CLI prints a single line of JSON (the
`PricingEbayBrowseReport`) to stdout on success and exits 0;
on any unrecoverable error it prints a diagnostic to stderr and
exits 1. Per-query 404s + low-confidence drops + lot drops are
all reported under `errors[]` / counters and the run continues.

#### Rate-limit posture

eBay's free Application Token tier ships ~5 000 calls/day. The
limiter is configured at 1 rps / burst 5 — well under the
documented per-second ceiling — and `--max-queries` lets you cap
each scheduled run's quota draw. Production cron is one
`--set <set-key>` call per primary set per day.

### `pricing-rollup` — daily rollup into `price_aggregate` (T-DL-PRICING-ROLLUP)

Aggregates yesterday's `price_observation` rows into the
`price_aggregate` table per
`(printing_id, grade_tier, market, currency, observed_date)`,
applying the canonical filters (`parse_confidence < 0.7` excluded;
top/bottom 5% trimmed when `sample_count >= 20`) per
[`context/data-model.md` § price_aggregate](../context/data-model.md).
Currency is part of the group key; we **do not** convert at rollup
time — display-time conversion lives in
`packages/pricing-display`. Idempotent via the table's composite
PK and `ON CONFLICT … DO UPDATE`.

#### CLI usage

```sh
# Roll up yesterday-UTC (production daily cron)
pnpm --filter @binderly/data-pipeline pricing-rollup --url <postgres://...>

# A specific date
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date 2026-05-03 --url <postgres://...>

# Backfill the last 7 days
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date 2026-05-03 --days 7 --url <postgres://...>

# Single-printing test
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date 2026-05-03 --printing 00000000-0000-4000-8000-000000000001 \
  --url <postgres://...>

# Dry-run against a real catalog (no DB writes)
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date 2026-05-03 --dry-run --url <postgres://...>

# Smoke test with no DB / no network (synthetic fixtures)
MOCK_PRICING_ROLLUP=1 pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date 2026-05-02 --dry-run

# Multi-day mock smoke (exercises the multi-day driver + reader filter)
MOCK_PRICING_ROLLUP=1 pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date 2026-05-03 --days 2 --dry-run
```

Modes:

- **Live** (`MOCK_PRICING_ROLLUP` unset, `--url`/`DATABASE_URL`/
  `SUPABASE_DB_URL` set): Drizzle reader over `price_observation`
  - Drizzle repo over `price_aggregate`.
- **Dry run** (`--dry-run` + URL): Drizzle reader (real catalog
  scan), in-memory repo (no aggregates written).
- **Mock** (`MOCK_PRICING_ROLLUP=1`): synthetic fixtures (two
  printings, two grade tiers, two days, includes a
  parse-confidence outlier so the filter is exercised); no
  credentials, no network, no Postgres needed.

Flags:

- `--date YYYY-MM-DD` — END of the rollup window. Defaults to
  yesterday-UTC.
- `--days N` — Number of days ending at `--date` (≥ 1; default 1).
- `--printing UUID` — Restrict the streamed observations to one
  printing.
- `--dry-run` — Skip repo writes; still emits the report.
- `--url <conn>` (or `DATABASE_URL` / `SUPABASE_DB_URL`).

The CLI prints a single line of JSON (the `PricingRollupReport`)
to stdout on success and exits 0; on any unrecoverable error it
prints a diagnostic to stderr and exits 1. Per-day failures
during a multi-day backfill are recorded under `errors[]` and the
run continues — same posture as `fx-rates` and
`pricing-ebay-browse`.

#### Live smoke (paste-able for Pablo)

```sh
cd /Users/pmiranda/Stuff/Binderly  # or your worktree
git checkout main && git pull --ff-only
export PATH="/Users/pmiranda/.nvm/versions/node/v22.13.0/bin:$PATH"
pnpm install --prefer-offline

# 1. Bring up Postgres + run migrations.
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @binderly/db db:migrate

# 2. Seed a tiny pricing fixture (the eBay-browse mock writes
#    real observations to the local DB):
MOCK_PRICING_EBAY_BROWSE=1 pnpm --filter @binderly/data-pipeline \
  pricing-ebay-browse --set en-swsh9 --max-queries 3

# 3. Roll the day's observations up into price_aggregate.
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date "$(date -u -v-1d +%F)" --dry-run

# 4. Same command without --dry-run writes the rows.
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date "$(date -u -v-1d +%F)"

# 5. Inspect:
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT printing_id, grade_tier, market, currency,
             period_start, sample_count, mean_price
        FROM price_aggregate ORDER BY period_start DESC LIMIT 10;"
```

## Testing

```sh
pnpm --filter @binderly/data-pipeline test
```

Tests use vitest with the `undici` MockAgent for HTTP-level fixtures
(see `src/http/rate-limited-client.test.ts`) — no live network during
`pnpm test`.
