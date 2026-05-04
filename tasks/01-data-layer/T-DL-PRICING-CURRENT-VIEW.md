# T-DL-PRICING-CURRENT-VIEW — mv_current_price materialized view + nightly refresh

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** S
**Status:** in_progress

---

## Hard dependencies

- **T-DL-PRICING-ROLLUP** (merged at `1cc7a40` on `main`) — populates
  `price_aggregate` per
  `(printing_id, grade_tier, market, currency, period_start)` daily.
  This task reads exclusively from that table.

Transitive (via T-DL-PRICING-ROLLUP):

- **T-DL-SCHEMA-PRICING** — defines `price_aggregate`
  (`packages/db/src/schema/price_snapshots.ts`) and `market`
  (`packages/db/src/schema/prices.ts`).
- **T-DL-PRICING-AGGREGATOR** + **T-DL-PRICING-EBAY-BROWSE** — feed
  `price_observation` upstream.

## Soft dependencies

- **T-SP-PRICING-DISPLAY** (Phase 3, not yet started) — the future
  consumer of `mv_current_price`. Headline-price columns shape the
  card-detail UI's read path. Trends + freshness columns called out in
  `context/data-model.md` are deferred to a follow-up task once the
  display layer needs them (see "Out of scope" + "Open questions"
  below).

## Required reading

- `PROJECT.md` § 13 (Pricing & FX), specifically "Currency model",
  "Markets: eBay primary, Cardmarket secondary".
- `context/data-model.md` § "`mv_current_price` (materialized view)"
  — authoritative columns for the eventual full view.
- `rules/01-data-layer.md` (data-layer hard rules — pricing is
  market-segmented; native currency at ingest; no FX in aggregates).
- `packages/db/src/schema/prices.ts` (`market`, `price_observation`).
- `packages/db/src/schema/price_snapshots.ts` (`price_aggregate`,
  `fx_rate`).
- `packages/db/src/migrations/0008_pricing_tables.sql` (physical DDL
  for `price_aggregate`).
- `packages/db/src/migrations/0009_pricing_rls.sql` (RLS posture for
  the underlying pricing tables — the GRANT pattern this migration
  mirrors for the materialized view).
- `packages/db/src/migrations/0011_image_provenance_rls.sql` and
  `0012_profile_grants_fix.sql` (most recent hand-authored
  REVOKE/GRANT migrations — pattern for idempotent companion
  migrations).
- `data-pipeline/src/jobs/pricing-rollup.ts` +
  `data-pipeline/scripts/pricing-rollup.ts` — closest-precedent job
  shape: in-memory shim, Drizzle wiring, mock-mode CLI, dry-run.
- `data-pipeline/src/jobs/fx-rates.ts` — partial-failure reporting
  pattern (we don't need it here but the runner shape mirrors it).
- `packages/db/scripts/verify-rls.ts` + `…/verify-rls/inventory.ts` —
  the structural RLS asserter; this task does **not** extend it
  because materialized views are out of scope of `pg_class` /
  `pg_policies` assertions for RLS (PG does not support RLS on
  materialized views — see "Approach > RLS posture" below).

## Goal

Create `mv_current_price`, a Postgres materialized view over
`price_aggregate` that pre-computes the latest aggregate row per
`(printing_id, grade_tier, market, currency)`. This is the fast-path
the future card-detail UI reads from for headline pricing. Ship a
nightly-refreshable runner (`runPricingCurrentViewRefresh`) and a CLI
(`pricing-current-view --refresh` / `--dry-run`) so ops can wire the
refresh into cron / Edge Functions later.

## Scope — in

- Hand-authored migration `0013_mv_current_price.sql` that:
  - Creates `mv_current_price` (no data initially —
    `WITH NO DATA` so the migration is fast and never blocks on a
    cold catalog; the refresh job materializes it).
  - Creates the **UNIQUE** index
    `(printing_id, grade_tier, market, currency)` required for
    `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
  - Creates a lookup index on `(printing_id)` for "all prices for
    this card" reads.
  - Applies the `REVOKE ALL FROM PUBLIC` + `GRANT SELECT TO
    anon, authenticated` + `GRANT SELECT TO service_role` posture
    that mirrors `price_aggregate` in `0009_pricing_rls.sql`.
  - Documents in SQL comments why RLS itself is not enabled on the
    view (PG 17 does not support `ALTER MATERIALIZED VIEW … ENABLE
    ROW LEVEL SECURITY` — verified against PG docs; the underlying
    tables' RLS gated the data on insert).
- `packages/db/src/migrations/meta/_journal.json` — append the 0013
  entry (idx 13, version 7, tag `0013_mv_current_price`).
- `data-pipeline/src/jobs/pricing-current-view.ts` —
  `runPricingCurrentViewRefresh(opts)` + `MaterializedViewRefresher`
  interface + `InMemoryMaterializedViewRefresher` shim for tests.
- `data-pipeline/src/jobs/pricing-current-view.test.ts` — unit tests
  driven against the in-memory shim.
- `data-pipeline/scripts/pricing-current-view.ts` — CLI with
  `--refresh`, `--dry-run`, `--url`, `--help`.
- `data-pipeline/src/jobs/index.ts` — append a new
  `=== T-DL-PRICING-CURRENT-VIEW ===` section.
- `data-pipeline/package.json` — add `pricing-current-view` script.
- `data-pipeline/README.md` — append a `## Pricing current view`
  section with mock-mode + dry-run + smoke-test paste-able commands.

## Scope — out

- **Trends + freshness columns** (`trend_30d_pct`, `trend_90d_pct`,
  `trend_all_time_pct`, `sample_count_30d`, `last_observation_at`,
  `freshness`) called out in `context/data-model.md` § mv_current_price.
  These depend on the display layer (T-SP-PRICING-DISPLAY) which
  hasn't started, and they require windowed aggregation that's a
  separate, larger piece of work. v1 ships the orchestrator-spec
  shape (latest aggregate stats per group key); the richer columns
  follow when the display layer needs them. See "Open questions" Q-006.
- **Filtering to primary-market rows.** `data-model.md` says the view
  exposes "primary-market only"; v1 keeps every market because
  the display layer hasn't shipped its market-toggle UX yet and we
  want the view to be a strict superset of the eventual primary-only
  shape. Filtering is a one-line WHERE adjustment when needed.
- **Trigger-based refresh.** The refresh is a CLI runner intended for
  cron / Edge Functions; no on-write trigger.
- **App reads via Drizzle.** The mv is consumed read-only by the
  future app (`packages/app` / `packages/api-client`). For the refresh
  runner's needs we use raw SQL via the `postgres-js` client — Drizzle
  doesn't model materialized views as `pgTable`s (no `schema/index.ts`
  entry).
- **Live database test of the refresh.** The Drizzle `db:migrate`
  wrapper + a live `REFRESH … CONCURRENTLY` are out of scope for this
  PR — they fail under the sandbox's tsx-IPC-pipe limitation
  (T-DL-DB-TEST-INFRA tracks the fix). The PR body ships a
  paste-able smoke test for Pablo to run post-merge.
- **Extension of `verify-rls`.** PG 17 does not support RLS on
  materialized views, so there is no `pg_policies` posture to
  assert. The view's access posture is enforced by SQL grants only,
  which the migration spells out and the PR review can audit; no
  TS-level inventory entry is added.

## Inputs / outputs

**Reads** (at refresh time): `price_aggregate` only. The view's
defining query is:

```sql
SELECT DISTINCT ON (printing_id, grade_tier, market, currency)
  printing_id,
  grade_tier,
  market,
  currency,
  period_start,
  median_price,
  mean_price,
  low_price,
  high_price,
  sample_count,
  computed_at
FROM price_aggregate
ORDER BY printing_id, grade_tier, market, currency, period_start DESC;
```

`DISTINCT ON … ORDER BY … period_start DESC` keeps the LATEST
aggregate row per group key (Postgres-canonical idiom). Currency is
part of the group key so the rare cross-currency scenario the schema
calls out (CARDMARKET_EU listing in GBP) keeps both rows.

**Writes**: refresh updates `mv_current_price` in place via
`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_current_price` (requires
the `(printing_id, grade_tier, market, currency)` unique index that
the migration creates).

## Approach

### DDL sketch

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_current_price" AS
SELECT DISTINCT ON ("printing_id", "grade_tier", "market", "currency")
  "printing_id",
  "grade_tier",
  "market",
  "currency",
  "period_start",
  "median_price",
  "mean_price",
  "low_price",
  "high_price",
  "sample_count",
  "computed_at"
FROM "price_aggregate"
ORDER BY "printing_id", "grade_tier", "market", "currency", "period_start" DESC
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS "mv_current_price_pk_idx"
  ON "mv_current_price" ("printing_id", "grade_tier", "market", "currency");

CREATE INDEX IF NOT EXISTS "mv_current_price_printing_idx"
  ON "mv_current_price" ("printing_id");

REVOKE ALL ON "mv_current_price" FROM PUBLIC;
GRANT SELECT ON "mv_current_price" TO anon, authenticated;
GRANT SELECT ON "mv_current_price" TO service_role;
```

`WITH NO DATA` keeps the migration fast even when `price_aggregate`
already has rows — `db:migrate` doesn't get blocked on materializing.
First run after migration uses `REFRESH MATERIALIZED VIEW
mv_current_price` (no `CONCURRENTLY`; that requires the view to
already have data). Subsequent refreshes use `CONCURRENTLY` and never
block readers. The runner picks the right form based on whether the
view has been populated yet.

### Refresh strategy

- Cadence: nightly, run **after** `pricing-rollup` so the view sees
  the freshest aggregates. Documented for ops to wire later — no
  scheduler in this PR.
- Concurrency: `REFRESH MATERIALIZED VIEW CONCURRENTLY` after the
  initial population. Requires the `(printing_id, grade_tier, market,
  currency)` unique index which the migration creates.
- Initial population: the runner detects the empty state via
  `pg_class.relpages = 0` and falls back to a non-concurrent
  `REFRESH MATERIALIZED VIEW`. Logged as `initial_population: true`
  in the report.

### Indices

- **UNIQUE** `(printing_id, grade_tier, market, currency)` — required
  for `REFRESH … CONCURRENTLY` per the PG docs; doubles as the
  natural lookup index for the future display path
  (`SELECT * FROM mv_current_price WHERE printing_id = $1 AND
  grade_tier = $2 AND market = $3`).
- `(printing_id)` — for the "give me every price for this card"
  read pattern (multiple grade tiers + markets).

The orchestrator's dispatch hinted at a possible
`(printing_id, grade_tier)` index. The `(printing_id)` index already
covers that prefix; adding a second composite would only matter when
the second column is highly selective and queried independently. Skip
for v1; revisit when the display layer's read patterns are pinned.

### RLS posture

Materialized views in PostgreSQL **do not support** row-level
security. Verified against the [PG 17 ALTER MATERIALIZED VIEW
docs](https://www.postgresql.org/docs/17/sql-altermaterializedview.html):
the action list does not include `ENABLE ROW LEVEL SECURITY`. RLS in
PG 17 is "supported for tables" only (per the [Row Security Policies
docs](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)).

The orchestrator's dispatch hinted that PG 14+ might support this;
that is not the case in PG 17 (which is what local Supabase CLI
2.98.1 ships, per Q-003 in `open-questions.md`).

Posture for this view, mirroring the `price_aggregate` GRANT block in
`0009_pricing_rls.sql`:

- `REVOKE ALL ON mv_current_price FROM PUBLIC;` (defense-in-depth).
- `GRANT SELECT ON mv_current_price TO anon, authenticated;`
  (PostgREST checks SQL privileges before any policy-equivalent
  layer; explicit GRANT is required).
- `GRANT SELECT ON mv_current_price TO service_role;` (service role
  bypasses RLS via Supabase's BYPASSRLS attribute, but PostgREST
  still checks SQL privileges first; matches the convention from
  every other RLS migration).
- No `INSERT` / `UPDATE` / `DELETE` grants for any role — the view is
  refreshable by the migration owner only (`postgres` superuser
  locally; the migration runner in production), and consumers never
  write.

The underlying `price_aggregate` table's RLS already restricts who
can insert into the source; the materialized view caches a
public-read summary of public-read data. No data leakage.

### `SECURITY INVOKER` vs `SECURITY DEFINER`

PostgreSQL materialized views (unlike regular views in PG 15+) do not
expose a `SECURITY` qualifier. Queries against `mv_current_price` run
with the calling role's privileges over the materialized table; the
defining query is replayed only on `REFRESH`, executed as the view
owner. Documented in the migration comment for clarity.

### CLI ergonomics

```sh
pnpm --filter @binderly/data-pipeline pricing-current-view --refresh
pnpm --filter @binderly/data-pipeline pricing-current-view --refresh --dry-run
MOCK_PRICING_CURRENT_VIEW=1 pnpm --filter @binderly/data-pipeline \
  pricing-current-view --refresh
```

`--refresh` is the default operation (and the only one v1 supports);
the flag is required to keep the surface explicit and leave room for
future verbs (`--show-stats`, `--init`, etc.). `--dry-run` prints the
SQL the runner would issue without executing it.

### Drizzle integration

Materialized views are NOT `pgTable`s in Drizzle. **No** entry is
added to `packages/db/src/schema/index.ts`. The refresh job uses raw
SQL via the `postgres-js` client (same `createDbClient(...).$client`
pattern as `scripts/pricing-rollup.ts`, lines 422-425). When the app
package eventually ships, it will read the view via Drizzle's `sql`
template tag or a hand-authored typed wrapper.

## Acceptance criteria

- [ ] Migration `0013_mv_current_price.sql` exists, is hand-authored,
      and matches the DDL sketch above (CREATE MATERIALIZED VIEW
      WITH NO DATA + UNIQUE index + lookup index + REVOKE/GRANT
      block + comment header explaining the RLS-vs-mv posture).
- [ ] Migration is idempotent: every statement uses `IF NOT EXISTS` /
      is otherwise re-run-safe.
- [ ] `_journal.json` carries a new entry at idx 13 with tag
      `0013_mv_current_price`, version `7`, breakpoints `true`, and a
      monotonically-increasing `when` field.
- [ ] `runPricingCurrentViewRefresh({ refresher, dryRun? })` returns
      a `PricingCurrentViewReport` carrying:
      `{ initialPopulation: boolean, dryRun: boolean,
        sqlExecuted: string[], durationMs: number }`.
- [ ] Argument validation: missing `refresher` throws.
- [ ] `dryRun: true` produces a report whose `sqlExecuted` is empty
      and whose `dryRun` flag is `true`; the `MaterializedViewRefresher`
      shim records zero invocations.
- [ ] `dryRun: false` calls `refresher.refresh({ concurrently })`
      exactly once per run; the in-memory shim records the call.
- [ ] Initial-population mode (refresher reports `isPopulated:
      false`) issues `REFRESH MATERIALIZED VIEW mv_current_price`
      (no `CONCURRENTLY`); subsequent refreshes
      (`isPopulated: true`) issue
      `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_current_price`.
- [ ] `MOCK_PRICING_CURRENT_VIEW=1` runs the CLI without DB or
      network using a synthetic in-memory refresher; emits a
      `PricingCurrentViewReport` to stdout.
- [ ] CLI smoke: `--help` prints usage; missing operation flag
      prints usage and exits 1.
- [ ] All five `@binderly/data-pipeline` package gates pass clean:
      `format:check`, `lint`, `typecheck`, `test`, `build`.
- [ ] All three `@binderly/db` package gates pass clean:
      `format:check`, `lint`, `typecheck` (the migration is here).
- [ ] Tests strictly grow: 1072 → ≥ 1080 (target 8+ new tests
      covering each AC bullet).
- [ ] Branch `agent/T-DL-PRICING-CURRENT-VIEW` pushes; GitHub
      Actions checks pass green before the PR opens.

## Owns_paths

The `dependencies.yaml` entry currently lists
`packages/db/src/migrations/rls/, packages/db/src/views/`. Neither
folder exists at HEAD; the dispatch broadened the scope to:

- `packages/db/src/migrations/0013_mv_current_price.sql`
- `data-pipeline/src/jobs/pricing-current-view.ts`
- `data-pipeline/src/jobs/pricing-current-view.test.ts`
- `data-pipeline/scripts/pricing-current-view.ts`

## Files outside `owns_paths` pre-authorized

The dispatch authorized:

- `packages/db/src/migrations/meta/_journal.json` — append idx 13 entry.
- `data-pipeline/src/jobs/index.ts` — add a new sectioned
  `=== T-DL-PRICING-CURRENT-VIEW ===` block; do NOT touch other
  sections.
- `data-pipeline/package.json` — add `pricing-current-view` script.
- `data-pipeline/README.md` — append a `## Pricing current view`
  section with mock-mode + smoke commands.
- `dependencies.yaml` — flip `T-DL-PRICING-CURRENT-VIEW` from
  `in_progress` → `review`.
- This task file — flip `Status` header to `review` after CI green.

`data-pipeline/src/index.ts` already re-exports `./jobs/index.js`
(pre-existing). No edit needed.

## Migrations

Adds `0013_mv_current_price.sql` (hand-authored). Drizzle-kit doesn't
model materialized views, so the migration is authored in SQL by hand
following the precedent of every existing RLS migration
(`0001` / `0003` / `0005` / `0007` / `0009` / `0011` / `0012`). The
journal entry is appended manually at idx 13.

## Dependencies (sanity check vs `dependencies.yaml`)

```yaml
- id: T-DL-PRICING-CURRENT-VIEW
  depends_on: [T-DL-PRICING-ROLLUP]    # merged ✓
  parallel_safe_with: []
  owns_paths: [packages/db/src/migrations/rls/, packages/db/src/views/]
```

Hard dependency `T-DL-PRICING-ROLLUP` is `merged` (commit `1cc7a40`).

## Test plan

Unit tests in `data-pipeline/src/jobs/pricing-current-view.test.ts`,
all driven against `InMemoryMaterializedViewRefresher`:

1. **Argument validation**: missing `refresher` rejects.
2. **Dry-run**: `dryRun: true` records no refresh calls; report's
   `dryRun === true` and `sqlExecuted` lists the SQL that would have
   run (so callers can preview).
3. **Live refresh — initial population**: refresher reports
   `isPopulated: false` → runner issues
   `REFRESH MATERIALIZED VIEW mv_current_price` (no
   `CONCURRENTLY`); report's `initialPopulation === true`.
4. **Live refresh — concurrent path**: refresher reports
   `isPopulated: true` → runner issues
   `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_current_price`;
   `initialPopulation === false`.
5. **Refresh failure**: refresher's `.refresh()` throws → error
   bubbles out of `runPricingCurrentViewRefresh` (no swallowing).
6. **Idempotency**: running the runner twice in a row both succeed
   (the shim's call log shows two calls).
7. **Logger usage**: an injected logger sees `start` and `done`
   structured-log events.
8. **`computedAt` clock**: optional `now` injectable for the report's
   `durationMs` baseline; verified by injecting a clock that ticks N
   ms.

Total: ~8-10 new tests. Strictly grows the package count.

CLI / live smoke (paste-able for Pablo, in PR body):

```sh
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @binderly/db db:migrate

# 1. Confirm aggregates exist (smoke fixture).
MOCK_PRICING_EBAY_BROWSE=1 pnpm --filter @binderly/data-pipeline \
  pricing-ebay-browse --set en-swsh9 --max-queries 3
pnpm --filter @binderly/data-pipeline pricing-rollup \
  --date "$(date -u -v-1d +%F)"

# 2. Refresh the materialized view.
pnpm --filter @binderly/data-pipeline pricing-current-view --refresh

# 3. Confirm it's populated.
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "\\d+ mv_current_price"
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT * FROM mv_current_price LIMIT 5;"
```

## Open questions

### Q-006 — Should `mv_current_price` ship the trends + freshness columns from `data-model.md`?

The orchestrator's dispatch and `context/data-model.md` § mv_current_price
disagree on the v1 column set:

- **Orchestrator dispatch (this iter):** "One row per
  `(printing_id, grade_tier, market, currency)` with the LATEST
  `price_aggregate` row's stats (mean / median / min / max /
  sample_count / period_start)." Simple, ~S effort.
- **`data-model.md` § mv_current_price:** Adds `current_price`
  (median of last 30 days of aggregates), `trend_30d_pct`,
  `trend_90d_pct`, `trend_all_time_pct`, `sample_count_30d`,
  `last_observation_at`, `freshness` (`'fresh' | 'stale' |
  'no_data'`), filters to primary-market rows, and PKs on
  `(printing_id, grade_tier, market)`.

This task implements the orchestrator's v1 shape (latest aggregate
stats, all markets, currency in PK). Reasoning: the trends + freshness
columns require windowed aggregation that's a meaningful piece of
work beyond S; the consumer (T-SP-PRICING-DISPLAY) hasn't started, so
shipping the richer columns now risks designing against an unbuilt
caller; the v1 shape is a strict subset of the eventual one (no
columns dropped, just no trends added), so the follow-up is
purely additive.

**Surfaced to orchestrator for ratification at PR review** — not
treated as a blocking ambiguity since the dispatch's v1 spec was
explicit.

If Pablo wants the richer shape now, the follow-up task
`T-DL-PRICING-CURRENT-VIEW-TRENDS` would:

- Replace the view's body with a windowed query over the last 30/90/
  all-time aggregates.
- Add the `last_observation_at` join to `price_observation`.
- Tighten the `WHERE` to `market.tier = 'primary'` (or surface the
  filter as a flag).
- Tighten the PK to `(printing_id, grade_tier, market)`.

## Branch & PR

- Branch: `agent/T-DL-PRICING-CURRENT-VIEW`
- PR title: `T-DL-PRICING-CURRENT-VIEW: mv_current_price materialised view + nightly refresh`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and escalate to orchestrator (via `open-questions.md` append) if:

- The PG version verification flips: PG ≥ 18 ships `ALTER
  MATERIALIZED VIEW … ENABLE ROW LEVEL SECURITY` and the local
  Supabase upgrade is in scope. (Current local: PG 17 per Q-003.)
- A second refresh path is needed (e.g. partial refresh of one
  printing) — that's beyond v1's "refresh the whole view nightly".
- The dispatch's `owns_paths` (`packages/db/src/migrations/rls/`,
  `packages/db/src/views/`) needs to be honored literally — neither
  folder exists, and the migration goes alongside the existing
  numbered SQL files in `packages/db/src/migrations/`.

## Notes from execution

_(empty until the implementation runs)_
