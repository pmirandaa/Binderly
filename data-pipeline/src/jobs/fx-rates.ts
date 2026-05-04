// `runFxRatesIngest` — the daily FX-rate ingestion job for Binderly.
//
// Pulls from Frankfurter and upserts into the `fx_rate` table. The job
// is the runner only — cron / Edge Function wiring lives elsewhere.
//
// Three modes (mutually exclusive — exactly one must be set):
//
//   - `latest:    true`            → `/v1/latest`. Writes 6 rows for the
//                                     date Frankfurter publishes (which
//                                     may be earlier than today on
//                                     weekends / holidays).
//   - `date:      'YYYY-MM-DD'`    → `/v1/{date}`. Writes 6 rows for that
//                                     date (or the most recent prior
//                                     business day if the request lands
//                                     on a weekend / holiday — see the
//                                     elaborated task spec).
//   - `fromDate, toDate`           → `/v1/{from}..{to}`. Writes 6 × N
//                                     rows where N is the number of
//                                     business-day publications in the
//                                     range.
//
// Idempotency: relies on the `fx_rate` PK
// `(rate_date, base_currency, quote_currency)`. Re-runs upsert. The
// production `FxRateRepo` implementation issues a Drizzle
// `onConflictDoUpdate` clause; tests use the `InMemoryFxRateRepo` in
// this file.
//
// Reporting: returns an `FxRatesReport` describing what happened. The
// CLI prints it as JSON; cron alerting consumes it directly.

import {
  FRANKFURTER_SOURCE,
  FrankfurterClient,
  type FrankfurterRangeResponse,
  type FrankfurterRatesResponse,
} from '../adapters/fx/index.js';
import { BINDERLY_FX_BASE_CURRENCY, BINDERLY_FX_QUOTE_CURRENCIES } from '../adapters/fx/types.js';
import { NotFoundError, type AdapterContext, type AdapterLogger } from '../interfaces/adapter.js';

/**
 * Mirrors `NewFxRate` from `@binderly/db` (`fx_rate` insert type), but
 * defined here so this module doesn't introduce a hard dependency on
 * `@binderly/db` at the type level either. The CLI bridges the two
 * shapes — they're identical at the column-name level.
 */
export interface FxRateRow {
  /** ISO-8601 calendar date `YYYY-MM-DD`. */
  rateDate: string;
  /** Always `'USD'` for v1. */
  baseCurrency: string;
  /** Quote currency (e.g. `'EUR'`). */
  quoteCurrency: string;
  /** 1 base = N quote, stored to 6 decimal places (numeric(14,6)). */
  rate: string;
  fetchedAt: Date;
  /** Provenance — `'frankfurter'` for everything this job writes. */
  source: string;
}

/**
 * Thin abstraction the runner depends on for persistence. Tests inject
 * `InMemoryFxRateRepo`; production wires a Drizzle-backed
 * implementation in `scripts/fx-rates.ts`.
 */
export interface FxRateRepo {
  /**
   * Upsert all rows in a single batch. Returns the number of rows
   * written (Postgres reports it; for the in-memory shim it's
   * `rows.length`). Implementations must use the canonical PK
   * `(rate_date, base_currency, quote_currency)` for ON CONFLICT.
   */
  upsertMany(rows: ReadonlyArray<FxRateRow>): Promise<number>;
}

/**
 * One-error-per-failed-currency-day. Errors are non-fatal: the runner
 * collects them and reports at the end. Fatal errors (network outage,
 * malformed schema, etc.) bubble out of `runFxRatesIngest` directly.
 */
export interface FxRatesError {
  /** ISO date the error pertains to (`'unknown'` if pre-fetch). */
  rateDate: string;
  /** Quote currency the error pertains to (`'*'` if whole-day). */
  quoteCurrency: string;
  message: string;
}

/**
 * End-of-run report. Always emitted, even on partial failure.
 */
export interface FxRatesReport {
  source: string;
  /**
   * What the caller asked for. `kind` discriminates which optional
   * fields are populated.
   */
  rangeRequested:
    | { kind: 'latest' }
    | { kind: 'single'; date: string }
    | { kind: 'range'; fromDate: string; toDate: string };
  /** Sorted list of dates Frankfurter returned data for. */
  datesFetched: ReadonlyArray<string>;
  /** Total rate observations parsed from upstream. */
  ratesFetched: number;
  /** Total rows the repo confirmed it wrote. */
  ratesUpserted: number;
  /** Wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** Per-currency-day failures; empty array on full success. */
  errors: ReadonlyArray<FxRatesError>;
}

export interface RunFxRatesIngestOptions {
  /** Fetch `/v1/latest`. Mutually exclusive with `date` and `fromDate`/`toDate`. */
  latest?: boolean;
  /** Fetch `/v1/{date}`. */
  date?: string;
  /** Fetch `/v1/{fromDate}..{toDate}` (inclusive). */
  fromDate?: string;
  /** End of the range (inclusive). */
  toDate?: string;
  /** Frankfurter client; injected by the CLI / tests. */
  client: FrankfurterClient;
  /** Persistence layer; injected by the CLI / tests. */
  repo: FxRateRepo;
  /** Optional logger; defaults to a noop. */
  logger?: AdapterLogger;
  /** Optional clock override for tests (defaults to `() => new Date()`). */
  now?: () => Date;
  /**
   * Optional override of the symbols list. Defaults to
   * `BINDERLY_FX_QUOTE_CURRENCIES`. Tests use this to exercise
   * partial-failure paths.
   */
  symbols?: ReadonlyArray<string>;
}

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/**
 * Run the FX-rate ingest. See module header for mode semantics.
 */
export async function runFxRatesIngest(opts: RunFxRatesIngestOptions): Promise<FxRatesReport> {
  const startedAt = Date.now();
  const logger = opts.logger ?? NOOP_LOGGER;
  const now = opts.now ?? (() => new Date());
  const symbols = opts.symbols ?? BINDERLY_FX_QUOTE_CURRENCIES;

  const mode = pickMode(opts);
  logger.info({ source: FRANKFURTER_SOURCE, mode }, 'fx-rates.start');

  const errors: FxRatesError[] = [];
  const collectedRows: FxRateRow[] = [];
  const datesFetched = new Set<string>();
  let ratesFetched = 0;

  try {
    if (mode.kind === 'latest' || mode.kind === 'single') {
      const response =
        mode.kind === 'latest'
          ? await opts.client.getLatest({ symbols: [...symbols] })
          : await opts.client.getHistorical(mode.date, { symbols: [...symbols] });
      const built = buildRowsFromRates(response, now(), symbols, errors);
      ratesFetched += built.ratesFetched;
      collectedRows.push(...built.rows);
      if (built.rows.length > 0) datesFetched.add(response.date);
    } else {
      let response: FrankfurterRangeResponse;
      try {
        response = await opts.client.getRange(mode.fromDate, mode.toDate, {
          symbols: [...symbols],
        });
      } catch (err) {
        if (err instanceof NotFoundError) {
          // Range entirely outside Frankfurter's coverage. Surface as
          // a non-fatal error rather than throwing — re-running on a
          // narrower window is the right escalation.
          errors.push({
            rateDate: `${mode.fromDate}..${mode.toDate}`,
            quoteCurrency: '*',
            message: `frankfurter: 404 for range ${mode.fromDate}..${mode.toDate}`,
          });
          response = {
            amount: 1,
            base: BINDERLY_FX_BASE_CURRENCY,
            start_date: mode.fromDate,
            end_date: mode.toDate,
            rates: {},
          };
        } else {
          throw err;
        }
      }
      const fetchedAt = now();
      for (const [date, rateMap] of Object.entries(response.rates)) {
        const synthetic: FrankfurterRatesResponse = {
          amount: response.amount,
          base: response.base,
          date,
          rates: rateMap,
        };
        const built = buildRowsFromRates(synthetic, fetchedAt, symbols, errors);
        ratesFetched += built.ratesFetched;
        collectedRows.push(...built.rows);
        if (built.rows.length > 0) datesFetched.add(date);
      }
    }
  } catch (err) {
    // Fatal. Log and rethrow so the CLI exits non-zero.
    logger.error({ source: FRANKFURTER_SOURCE, err: errToObj(err) }, 'fx-rates.fetch_failed');
    throw err;
  }

  let ratesUpserted = 0;
  if (collectedRows.length > 0) {
    ratesUpserted = await opts.repo.upsertMany(collectedRows);
  }

  const durationMs = Date.now() - startedAt;
  const report: FxRatesReport = {
    source: FRANKFURTER_SOURCE,
    rangeRequested: mode,
    datesFetched: [...datesFetched].sort(),
    ratesFetched,
    ratesUpserted,
    durationMs,
    errors,
  };
  logger.info(
    {
      source: FRANKFURTER_SOURCE,
      datesFetched: report.datesFetched,
      ratesFetched,
      ratesUpserted,
      errorCount: errors.length,
      durationMs,
    },
    'fx-rates.done',
  );
  return report;
}

interface BuildResult {
  rows: FxRateRow[];
  ratesFetched: number;
}

function buildRowsFromRates(
  response: FrankfurterRatesResponse,
  fetchedAt: Date,
  symbols: ReadonlyArray<string>,
  errors: FxRatesError[],
): BuildResult {
  const rows: FxRateRow[] = [];
  let ratesFetched = 0;
  for (const symbol of symbols) {
    const value = response.rates[symbol];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push({
        rateDate: response.date,
        quoteCurrency: symbol,
        message: `frankfurter: missing or invalid rate for ${symbol} on ${response.date}`,
      });
      continue;
    }
    ratesFetched += 1;
    rows.push({
      rateDate: response.date,
      baseCurrency: response.base,
      quoteCurrency: symbol,
      rate: formatRate(value),
      fetchedAt,
      source: FRANKFURTER_SOURCE,
    });
  }
  return { rows, ratesFetched };
}

/**
 * Format a numeric rate as a `numeric(14,6)`-friendly string. Drizzle
 * accepts numeric columns as either string or number, but strings
 * round-trip without floating-point quirks (avoids 0.85455 →
 * 0.8545500000001 surprises). Trailing-zero padding to 6 decimals
 * keeps the table tidy on `\d+`.
 */
function formatRate(value: number): string {
  return value.toFixed(6);
}

type Mode = FxRatesReport['rangeRequested'];

function pickMode(opts: RunFxRatesIngestOptions): Mode {
  const set: string[] = [];
  if (opts.latest === true) set.push('latest');
  if (opts.date) set.push('date');
  if (opts.fromDate || opts.toDate) set.push('range');
  if (set.length === 0) {
    throw new Error('runFxRatesIngest: exactly one of {latest, date, fromDate+toDate} is required');
  }
  if (set.length > 1) {
    throw new Error(`runFxRatesIngest: modes are mutually exclusive (got: ${set.join(', ')})`);
  }
  if (opts.latest === true) return { kind: 'latest' };
  if (opts.date) return { kind: 'single', date: opts.date };
  if (!opts.fromDate || !opts.toDate) {
    throw new Error('runFxRatesIngest: range mode requires both fromDate and toDate');
  }
  return { kind: 'range', fromDate: opts.fromDate, toDate: opts.toDate };
}

function errToObj(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}

// ============================================================
// Test helper — exported so the CLI never imports it but tests can.
// ============================================================

/**
 * In-memory `FxRateRepo`. Keys on the canonical PK
 * `(rate_date, base_currency, quote_currency)`. Calling `upsertMany`
 * twice with the same key replaces the row in place — same posture
 * as the SQL `ON CONFLICT … DO UPDATE`.
 *
 * Useful for unit-testing job-level callers without spinning up
 * Postgres. Not exported from `@binderly/data-pipeline`'s public
 * barrel — it's a test utility — but lives here (rather than a
 * test-only module) so other adapter / job tests can reuse it.
 */
export class InMemoryFxRateRepo implements FxRateRepo {
  /** PK string → row. */
  readonly rows = new Map<string, FxRateRow>();

  async upsertMany(rows: ReadonlyArray<FxRateRow>): Promise<number> {
    for (const row of rows) {
      const key = `${row.rateDate}|${row.baseCurrency}|${row.quoteCurrency}`;
      this.rows.set(key, { ...row });
    }
    return rows.length;
  }

  size(): number {
    return this.rows.size;
  }

  list(): FxRateRow[] {
    return [...this.rows.values()].sort((a, b) => {
      if (a.rateDate !== b.rateDate) return a.rateDate.localeCompare(b.rateDate);
      return a.quoteCurrency.localeCompare(b.quoteCurrency);
    });
  }
}

/** Re-export for downstream context wiring. */
export type { AdapterContext };
