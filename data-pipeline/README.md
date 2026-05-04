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

## Testing

```sh
pnpm --filter @binderly/data-pipeline test
```

Tests use vitest with the `undici` MockAgent for HTTP-level fixtures
(see `src/http/rate-limited-client.test.ts`) — no live network during
`pnpm test`.
