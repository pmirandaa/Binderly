// `runPricingCurrentViewRefresh` — refresh the `mv_current_price`
// materialized view (T-DL-PRICING-CURRENT-VIEW).
//
// `mv_current_price` (defined in
// `packages/db/src/migrations/0013_mv_current_price.sql`) caches the
// LATEST `price_aggregate` row per
// `(printing_id, grade_tier, market, currency)` so the future
// card-detail UI (T-SP-PRICING-DISPLAY) reads a single row per
// (card / grade / market) instead of doing `DISTINCT ON` over
// `price_aggregate` on every page render.
//
// The runner does ONE thing: refresh the view. Cadence (nightly,
// after `pricing-rollup` so the view sees the freshest aggregates) is
// the operator's concern — wired via cron / Edge Functions outside
// this module.
//
// Two refresh forms exist:
//
//   - First-ever refresh after the migration (the view is created
//     `WITH NO DATA` so the migration is fast): plain
//     `REFRESH MATERIALIZED VIEW mv_current_price;`. This blocks
//     reads while it runs, but the view has no readers yet.
//   - Subsequent refreshes:
//     `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_current_price;`.
//     Requires the unique index that the migration creates;
//     never blocks readers. Documented in the PG docs as the
//     production-friendly form.
//
// The runner asks the injected `MaterializedViewRefresher` whether
// the view is populated yet and picks the right form. Tests pin
// both branches via the in-memory shim shipped in this module.
//
// Reporting: returns a `PricingCurrentViewReport`. The CLI prints it
// as JSON; cron / observability consume it directly. Same shape as
// `FxRatesReport` / `PricingRollupReport` — `durationMs`, the
// inputs the caller supplied, and `sqlExecuted` so callers can audit
// what ran (especially under `--dry-run`).

import { type AdapterLogger } from '../interfaces/adapter.js';

// ============================================================
// Public types
// ============================================================

/**
 * The persistence boundary the runner depends on. Tests inject
 * `InMemoryMaterializedViewRefresher`; production wires a
 * postgres-js-backed implementation in
 * `scripts/pricing-current-view.ts` (raw SQL via the
 * `createDbClient(...).$client` handle — Drizzle does not model
 * materialized views as `pgTable`s).
 *
 * Implementations MUST:
 *
 *   - Report `isPopulated: false` when the materialized view has
 *     never been populated (we detect this via `pg_class.relpages`
 *     in production; the in-memory shim flips it on the first
 *     successful refresh).
 *   - Issue `REFRESH MATERIALIZED VIEW [CONCURRENTLY] "mv_current_price"`
 *     based on the `concurrently` arg the runner passes, which is
 *     `true` iff `isPopulated()` returned `true` at the start of
 *     the run.
 *   - Surface the SQL string that was actually executed via the
 *     resolved value's `sql` field, so the runner can echo it in
 *     the report.
 */
export interface MaterializedViewRefresher {
  /**
   * Whether the materialized view has been populated at least once.
   * Drives the `CONCURRENTLY` decision — `REFRESH … CONCURRENTLY`
   * fails on a never-populated view (per PG docs).
   */
  isPopulated(): Promise<boolean>;
  /**
   * Issue the refresh. Returns the SQL text that was executed so the
   * runner can include it in the report (especially for the
   * dry-run path where `refresh` itself is never called and the
   * runner needs to compose the would-have-run SQL itself —
   * implementations may keep this method narrow).
   */
  refresh(opts: { readonly concurrently: boolean }): Promise<{ readonly sql: string }>;
}

/**
 * Inputs the runner accepts.
 */
export interface RunPricingCurrentViewRefreshOptions {
  readonly refresher: MaterializedViewRefresher;
  /** When `true`, skip `refresher.refresh(...)`. Default false. */
  readonly dryRun?: boolean;
  readonly logger?: AdapterLogger;
  /**
   * Optional clock override (defaults to `() => Date.now()`).
   * Tests pin this to assert `durationMs` round-trips
   * deterministically.
   */
  readonly now?: () => number;
}

/**
 * End-of-run report. Always emitted on success; on a thrown error
 * the runner does NOT swallow — the caller (CLI) catches and logs.
 */
export interface PricingCurrentViewReport {
  /** Echo of the inputs the caller supplied. */
  readonly rangeRequested: {
    readonly dryRun: boolean;
  };
  /**
   * `true` iff the runner detected the view had never been
   * populated and issued the non-`CONCURRENTLY` form. Always
   * `false` on dry-run because the runner can't know without
   * asking the refresher.
   *
   * Note: we DO call `refresher.isPopulated()` even on dry-run, so
   * this field is populated whenever the refresher implements
   * that method — only `false` here means "not populated yet, would
   * have done the initial refresh" rather than "skipped the call".
   */
  readonly initialPopulation: boolean;
  /**
   * The exact SQL the runner issued (or would have issued, on
   * dry-run). Length 0 on dry-run with `dryRun === true`; length 1
   * on a live refresh.
   */
  readonly sqlExecuted: ReadonlyArray<string>;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
}

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const SOURCE = 'pricing-current-view';

/** The view name lives in exactly one place to avoid drift with the migration. */
export const MV_CURRENT_PRICE = 'mv_current_price';

// ============================================================
// SQL composition
// ============================================================

/**
 * Compose the refresh statement for `mv_current_price`. Exported so
 * tests + dry-run can preview without invoking a refresher.
 *
 * Uses double-quoted identifier for parity with the migration DDL
 * and the rest of `packages/db/src/migrations/*`.
 */
export function composeRefreshSql(opts: { readonly concurrently: boolean }): string {
  const concurrently = opts.concurrently ? 'CONCURRENTLY ' : '';
  return `REFRESH MATERIALIZED VIEW ${concurrently}"${MV_CURRENT_PRICE}";`;
}

// ============================================================
// Public entry
// ============================================================

export async function runPricingCurrentViewRefresh(
  opts: RunPricingCurrentViewRefreshOptions,
): Promise<PricingCurrentViewReport> {
  if (!opts.refresher) {
    throw new Error('runPricingCurrentViewRefresh: `refresher` is required');
  }

  const logger = opts.logger ?? NOOP_LOGGER;
  const now = opts.now ?? (() => Date.now());
  const dryRun = opts.dryRun === true;

  const startedAt = now();

  logger.info({ source: SOURCE, dryRun }, 'pricing-current-view.start');

  const isPopulated = await opts.refresher.isPopulated();
  const concurrently = isPopulated;
  const initialPopulation = !isPopulated;

  const sqlExecuted: string[] = [];

  if (dryRun) {
    // Echo the SQL that WOULD have run. Useful for ops review and
    // for the CLI's `--dry-run` smoke. The refresher is never
    // invoked, so its potential side effects are skipped.
    sqlExecuted.push(composeRefreshSql({ concurrently }));
    logger.info(
      { source: SOURCE, dryRun: true, initialPopulation, sql: sqlExecuted },
      'pricing-current-view.dry_run',
    );
  } else {
    const result = await opts.refresher.refresh({ concurrently });
    sqlExecuted.push(result.sql);
    logger.info(
      { source: SOURCE, initialPopulation, sql: result.sql },
      'pricing-current-view.refreshed',
    );
  }

  const durationMs = now() - startedAt;
  const report: PricingCurrentViewReport = {
    rangeRequested: { dryRun },
    initialPopulation,
    sqlExecuted,
    durationMs,
  };

  logger.info(
    {
      source: SOURCE,
      dryRun,
      initialPopulation,
      durationMs,
    },
    'pricing-current-view.done',
  );

  return report;
}

// ============================================================
// Test helpers — exported so the CLI never imports them but tests can.
// ============================================================

/**
 * In-memory `MaterializedViewRefresher`. Keeps an internal
 * `populated` flag that flips to `true` on the first successful
 * `.refresh(...)` call, mirroring the real PG behavior where the
 * first refresh populates the view.
 *
 * `refreshCalls` records `{ concurrently, sql }` for every refresh
 * the runner issued so tests can assert the right form was used.
 *
 * Optional `failNextRefresh` simulates a refresh failure (Postgres
 * error, lock timeout, etc.) to verify the runner does NOT swallow
 * the error.
 */
export class InMemoryMaterializedViewRefresher implements MaterializedViewRefresher {
  private populated: boolean;
  private failureToInject: Error | null = null;
  readonly refreshCalls: Array<{
    readonly concurrently: boolean;
    readonly sql: string;
  }> = [];

  constructor(initial: { readonly populated?: boolean } = {}) {
    this.populated = initial.populated === true;
  }

  /** Force the next `.refresh(...)` call to throw. Cleared after one use. */
  failNextRefresh(err: Error): void {
    this.failureToInject = err;
  }

  /** Force-set the `populated` flag (test-only seam). */
  setPopulated(populated: boolean): void {
    this.populated = populated;
  }

  /** Read-only accessor for assertions. */
  get isPopulatedNow(): boolean {
    return this.populated;
  }

  async isPopulated(): Promise<boolean> {
    return this.populated;
  }

  async refresh(opts: { readonly concurrently: boolean }): Promise<{ readonly sql: string }> {
    if (this.failureToInject) {
      const err = this.failureToInject;
      this.failureToInject = null;
      throw err;
    }
    const sql = composeRefreshSql({ concurrently: opts.concurrently });
    this.refreshCalls.push({ concurrently: opts.concurrently, sql });
    this.populated = true;
    return { sql };
  }
}
