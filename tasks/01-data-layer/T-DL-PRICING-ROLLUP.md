# T-DL-PRICING-ROLLUP — Daily price observation -> aggregate rollup job (idempotent)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M
**Status:** review

---

## Hard dependencies

- **T-DL-PRICING-AGGREGATOR** (merged) — Layer 1 ingest. Writes
  `price_observation` rows tagged `source = 'aggregator_<vendor>'`,
  `observation_kind ∈ {'sold', 'aggregator_quote'}`. The repo
  abstraction we read TYPE-shape from is `RawPriceObservation` from
  `data-pipeline/src/adapters/pricing-aggregator/types.ts`, but our
  reader pulls from the **table** (`price_observation`), not from
  any in-memory adapter output.
- **T-DL-PRICING-EBAY-BROWSE** (merged) — Layer 2 ingest. Writes
  `price_observation` rows tagged `source = 'ebay_browse'`,
  `observation_kind = 'active_listing'`.

Both merged at `3ba39a7` on `main` (this branch's base).

## Soft dependencies

- **T-DL-FX-RATES** (merged) — populates `fx_rate`. Despite the
  dispatch-prompt suggestion to "FX-convert at rollup time", the
  schema (`packages/db/src/schema/price_snapshots.ts` § `priceAggregateTable`),
  `context/data-model.md` § `price_aggregate`, `PROJECT.md` § "Currency
  model: store native, convert at display time", and `rules/01-data-layer.md`
  ("Conversion happens at display time using `fx_rate`") all
  *unambiguously* require the rollup to keep prices in their native
  currency. **This task does NOT read `fx_rate`**; conversion is the
  job of `T-SP-PRICING-DISPLAY` later. See "Notes from execution" §
  "Deviation from dispatch instructions" for the audit trail.

## Required reading

- `PROJECT.md` § 13 (Pricing & FX), specifically "Currency model"
  and "Historical data from launch"
- `rules/01-data-layer.md` (data-layer hard rules — pricing is
  market-segmented; native currency at ingest)
- `context/data-model.md` § "Pricing tables" → `price_observation`
  and `price_aggregate`
- `packages/db/src/schema/prices.ts` (`price_observation`)
- `packages/db/src/schema/price_snapshots.ts` (`price_aggregate`,
  `fx_rate` — schema only, not read at runtime)
- `data-pipeline/src/jobs/fx-rates.ts` + `data-pipeline/scripts/fx-rates.ts`
  (job-shape + CLI ergonomics reference)
- `data-pipeline/src/jobs/pricing-ebay-browse.ts` +
  `data-pipeline/scripts/pricing-ebay-browse.ts` (reference for
  repo abstraction, in-memory shim, mock-mode CLI, dry-run)
- `data-pipeline/src/adapters/pricing-aggregator/repo.ts` (canonical
  `PriceObservationRepo` — name reserved; we use a different name)

## Goal

Roll up the previous day's `price_observation` rows into the
`price_aggregate` table so the display layer and the future
`mv_current_price` materialized view (T-DL-PRICING-CURRENT-VIEW)
have a fast, currency-aware summary per (printing × grade_tier ×
market × currency × day). The job is the cron-runnable runner;
wiring (cron / Edge Function) lives elsewhere.

## Scope — in

- A pure in-memory aggregator (`runPricingRollup`) that consumes a
  `PriceObservationReader` (async-iterator over a date's rows),
  groups, filters, and computes summary statistics, and writes via
  a `PriceAggregateRepo`.
- Drizzle-backed production reader + repo wired by the CLI.
- In-memory test shims (`InMemoryPriceObservationReader`,
  `InMemoryPriceAggregateRepo`).
- A CLI script (`scripts/pricing-rollup.ts`) with `--date`,
  `--days`, `--printing`, `--dry-run`, `--url`, `--help`, plus
  `MOCK_PRICING_ROLLUP=1` for credential-free smoke testing.
- README section + `package.json` script.
- Unit tests covering each acceptance criterion.

## Scope — out

- **No FX conversion.** Per the schema, the rules, and PROJECT.md,
  `price_aggregate` is per-currency and currency is part of the
  PK. Display-time conversion happens in
  `packages/pricing-display` (T-SP-PRICING-DISPLAY). Concretely:
  the rollup job NEVER reads `fx_rate`.
- No new migration. The job writes to the existing `price_aggregate`
  table from T-DL-SCHEMA-PRICING (no schema change required —
  verified by re-reading `price_snapshots.ts` against the rollup's
  output shape; column-by-column 1-1 mapping).
- No `mv_current_price` (that's T-DL-PRICING-CURRENT-VIEW).
- No statistics tweaks beyond what the schema names: median, mean,
  low, high, sample_count, source_breakdown,
  observation_kind_breakdown.
- No outlier-handling configurability beyond the documented
  "drop top/bottom 5% if `sample_count >= 20`" rule from
  `context/data-model.md`.
- No multi-day windows beyond `--days N` linear backfill (each day
  rolls up independently — weekly / monthly aggregates are a
  future schema-compatible enhancement using `period_end`).

## Inputs / outputs

**Reads**: `price_observation` rows for the target date(s),
filtered by:

- `observed_date = $date` (UTC date, exact equality — matches the
  `price_observation_observed_date_idx` index from
  `prices.ts`).
- `parse_confidence IS NULL OR parse_confidence >= 0.7` (per
  `context/data-model.md` § price_aggregate: "exclude
  `parse_confidence < 0.7`"; NULL means "confidence-free by
  definition" per the schema doc — those rows ARE included).

**Writes**: `price_aggregate` rows. One row per non-empty group of
`(printing_id, grade_tier, market, currency, observed_date)`.
Idempotent via the composite PK
`(printing_id, grade_tier, market, currency, period_start)` and
`ON CONFLICT … DO UPDATE`. `period_start = period_end =
observed_date`.

## Approach

### Algorithm (one pass per day)

1. **Stream observations**: `reader.streamObservationsForDate(date,
   { printingId? })` yields `RollupObservation` records (a narrow
   subset of `NewPriceObservation` — only the columns the rollup
   needs). Drizzle implementation issues
   `SELECT … FROM price_observation
    WHERE observed_date = $date
      AND (parse_confidence IS NULL OR parse_confidence >= 0.7)
      [AND printing_id = $printingId]`
   and yields rows from the cursor.
2. **Bucket by group key**: `(printing_id, grade_tier, market,
   currency, observed_date)` → array of observations. The
   bucketing happens entirely in memory; per-day volume is bounded
   by primary-set rollouts (single-thousands of observations is
   the target order).
3. **Per-bucket aggregation** (pure function `aggregateBucket`):
   1. Sort `observed_price` ascending.
   2. If `sample_count >= 20`, drop the top and bottom 5% by
      count (`ceil(0.05 * n)` from each end). For `n = 20` that's
      1 from each end → 18 retained; for `n = 100` that's 5/5 →
      90 retained. Below 20, all observations are retained
      verbatim. Documented from `context/data-model.md` §
      price_aggregate.
   3. Compute `low_price = min`, `high_price = max`,
      `mean_price = sum/n`, `median_price = sample-median` over
      the retained set. All formatted as `numeric(12,2)` strings
      via `toFixed(2)`.
   4. `sample_count` = retained-set size (NOT raw-set size — the
      filtered count is what the table records; documented in
      `Notes from execution`).
   5. `source_breakdown` = `{ source: count }` over the retained
      set. JSONB.
   6. `observation_kind_breakdown` = `{ kind: count }` over the
      retained set. JSONB.
   7. `computed_at` = `now()` (clock injectable for tests).
4. **Batch upsert**: `repo.upsertMany(rows)` using
   `ON CONFLICT (printing_id, grade_tier, market, currency,
   period_start) DO UPDATE SET …`.

### Multi-day backfill (`--days N`)

For `--days N`, the job runs the algorithm `N` times, once per day
in `[date - (N-1), date]` ascending. Each day's rollup is
independent; failures on day K are recorded in
`report.errors[]` with `kind = 'rollup_day_failed'`, `date = K`
and the run continues to day K+1 (not fatal). This matches the
fx-rates job's "partial-failure → continue" posture.

### Empty days

A day with zero observations passing the confidence filter
produces zero `price_aggregate` rows for that day. The report
records `daysScanned`, `observationsRead`, etc. so it's
observable.

### Idempotency

`ON CONFLICT … DO UPDATE` is the canonical pattern (matches
`fx-rates.ts` and `pricing-ebay-browse.ts`). Re-running for the
same date overwrites every aggregate value AND
`computed_at`. The same posture as eBay-browse's `ingestedAt`
bump.

## Acceptance criteria

- [ ] `runPricingRollup({ reader, repo, date: 'YYYY-MM-DD' })`
      returns a `PricingRollupReport` and writes one
      `price_aggregate` row per non-empty group.
- [ ] Observations with `parseConfidence < 0.7` are excluded from
      ALL aggregates and counters; observations with
      `parseConfidence === null` ARE included.
- [ ] Outlier rule: `sample_count >= 20` → drop top/bottom 5%
      (`ceil(0.05 * n)` each end). `< 20` → no outlier filter.
- [ ] Median is the canonical sample-median (mid value for odd
      `n`; mean of two mid values for even `n`).
- [ ] Group key is exactly `(printing_id, grade_tier, market,
      currency, observed_date)` — same shape as the schema's
      composite PK.
- [ ] Each emitted row carries the correct `source_breakdown` and
      `observation_kind_breakdown` JSON, summing to
      `sample_count`.
- [ ] Re-running on the same day produces no new rows (idempotent
      upsert) and the in-memory repo's row count is steady.
- [ ] `--days N` runs `N` per-day rollups; failures on one day
      don't stop subsequent days.
- [ ] `--printing <canonicalKey>` (translated to printing UUID at
      the CLI layer) restricts the streamed observations to that
      printing only.
- [ ] `--dry-run` skips repo writes; report still reflects what
      WOULD have been written.
- [ ] `MOCK_PRICING_ROLLUP=1` runs without DB or network using a
      synthetic in-memory reader fixture.
- [ ] All five package gates pass clean: `format:check`, `lint`,
      `typecheck`, `test`, `build`.
- [ ] Tests strictly grow: 1043 → ≥ 1060 (target 17+ new tests
      covering each AC bullet).

## Owns_paths

- `data-pipeline/src/jobs/pricing-rollup.ts`
- `data-pipeline/src/jobs/pricing-rollup.test.ts`
- `data-pipeline/scripts/pricing-rollup.ts`

## Files outside `owns_paths` pre-authorized

The dispatch authorized:

- `data-pipeline/src/jobs/index.ts` — append a new
  `=== T-DL-PRICING-ROLLUP ===` section, mirror existing pattern;
  do NOT touch other sections.
- `data-pipeline/package.json` — add `pricing-rollup` script.
- `data-pipeline/README.md` — append a new `## Pricing rollup` section.
- `dependencies.yaml` — flip `T-DL-PRICING-ROLLUP` from
  `in_progress` → `review`.
- This task file — flip `Status` header to `review` after CI
  green.

`data-pipeline/src/index.ts` already re-exports `./jobs/index.js`
(twice — pre-existing, not introduced by us; see line 16 + line 37).
No edit needed.

## Migrations

**None expected.** The `price_aggregate` table from
T-DL-SCHEMA-PRICING already has every column we write. Verified
against `packages/db/src/schema/price_snapshots.ts` § 63-124. No
new index needed: the composite PK doubles as the read index per
the schema docstring.

## Dependencies (sanity check vs `dependencies.yaml`)

```yaml
- id: T-DL-PRICING-ROLLUP
  depends_on: [T-DL-PRICING-AGGREGATOR, T-DL-PRICING-EBAY-BROWSE]
  parallel_safe_with: []
  owns_paths: [data-pipeline/src/jobs/pricing-rollup.ts]
```

Both deps `merged`. `owns_paths` covers the runner only — the
test file + CLI script + barrel/package/README touches are listed
above as pre-authorized add-ons (mirrors the
T-DL-PRICING-EBAY-BROWSE task that owns three paths in
`dependencies.yaml` but documented its barrel + script + README
edits in its task file).

## Test plan

Unit tests in `data-pipeline/src/jobs/pricing-rollup.test.ts`,
all driven against `InMemoryPriceObservationReader` +
`InMemoryPriceAggregateRepo`:

1. **Argument validation**: `date` required, `days >= 1`, mutually
   coherent with `until`.
2. **Confidence filter**:
   - excludes `parseConfidence = "0.50"` rows;
   - includes `parseConfidence = null` rows;
   - includes `parseConfidence = "0.70"` (boundary inclusive).
3. **Group key**:
   - same printing × different grades → 2 rows;
   - same printing × different markets → 2 rows;
   - same printing × different currencies on same market → 2
     rows (the rare cross-currency listing scenario the schema
     calls out).
4. **Stat correctness** for a hand-rolled fixture:
   - `n = 5` prices `[10, 20, 30, 40, 50]` → `low = 10`, `high = 50`,
     `mean = 30`, `median = 30`, `sample_count = 5`.
   - `n = 4` prices `[10, 20, 30, 40]` → `median = 25` (mean of
     20 and 30).
5. **Outlier filter**:
   - `n = 19` → all 19 retained.
   - `n = 20` → drop 1 from each end → 18 retained; verify
     `sample_count = 18`.
   - `n = 100` evenly distributed → drop 5/5 → 90 retained.
6. **Source / kind breakdown** sums to `sample_count`.
7. **Idempotency**: run twice on the same day → repo size steady.
8. **Multi-day**: `--days 3` produces 3 per-day rollups against a
   reader that yields rows for each day.
9. **Per-day failure**: if `repo.upsertMany` rejects on day 2,
   day 1 + day 3 still complete; `report.errors` includes day 2.
10. **printingId filter** restricts the reader's stream.
11. **Empty day**: zero rows in → zero rows out, no error.
12. **`computed_at`** uses the injected clock.

Total: ~17–20 new tests across the file. Strictly grows the
package count.

CLI smoke: `MOCK_PRICING_ROLLUP=1 pnpm --filter
@binderly/data-pipeline pricing-rollup --date 2026-05-03` runs end
to end with no DB or network and prints a `PricingRollupReport`
to stdout. Verified manually post-implementation; no automated
test for this layer (mirrors `pricing-ebay-browse`'s posture —
the CLI is thin glue).

## CLI surface

```sh
pnpm --filter @binderly/data-pipeline pricing-rollup [options]

Options:
  --date YYYY-MM-DD     Bucket date (default: yesterday-UTC).
  --days N              Number of consecutive days ending at --date
                        (default: 1).
  --printing UUID       Restrict to a single printing UUID.
  --dry-run             No DB writes; print report only.
  --url <conn>          Postgres connection string (defaults
                        DATABASE_URL → SUPABASE_DB_URL).
  -h, --help            Print this help.

Env:
  MOCK_PRICING_ROLLUP=1   Use synthetic in-memory fixture (no DB).
  DATABASE_URL            Postgres connection (or pass --url).
  SUPABASE_DB_URL         Fallback Postgres connection.
```

## Repo / reader abstractions

```ts
export interface PriceObservationReader {
  streamObservationsForDate(
    observedDate: string, // 'YYYY-MM-DD'
    opts?: { printingId?: string },
  ): AsyncIterable<RollupObservation>;
}

export interface PriceAggregateRepo {
  upsertMany(rows: ReadonlyArray<PriceAggregateRow>): Promise<number>;
}
```

`PriceAggregateRepo` is the new name (deliberately distinct from
the existing `PriceObservationRepo` in
`data-pipeline/src/adapters/pricing-aggregator/repo.ts` —
no symbol collision).

`InMemoryPriceObservationReader` and
`InMemoryPriceAggregateRepo` ship in the same file, exported but
not re-exported through `data-pipeline/src/index.ts` (test
helpers only — same posture as `InMemoryFxRateRepo`).

## Open questions

None. Every ambiguity called out by the dispatch prompt was
resolved by reading the schema + rules + PROJECT.md:

- **Aggregation key**: Schema's PK is canonical →
  `(printing_id, grade_tier, market, currency, period_start)`.
  Note: dispatch suggested
  `(printing_id, market, grade_tier, observed_date, kind)` — that
  is **not** what the schema specifies. `kind` is a breakdown
  *column* (`observation_kind_breakdown` jsonb), not a key
  dimension. Using the schema's PK.
- **Currency strategy**: Per-currency rows (currency is part of
  the PK; documented in the schema, the rules, and PROJECT.md
  § 13). NO FX conversion in this job.
- **Confidence filter threshold**: 0.7 (documented in
  `prices.ts` § `parseConfidence` doc + `context/data-model.md` §
  price_aggregate).
- **Outliers**: drop top/bottom 5% if `sample_count >= 20`
  (`context/data-model.md` + `price_snapshots.ts` doc both
  specify this). NOT "no outlier filter at v1" as the dispatch
  suggested.

If a deviation surfaces during implementation that requires a
product decision, it goes to `open-questions.md` as `Q-006+`
*before* the agent invents a posture.

## Branch & PR

- Branch: `agent/T-DL-PRICING-ROLLUP`
- PR title: `T-DL-PRICING-ROLLUP: daily price observation -> aggregate rollup job (idempotent)`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and escalate to orchestrator (via `open-questions.md`
append) if:

- Reading `price_observation` requires a column not in
  `prices.ts` (we should not need this).
- The "drop top/bottom 5%" rule produces ambiguous counts for a
  given `n` and the schema doesn't specify rounding (escalate as
  Q-006: should we use `floor` / `ceil` / `round`?). Default
  decision pre-baked in this task: `Math.ceil(0.05 * n)` from
  each end. Document as a "Notes from execution" decision.
- A second pricing-aggregator vendor is added between dispatch
  and merge that produces a `source` value not documented in
  PROJECT.md (we don't validate `source` strings — the
  breakdown jsonb just records whatever shows up).

## Notes from execution

### Deviation from dispatch instructions

The dispatch prompt (iter 8 hand-off) suggested: (a) optionally
FX-converting observations to a base currency at rollup time, (b)
defaulting to "no outlier filter at v1", and (c) a candidate
group key of `(printing, market, grade_tier, observed_date,
kind)`.

All three suggestions are superseded by the merged
T-DL-SCHEMA-PRICING reality:

1. **No FX in rollup.** The schema makes `currency` part of the
   PK and `rules/01-data-layer.md` is unambiguous: "Conversion
   happens at display time using `fx_rate` for the observation's
   date. The display package (`packages/pricing-display`) is the
   only place currency conversion happens — never in adapters,
   never in aggregates." Honoring the rule.
2. **Outlier filter active.** `context/data-model.md` § price_aggregate
   and the schema's docstring both specify "drop top/bottom 5% if
   `sample_count >= 20`; exclude `parse_confidence < 0.7`".
   We implement that.
3. **Group key matches schema PK.** `kind` is a breakdown column,
   not a key.

These are not unilateral product decisions — they're the merged
schema's contract, which the dispatch prompt explicitly directed
us to "read" before guessing. Documented here so the orchestrator
can confirm at PR review.

### Outlier-rounding posture

The schema says "drop top/bottom 5%" without specifying rounding
when `0.05 * n` isn't an integer. We use `Math.ceil(0.05 * n)`
from each end, so:

- `n = 19` → 0 dropped (gate is `n >= 20` anyway)
- `n = 20` → 1/1 dropped → 18 retained
- `n = 21` → `ceil(1.05) = 2` from each end → 17 retained
- `n = 40` → 2/2 → 36
- `n = 100` → 5/5 → 90

Pinned in tests so a future schema clarification surfaces a
deliberate change rather than a silent drift.

### `sample_count` semantics

`sample_count` records the **post-filter** count (post-confidence,
post-outlier) — i.e. the actual number of observations that
contributed to the median / mean / low / high. The
schema-docstring scenario "a row may exist with `sample_count = 0`"
applies to consumers that pre-create rows for known slices; this
job only emits a row when at least one observation made it
through the filters.

### FX-rate pair vocabulary

Not relevant to this job — see "Deviation" above. T-DL-FX-RATES
populates `(USD, [EUR, GBP, JPY, AUD, CAD, MXN])` daily; the
display package consumes those.

### `--days` posture vs `--from-date`/`--to-date`

We chose `--days N` (lookback from `--date`) over a paired
`--from-date`/`--to-date` to match the dispatch's wording and
keep the surface narrow. Future weekly / monthly rollups may want
a date-range syntax; that's a schema-compatible enhancement
because `period_start` ≠ `period_end` is already a thing in the
schema (currently we always set them equal for daily).
