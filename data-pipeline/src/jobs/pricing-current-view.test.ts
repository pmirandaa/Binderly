// Unit tests for `runPricingCurrentViewRefresh`.
//
// Strategy mirrors `pricing-rollup.test.ts` and `fx-rates.test.ts`:
//   * Drive the runner end-to-end against the in-memory shim shipped
//     from the same module.
//   * Assert per-stage outcomes via the `PricingCurrentViewReport`
//     and the shim's `refreshCalls` log.
//   * No HTTP, no Postgres, no real time.

import { describe, expect, it } from 'vitest';

import {
  composeRefreshSql,
  InMemoryMaterializedViewRefresher,
  MV_CURRENT_PRICE,
  runPricingCurrentViewRefresh,
  type MaterializedViewRefresher,
  type PricingCurrentViewReport,
} from './pricing-current-view.js';

// ============================================================
// `composeRefreshSql` — pure helper
// ============================================================

describe('composeRefreshSql', () => {
  it('composes the non-concurrent form for the initial refresh', () => {
    expect(composeRefreshSql({ concurrently: false })).toBe(
      `REFRESH MATERIALIZED VIEW "${MV_CURRENT_PRICE}";`,
    );
  });

  it('composes the concurrent form for steady-state refresh', () => {
    expect(composeRefreshSql({ concurrently: true })).toBe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY "${MV_CURRENT_PRICE}";`,
    );
  });

  it('uses the canonical view name from the migration', () => {
    expect(MV_CURRENT_PRICE).toBe('mv_current_price');
  });
});

// ============================================================
// Argument validation
// ============================================================

describe('runPricingCurrentViewRefresh — argument validation', () => {
  it('rejects missing refresher', async () => {
    await expect(
      runPricingCurrentViewRefresh({
        refresher: undefined as unknown as MaterializedViewRefresher,
      }),
    ).rejects.toThrow(/refresher/u);
  });
});

// ============================================================
// Initial population vs concurrent refresh
// ============================================================

describe('runPricingCurrentViewRefresh — initial population', () => {
  it('issues the non-concurrent form when the view has never been populated', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: false });
    const report = await runPricingCurrentViewRefresh({ refresher });
    expect(report.initialPopulation).toBe(true);
    expect(refresher.refreshCalls).toEqual([
      {
        concurrently: false,
        sql: `REFRESH MATERIALIZED VIEW "${MV_CURRENT_PRICE}";`,
      },
    ]);
    expect(report.sqlExecuted).toEqual([`REFRESH MATERIALIZED VIEW "${MV_CURRENT_PRICE}";`]);
  });

  it('flips `populated` to true after the first refresh', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: false });
    expect(refresher.isPopulatedNow).toBe(false);
    await runPricingCurrentViewRefresh({ refresher });
    expect(refresher.isPopulatedNow).toBe(true);
  });
});

describe('runPricingCurrentViewRefresh — concurrent (steady-state) refresh', () => {
  it('issues the CONCURRENTLY form when the view is already populated', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    const report = await runPricingCurrentViewRefresh({ refresher });
    expect(report.initialPopulation).toBe(false);
    expect(refresher.refreshCalls).toEqual([
      {
        concurrently: true,
        sql: `REFRESH MATERIALIZED VIEW CONCURRENTLY "${MV_CURRENT_PRICE}";`,
      },
    ]);
    expect(report.sqlExecuted).toEqual([
      `REFRESH MATERIALIZED VIEW CONCURRENTLY "${MV_CURRENT_PRICE}";`,
    ]);
  });

  it('idempotency: running twice in a row both succeed', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: false });
    await runPricingCurrentViewRefresh({ refresher });
    await runPricingCurrentViewRefresh({ refresher });
    expect(refresher.refreshCalls).toHaveLength(2);
    // First call was the initial population (non-concurrent); second
    // was the steady-state CONCURRENTLY refresh.
    expect(refresher.refreshCalls[0]?.concurrently).toBe(false);
    expect(refresher.refreshCalls[1]?.concurrently).toBe(true);
  });
});

// ============================================================
// Dry-run
// ============================================================

describe('runPricingCurrentViewRefresh — dry-run', () => {
  it('skips the refresh call but still echoes the would-have-run SQL', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    const report = await runPricingCurrentViewRefresh({ refresher, dryRun: true });
    expect(refresher.refreshCalls).toEqual([]);
    expect(report.rangeRequested.dryRun).toBe(true);
    expect(report.sqlExecuted).toEqual([
      `REFRESH MATERIALIZED VIEW CONCURRENTLY "${MV_CURRENT_PRICE}";`,
    ]);
    // Refresher's populated state did not change because we never
    // called .refresh().
    expect(refresher.isPopulatedNow).toBe(true);
  });

  it('dry-run on a never-populated view echoes the non-concurrent form', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: false });
    const report = await runPricingCurrentViewRefresh({ refresher, dryRun: true });
    expect(report.initialPopulation).toBe(true);
    expect(report.sqlExecuted).toEqual([`REFRESH MATERIALIZED VIEW "${MV_CURRENT_PRICE}";`]);
    // .isPopulated() was called (as it must be — to pick the form),
    // but .refresh() was not.
    expect(refresher.refreshCalls).toEqual([]);
    expect(refresher.isPopulatedNow).toBe(false);
  });
});

// ============================================================
// Failure propagation
// ============================================================

describe('runPricingCurrentViewRefresh — failure propagation', () => {
  it('propagates errors from .refresh() (no swallowing)', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    const synthetic = new Error('synthetic refresh failure');
    refresher.failNextRefresh(synthetic);
    await expect(runPricingCurrentViewRefresh({ refresher })).rejects.toThrow(
      'synthetic refresh failure',
    );
    // The shim still recorded zero successful refreshes.
    expect(refresher.refreshCalls).toEqual([]);
  });
});

// ============================================================
// Report shape + clock
// ============================================================

describe('runPricingCurrentViewRefresh — report shape', () => {
  it('emits a report with all fields populated', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    const report = await runPricingCurrentViewRefresh({ refresher });
    const checked: PricingCurrentViewReport = report;
    expect(typeof checked.durationMs).toBe('number');
    expect(checked.durationMs).toBeGreaterThanOrEqual(0);
    expect(checked.initialPopulation).toBe(false);
    expect(checked.rangeRequested.dryRun).toBe(false);
    expect(checked.sqlExecuted).toHaveLength(1);
  });

  it('uses the injected clock for durationMs', async () => {
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    const ticks = [1_000, 1_750];
    let i = 0;
    const now = (): number => {
      const t = ticks[i] ?? ticks[ticks.length - 1] ?? 0;
      i = Math.min(i + 1, ticks.length - 1);
      return t;
    };
    const report = await runPricingCurrentViewRefresh({ refresher, now });
    expect(report.durationMs).toBe(750);
  });
});

// ============================================================
// Logger usage
// ============================================================

describe('runPricingCurrentViewRefresh — logger', () => {
  it('emits start + done structured-log events', async () => {
    const events: Array<{ readonly level: string; readonly msg: string }> = [];
    const logger = {
      info: (_obj: unknown, msg?: string) => events.push({ level: 'info', msg: msg ?? '' }),
      warn: (_obj: unknown, msg?: string) => events.push({ level: 'warn', msg: msg ?? '' }),
      error: (_obj: unknown, msg?: string) => events.push({ level: 'error', msg: msg ?? '' }),
      debug: (_obj: unknown, msg?: string) => events.push({ level: 'debug', msg: msg ?? '' }),
    };
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    await runPricingCurrentViewRefresh({ refresher, logger });
    const messages = events.map((e) => e.msg);
    expect(messages).toContain('pricing-current-view.start');
    expect(messages).toContain('pricing-current-view.refreshed');
    expect(messages).toContain('pricing-current-view.done');
  });

  it('emits dry_run event under dryRun', async () => {
    const events: string[] = [];
    const logger = {
      info: (_obj: unknown, msg?: string) => events.push(msg ?? ''),
      warn: () => undefined,
      error: () => undefined,
    };
    const refresher = new InMemoryMaterializedViewRefresher({ populated: true });
    await runPricingCurrentViewRefresh({ refresher, dryRun: true, logger });
    expect(events).toContain('pricing-current-view.dry_run');
    expect(events).not.toContain('pricing-current-view.refreshed');
  });
});
