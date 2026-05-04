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

## What this package is NOT

- It does not write to the database. The seed-ingest task
  (T-DL-SEED-INGEST) wires `resolveCanonical` to `@binderly/db` upserts.
- It does not download images. The image pipeline
  (T-DL-IMAGE-PIPELINE) consumes `image_source_url` from the canonical
  output.
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
