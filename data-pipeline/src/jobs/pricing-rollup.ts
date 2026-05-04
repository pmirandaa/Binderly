// `runPricingRollup` — daily rollup of `price_observation` rows into
// the `price_aggregate` table (T-DL-PRICING-ROLLUP).
//
// One run produces, per non-empty group key
// `(printing_id, grade_tier, market, currency, observed_date)`, a
// single `price_aggregate` row carrying:
//
//   median_price, mean_price, low_price, high_price, sample_count,
//   source_breakdown (jsonb), observation_kind_breakdown (jsonb),
//   computed_at.
//
// Filtering applied per `context/data-model.md` § price_aggregate:
//
//   - `parse_confidence < 0.7` excluded (NULL is included — the
//     schema's docstring defines it as "confidence-free by
//     definition").
//   - Outliers: when `sample_count >= 20`, drop the top and bottom
//     5% of observations (`Math.ceil(0.05 * n)` from each end) before
//     computing summary statistics. Below 20 observations, no
//     outlier filter.
//
// Currency posture (PROJECT.md § 13, `rules/01-data-layer.md`,
// `packages/db/src/schema/price_snapshots.ts`): we DO NOT convert
// at rollup time. `currency` is part of the `price_aggregate`
// composite PK; aggregates are stored per-currency. Display-time
// FX conversion is `packages/pricing-display`'s job.
//
// Idempotency: relies on the schema's composite PK
// `(printing_id, grade_tier, market, currency, period_start)`.
// Production `PriceAggregateRepo` issues `ON CONFLICT … DO UPDATE`
// (wired in `scripts/pricing-rollup.ts`); the in-memory shim in
// this file mirrors the same posture.
//
// Reporting: returns a `PricingRollupReport`. The CLI prints it as
// JSON; cron alerting consumes it directly. Per-day failures
// during a multi-day backfill (`--days N`) are recorded in
// `report.errors[]` and the run continues — same posture as
// `runPricingEbayBrowseIngest` / `runFxRatesIngest`.

import { type AdapterLogger } from '../interfaces/adapter.js';

// ============================================================
// Public types
// ============================================================

/**
 * The minimal subset of `price_observation` columns the rollup
 * needs. Mirrors the column names from
 * `packages/db/src/schema/prices.ts` so the production reader can
 * `select({ … })` straight out of Drizzle without a translation
 * pass. Defined here (rather than imported from `@binderly/db`)
 * so this module stays at the bottom of the type graph — same
 * posture as `FxRateRow` ↔ `NewFxRate` from T-DL-FX-RATES.
 */
export interface RollupObservation {
  readonly printingId: string;
  readonly gradeTier: string;
  readonly market: string;
  /** `'ebay_browse'`, `'aggregator_<vendor>'`, etc. */
  readonly source: string;
  /** `'sold' | 'active_listing' | 'aggregator_quote'`. */
  readonly observationKind: string;
  /** `numeric(12,2)` formatted string (e.g. `'12.34'`). */
  readonly observedPrice: string;
  /** ISO-4217 alpha-3, uppercase. */
  readonly observedCurrency: string;
  /**
   * `numeric(3,2)` formatted string (e.g. `'0.86'`) or `null`.
   * The runner already filters `< 0.70` at the reader level, but
   * carrying the raw value here keeps the type honest for future
   * threshold tuning.
   */
  readonly parseConfidence: string | null;
  /** ISO `YYYY-MM-DD` — the bucket key. */
  readonly observedDate: string;
}

/**
 * Mirrors `NewPriceAggregate` from `@binderly/db`. Defined here
 * (rather than imported) for the same reason as
 * `RollupObservation` above. The CLI bridges the two shapes —
 * column-by-column, no translation needed.
 */
export interface PriceAggregateRow {
  readonly printingId: string;
  readonly gradeTier: string;
  readonly market: string;
  readonly currency: string;
  /** ISO `YYYY-MM-DD`. Daily rollup → equal to `periodEnd`. */
  readonly periodStart: string;
  /** ISO `YYYY-MM-DD`. */
  readonly periodEnd: string;
  /** `numeric(12,2)` formatted string. */
  readonly medianPrice: string;
  readonly meanPrice: string;
  readonly lowPrice: string;
  readonly highPrice: string;
  readonly sampleCount: number;
  /** `{ "ebay_browse": 12, "aggregator_x": 1 }`. */
  readonly sourceBreakdown: Record<string, number>;
  /** `{ "sold": 8, "active_listing": 4, "aggregator_quote": 1 }`. */
  readonly observationKindBreakdown: Record<string, number>;
  readonly computedAt: Date;
}

/**
 * The reader the runner depends on for input. Tests inject
 * `InMemoryPriceObservationReader`; production wires a Drizzle
 * cursor in `scripts/pricing-rollup.ts`.
 *
 * Implementations MUST apply the rollup's confidence filter at
 * the source — i.e. yield only rows where
 * `parse_confidence IS NULL OR parse_confidence >= 0.70`. This
 * is documented at the SQL level in `context/data-model.md`
 * (`exclude parse_confidence < 0.7`); pushing it to the reader
 * keeps the runner's per-bucket loop O(retained) instead of
 * O(raw).
 */
export interface PriceObservationReader {
  streamObservationsForDate(
    observedDate: string,
    opts?: { readonly printingId?: string },
  ): AsyncIterable<RollupObservation>;
}

/**
 * The persistence boundary. Tests inject
 * `InMemoryPriceAggregateRepo`; production wires a Drizzle
 * `onConflictDoUpdate` in the CLI script. Implementations MUST
 * use `(printing_id, grade_tier, market, currency, period_start)`
 * as the conflict target — that's the schema's composite PK.
 *
 * Deliberately distinct from the merged `PriceObservationRepo`
 * symbol exported by `pricing-aggregator/repo.ts` — different
 * data direction (write to `price_aggregate`, not
 * `price_observation`).
 */
export interface PriceAggregateRepo {
  upsertMany(rows: ReadonlyArray<PriceAggregateRow>): Promise<number>;
}

/**
 * One non-fatal error captured during a multi-day run. The runner
 * collects these and reports at the end; fatal errors bubble out.
 */
export interface PricingRollupError {
  /** ISO `YYYY-MM-DD` the error pertains to. */
  readonly date: string;
  readonly kind: 'rollup_day_failed';
  readonly message: string;
}

/**
 * End-of-run report. Always emitted, even on partial failure.
 */
export interface PricingRollupReport {
  /** Echo of the inputs the caller supplied. */
  readonly rangeRequested: {
    /** ISO date — the END of the window (inclusive). */
    readonly date: string;
    /** Number of consecutive days rolled up (>= 1). */
    readonly days: number;
    /** Optional printing-uuid filter. */
    readonly printingId?: string;
    /** Whether `repo.upsertMany` was a no-op. */
    readonly dryRun: boolean;
  };
  /** Sorted list of dates the runner attempted. */
  readonly datesProcessed: ReadonlyArray<string>;
  /** Total observations the reader yielded across all days. */
  readonly observationsRead: number;
  /** Observations dropped by the outlier filter (post-confidence). */
  readonly observationsDroppedAsOutliers: number;
  /** Total `price_aggregate` rows the runner produced. */
  readonly aggregatesProduced: number;
  /** Total rows the repo confirmed it wrote (0 on dry-run). */
  readonly aggregatesUpserted: number;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  readonly errors: ReadonlyArray<PricingRollupError>;
}

/**
 * Runner inputs. Mode is daily-only for v1; the schema's
 * `period_start` ≠ `period_end` capability is reserved for
 * future weekly / monthly rollups.
 */
export interface RunPricingRollupOptions {
  readonly reader: PriceObservationReader;
  readonly repo: PriceAggregateRepo;
  /** END of the rollup window, inclusive. ISO `YYYY-MM-DD`. */
  readonly date: string;
  /** Number of days ending at `date` (default 1, must be >= 1). */
  readonly days?: number;
  /** Optional `printing.id` UUID filter. */
  readonly printingId?: string;
  /** When `true`, skip `repo.upsertMany` calls. Default false. */
  readonly dryRun?: boolean;
  readonly logger?: AdapterLogger;
  /**
   * Optional clock override (defaults to `() => new Date()`).
   * Tests pin this to assert `computed_at` round-trips
   * deterministically.
   */
  readonly now?: () => Date;
}

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

const SOURCE = 'pricing-rollup';

// ============================================================
// Public entry
// ============================================================

export async function runPricingRollup(
  opts: RunPricingRollupOptions,
): Promise<PricingRollupReport> {
  if (!opts.reader) throw new Error('runPricingRollup: `reader` is required');
  if (!opts.repo) throw new Error('runPricingRollup: `repo` is required');
  if (!opts.date || !ISO_DATE.test(opts.date)) {
    throw new Error(
      `runPricingRollup: \`date\` must be an ISO YYYY-MM-DD string (got ${JSON.stringify(opts.date)})`,
    );
  }
  const days = opts.days ?? 1;
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`runPricingRollup: \`days\` must be a positive integer (got ${days})`);
  }

  const startedAt = Date.now();
  const logger = opts.logger ?? NOOP_LOGGER;
  const now = opts.now ?? (() => new Date());
  const dryRun = opts.dryRun === true;

  const dates = enumerateBackwardWindow(opts.date, days);

  const errors: PricingRollupError[] = [];
  const datesProcessed: string[] = [];
  let observationsRead = 0;
  let observationsDroppedAsOutliers = 0;
  let aggregatesProduced = 0;
  let aggregatesUpserted = 0;

  logger.info(
    {
      source: SOURCE,
      date: opts.date,
      days,
      printingId: opts.printingId,
      dryRun,
    },
    'pricing-rollup.start',
  );

  for (const date of dates) {
    datesProcessed.push(date);
    try {
      const dayResult = await rollupOneDay({
        reader: opts.reader,
        date,
        printingId: opts.printingId,
        now,
      });
      observationsRead += dayResult.observationsRead;
      observationsDroppedAsOutliers += dayResult.observationsDroppedAsOutliers;
      aggregatesProduced += dayResult.rows.length;
      if (dayResult.rows.length > 0 && !dryRun) {
        aggregatesUpserted += await opts.repo.upsertMany(dayResult.rows);
      }
      logger.info(
        {
          source: SOURCE,
          date,
          observationsRead: dayResult.observationsRead,
          observationsDroppedAsOutliers: dayResult.observationsDroppedAsOutliers,
          aggregatesProduced: dayResult.rows.length,
        },
        'pricing-rollup.day.done',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ date, kind: 'rollup_day_failed', message });
      logger.error({ source: SOURCE, date, err: message }, 'pricing-rollup.day.failed');
    }
  }

  const durationMs = Date.now() - startedAt;
  const rangeRequested: PricingRollupReport['rangeRequested'] = {
    date: opts.date,
    days,
    dryRun,
    ...(opts.printingId !== undefined ? { printingId: opts.printingId } : {}),
  };
  const report: PricingRollupReport = {
    rangeRequested,
    datesProcessed,
    observationsRead,
    observationsDroppedAsOutliers,
    aggregatesProduced,
    aggregatesUpserted,
    durationMs,
    errors,
  };
  logger.info(
    {
      source: SOURCE,
      datesProcessed: report.datesProcessed,
      observationsRead,
      aggregatesProduced,
      aggregatesUpserted,
      errorCount: errors.length,
      durationMs,
    },
    'pricing-rollup.done',
  );
  return report;
}

// ============================================================
// Per-day driver
// ============================================================

interface DayResult {
  readonly rows: PriceAggregateRow[];
  readonly observationsRead: number;
  readonly observationsDroppedAsOutliers: number;
}

interface RollupOneDayArgs {
  readonly reader: PriceObservationReader;
  readonly date: string;
  readonly printingId?: string;
  readonly now: () => Date;
}

async function rollupOneDay(args: RollupOneDayArgs): Promise<DayResult> {
  const { reader, date, printingId, now } = args;
  const buckets = new Map<string, RollupObservation[]>();

  let observationsRead = 0;
  const streamOpts: { printingId?: string } = {};
  if (printingId !== undefined) streamOpts.printingId = printingId;

  for await (const obs of reader.streamObservationsForDate(date, streamOpts)) {
    observationsRead += 1;
    const key = bucketKey(obs);
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(obs);
  }

  const computedAt = now();
  const rows: PriceAggregateRow[] = [];
  let observationsDroppedAsOutliers = 0;

  for (const list of buckets.values()) {
    const aggregated = aggregateBucket(list, computedAt);
    if (aggregated == null) continue;
    observationsDroppedAsOutliers += aggregated.dropped;
    rows.push(aggregated.row);
  }

  // Stable output order — ascending by group key — so multi-day
  // re-runs produce identical row sequences and tests can compare
  // arrays by `toEqual` without tracking insertion order.
  rows.sort((a, b) => {
    if (a.printingId !== b.printingId) return a.printingId.localeCompare(b.printingId);
    if (a.gradeTier !== b.gradeTier) return a.gradeTier.localeCompare(b.gradeTier);
    if (a.market !== b.market) return a.market.localeCompare(b.market);
    if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
    return a.periodStart.localeCompare(b.periodStart);
  });

  return { rows, observationsRead, observationsDroppedAsOutliers };
}

function bucketKey(obs: RollupObservation): string {
  return `${obs.printingId}\u0000${obs.gradeTier}\u0000${obs.market}\u0000${obs.observedCurrency}\u0000${obs.observedDate}`;
}

// ============================================================
// Per-bucket aggregation (pure)
// ============================================================

interface AggregatedBucket {
  readonly row: PriceAggregateRow;
  readonly dropped: number;
}

/**
 * Pure aggregator. Caller is responsible for confidence filtering
 * (the reader does that); here we apply outlier filtering and
 * compute summary statistics.
 *
 * Returns `null` if the bucket is empty (defensive — the runner
 * never inserts an empty list, but the type stays honest).
 */
export function aggregateBucket(
  observations: ReadonlyArray<RollupObservation>,
  computedAt: Date,
): AggregatedBucket | null {
  if (observations.length === 0) return null;

  // Sort ascending by price for outlier trim + median computation.
  // numeric-string comparison via parseFloat is safe for the
  // numeric(12,2) range used by the schema.
  const sorted = [...observations].sort(
    (a, b) => parseFloat(a.observedPrice) - parseFloat(b.observedPrice),
  );

  let dropped = 0;
  let retained: RollupObservation[];
  if (sorted.length >= 20) {
    const trim = Math.ceil(sorted.length * 0.05);
    retained = sorted.slice(trim, sorted.length - trim);
    dropped = sorted.length - retained.length;
  } else {
    retained = sorted;
  }

  // After trimming a >=20 slice, retained is guaranteed >= 1
  // (n=20 → 18, n=100 → 90, n=1000 → 900). Guarding anyway in
  // case of a future tweak.
  if (retained.length === 0) return null;

  const prices = retained.map((o) => parseFloat(o.observedPrice));
  const low = prices[0]!;
  const high = prices[prices.length - 1]!;
  const sum = prices.reduce((acc, p) => acc + p, 0);
  const mean = sum / prices.length;
  const median = computeMedian(prices);

  const sourceBreakdown: Record<string, number> = {};
  const kindBreakdown: Record<string, number> = {};
  for (const obs of retained) {
    sourceBreakdown[obs.source] = (sourceBreakdown[obs.source] ?? 0) + 1;
    kindBreakdown[obs.observationKind] = (kindBreakdown[obs.observationKind] ?? 0) + 1;
  }

  // All `retained` rows share the same group key by construction
  // (the runner bucketed on it).
  const ref = retained[0]!;
  const row: PriceAggregateRow = {
    printingId: ref.printingId,
    gradeTier: ref.gradeTier,
    market: ref.market,
    currency: ref.observedCurrency,
    periodStart: ref.observedDate,
    periodEnd: ref.observedDate,
    medianPrice: formatPrice(median),
    meanPrice: formatPrice(mean),
    lowPrice: formatPrice(low),
    highPrice: formatPrice(high),
    sampleCount: retained.length,
    sourceBreakdown,
    observationKindBreakdown: kindBreakdown,
    computedAt,
  };
  return { row, dropped };
}

function computeMedian(sortedPrices: ReadonlyArray<number>): number {
  const n = sortedPrices.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sortedPrices[mid]!;
  }
  return (sortedPrices[mid - 1]! + sortedPrices[mid]!) / 2;
}

/**
 * Format a price as a `numeric(12,2)`-friendly string. Same posture
 * as `formatRate` in `fx-rates.ts` — strings round-trip cleanly,
 * `number` doesn't.
 */
function formatPrice(value: number): string {
  return value.toFixed(2);
}

// ============================================================
// Internals — date enumeration
// ============================================================

/**
 * Enumerate the `[date - (days - 1) … date]` window in ascending
 * ISO order, treating `date` as a UTC calendar date (no
 * timezone-shift surprises).
 *
 * Exported under a non-`run*` name for tests; the public surface
 * is `runPricingRollup` only.
 */
export function enumerateBackwardWindow(date: string, days: number): string[] {
  const out: string[] = [];
  const ref = parseISODate(date);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(ref.getTime());
    day.setUTCDate(ref.getUTCDate() - i);
    out.push(formatISODate(day));
  }
  return out;
}

function parseISODate(iso: string): Date {
  const [yyyy, mm, dd] = iso.split('-').map((s) => Number.parseInt(s, 10));
  return new Date(Date.UTC(yyyy!, mm! - 1, dd!));
}

function formatISODate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// Test helpers — exported so the CLI never imports them but
// tests can.
// ============================================================

/**
 * In-memory `PriceObservationReader`. Constructor takes a flat
 * list of observations; `streamObservationsForDate` filters by
 * `observedDate` and (optionally) `printingId`, then yields one
 * by one.
 *
 * Mirrors the production reader's confidence filter (caller is
 * responsible for not pushing `< 0.70` rows). Tests that exercise
 * the confidence filter explicitly push low-confidence rows and
 * pass a `confidenceThreshold` arg here that re-filters at
 * stream time — same behavior as the SQL `WHERE` clause does in
 * production.
 */
export class InMemoryPriceObservationReader implements PriceObservationReader {
  constructor(
    private readonly rows: ReadonlyArray<RollupObservation>,
    private readonly opts: { readonly confidenceThreshold?: number } = {},
  ) {}

  async *streamObservationsForDate(
    observedDate: string,
    opts?: { readonly printingId?: string },
  ): AsyncIterable<RollupObservation> {
    const threshold = this.opts.confidenceThreshold ?? 0.7;
    for (const row of this.rows) {
      if (row.observedDate !== observedDate) continue;
      if (opts?.printingId !== undefined && row.printingId !== opts.printingId) continue;
      if (row.parseConfidence != null) {
        const c = parseFloat(row.parseConfidence);
        if (Number.isFinite(c) && c < threshold) continue;
      }
      yield row;
    }
  }
}

/**
 * In-memory `PriceAggregateRepo`. Keys on the canonical composite
 * PK `(printing_id, grade_tier, market, currency, period_start)`
 * — same posture as `InMemoryFxRateRepo` and
 * `InMemoryEbayBrowsePriceObservationRepo`.
 */
export class InMemoryPriceAggregateRepo implements PriceAggregateRepo {
  readonly rows = new Map<string, PriceAggregateRow>();

  async upsertMany(rows: ReadonlyArray<PriceAggregateRow>): Promise<number> {
    for (const row of rows) {
      const key = `${row.printingId}|${row.gradeTier}|${row.market}|${row.currency}|${row.periodStart}`;
      this.rows.set(key, { ...row });
    }
    return rows.length;
  }

  size(): number {
    return this.rows.size;
  }

  list(): PriceAggregateRow[] {
    return [...this.rows.values()].sort((a, b) => {
      if (a.printingId !== b.printingId) return a.printingId.localeCompare(b.printingId);
      if (a.gradeTier !== b.gradeTier) return a.gradeTier.localeCompare(b.gradeTier);
      if (a.market !== b.market) return a.market.localeCompare(b.market);
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      return a.periodStart.localeCompare(b.periodStart);
    });
  }
}
