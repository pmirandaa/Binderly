// Unit tests for `runPricingRollup`.
//
// Strategy mirrors `fx-rates.test.ts` and `pricing-ebay-browse.test.ts`:
//   * Drive the runner end-to-end against in-memory fakes (the
//     reader + repo shims shipped from the same module).
//   * Assert per-stage outcomes via the `PricingRollupReport` and
//     the repo's row state.
//   * No HTTP, no Postgres, no real time.

import { describe, expect, it } from 'vitest';

import {
  aggregateBucket,
  enumerateBackwardWindow,
  InMemoryPriceAggregateRepo,
  InMemoryPriceObservationReader,
  runPricingRollup,
  type PriceAggregateRepo,
  type PriceAggregateRow,
  type PriceObservationReader,
  type RollupObservation,
} from './pricing-rollup.js';

// ============================================================
// Fixture helpers
// ============================================================

const PR_A = '00000000-0000-4000-8000-000000000001';
const PR_B = '00000000-0000-4000-8000-000000000002';
const FIXED_NOW = new Date('2026-05-04T12:00:00.000Z');

interface ObsOver {
  printingId?: string;
  gradeTier?: string;
  market?: string;
  source?: string;
  observationKind?: string;
  observedPrice?: string;
  observedCurrency?: string;
  parseConfidence?: string | null;
  observedDate?: string;
}

function obs(over: ObsOver = {}): RollupObservation {
  return {
    printingId: over.printingId ?? PR_A,
    gradeTier: over.gradeTier ?? 'PSA_10',
    market: over.market ?? 'EBAY_US',
    source: over.source ?? 'ebay_browse',
    observationKind: over.observationKind ?? 'active_listing',
    observedPrice: over.observedPrice ?? '100.00',
    observedCurrency: over.observedCurrency ?? 'USD',
    parseConfidence: over.parseConfidence === undefined ? '0.86' : over.parseConfidence,
    observedDate: over.observedDate ?? '2026-05-03',
  };
}

// ============================================================
// `runPricingRollup` — argument validation
// ============================================================

describe('runPricingRollup — argument validation', () => {
  const repo = new InMemoryPriceAggregateRepo();
  const reader = new InMemoryPriceObservationReader([]);

  it('rejects missing reader', async () => {
    await expect(
      runPricingRollup({
        reader: undefined as unknown as PriceObservationReader,
        repo,
        date: '2026-05-03',
      }),
    ).rejects.toThrow(/reader/u);
  });

  it('rejects missing repo', async () => {
    await expect(
      runPricingRollup({
        reader,
        repo: undefined as unknown as PriceAggregateRepo,
        date: '2026-05-03',
      }),
    ).rejects.toThrow(/repo/u);
  });

  it('rejects non-ISO date', async () => {
    await expect(runPricingRollup({ reader, repo, date: '05/03/2026' })).rejects.toThrow(
      /YYYY-MM-DD/u,
    );
  });

  it('rejects days < 1', async () => {
    await expect(runPricingRollup({ reader, repo, date: '2026-05-03', days: 0 })).rejects.toThrow(
      /positive integer/u,
    );
  });

  it('rejects non-integer days', async () => {
    await expect(runPricingRollup({ reader, repo, date: '2026-05-03', days: 1.5 })).rejects.toThrow(
      /positive integer/u,
    );
  });
});

// ============================================================
// Confidence filter
// ============================================================

describe('runPricingRollup — confidence filter', () => {
  it('excludes parseConfidence < 0.70 (fed by the reader)', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedPrice: '100.00', parseConfidence: '0.86' }),
      obs({ observedPrice: '999.00', parseConfidence: '0.50' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(report.observationsRead).toBe(1);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]?.lowPrice).toBe('100.00');
    expect(repo.list()[0]?.highPrice).toBe('100.00');
  });

  it('includes NULL parseConfidence rows', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedPrice: '100.00', parseConfidence: null }),
      obs({ observedPrice: '120.00', parseConfidence: null }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(repo.list()[0]?.sampleCount).toBe(2);
    expect(repo.list()[0]?.meanPrice).toBe('110.00');
  });

  it('includes the 0.70 boundary (inclusive)', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedPrice: '100.00', parseConfidence: '0.70' }),
      obs({ observedPrice: '300.00', parseConfidence: '0.69' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(repo.list()[0]?.sampleCount).toBe(1);
    expect(repo.list()[0]?.meanPrice).toBe('100.00');
  });
});

// ============================================================
// Group-key correctness
// ============================================================

describe('runPricingRollup — group key', () => {
  it('different grades on the same printing → 2 rows', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ gradeTier: 'PSA_10', observedPrice: '500.00' }),
      obs({ gradeTier: 'PSA_9', observedPrice: '200.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const rows = repo.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.gradeTier).sort()).toEqual(['PSA_10', 'PSA_9']);
  });

  it('different markets on the same printing → 2 rows', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ market: 'EBAY_US', observedPrice: '500.00' }),
      obs({ market: 'CARDMARKET_EU', observedPrice: '480.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(
      repo
        .list()
        .map((r) => r.market)
        .sort(),
    ).toEqual(['CARDMARKET_EU', 'EBAY_US']);
  });

  it('different currencies on the same (printing, grade, market) → 2 rows', async () => {
    // The rare cross-currency listing scenario the schema docstring
    // calls out. Currency is part of the PK to keep this case
    // information-lossless.
    const reader = new InMemoryPriceObservationReader([
      obs({ market: 'CARDMARKET_EU', observedCurrency: 'EUR', observedPrice: '480.00' }),
      obs({ market: 'CARDMARKET_EU', observedCurrency: 'GBP', observedPrice: '410.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(
      repo
        .list()
        .map((r) => r.currency)
        .sort(),
    ).toEqual(['EUR', 'GBP']);
  });
});

// ============================================================
// Statistics correctness
// ============================================================

describe('runPricingRollup — statistics', () => {
  it('odd-n bucket: median = mid value, low/high/mean correct', async () => {
    const reader = new InMemoryPriceObservationReader(
      ['10.00', '20.00', '30.00', '40.00', '50.00'].map((p) => obs({ observedPrice: p })),
    );
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const row = repo.list()[0]!;
    expect(row.lowPrice).toBe('10.00');
    expect(row.highPrice).toBe('50.00');
    expect(row.meanPrice).toBe('30.00');
    expect(row.medianPrice).toBe('30.00');
    expect(row.sampleCount).toBe(5);
  });

  it('even-n bucket: median = mean of two mid values', async () => {
    const reader = new InMemoryPriceObservationReader(
      ['10.00', '20.00', '30.00', '40.00'].map((p) => obs({ observedPrice: p })),
    );
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const row = repo.list()[0]!;
    expect(row.medianPrice).toBe('25.00');
    expect(row.meanPrice).toBe('25.00');
  });

  it('emits computed_at from the injected clock', async () => {
    const reader = new InMemoryPriceObservationReader([obs({})]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(repo.list()[0]?.computedAt.toISOString()).toBe('2026-05-04T12:00:00.000Z');
  });
});

// ============================================================
// Outlier filter
// ============================================================

describe('runPricingRollup — outlier filter', () => {
  it('n=19: keeps every observation (gate is sample_count >= 20)', async () => {
    const prices = Array.from({ length: 19 }, (_, i) =>
      obs({ observedPrice: `${(i + 1) * 10}.00` }),
    );
    const reader = new InMemoryPriceObservationReader(prices);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(repo.list()[0]?.sampleCount).toBe(19);
    expect(report.observationsDroppedAsOutliers).toBe(0);
  });

  it('n=20: drops 1 from each end (top/bottom 5%)', async () => {
    // Prices 10, 20, ... 200. After trimming 1/1 → retained
    // [20..190], n=18, low=20, high=190.
    const prices = Array.from({ length: 20 }, (_, i) =>
      obs({ observedPrice: `${(i + 1) * 10}.00` }),
    );
    const reader = new InMemoryPriceObservationReader(prices);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const row = repo.list()[0]!;
    expect(row.sampleCount).toBe(18);
    expect(row.lowPrice).toBe('20.00');
    expect(row.highPrice).toBe('190.00');
    expect(report.observationsDroppedAsOutliers).toBe(2);
  });

  it('n=100: drops 5 from each end → 90 retained', async () => {
    const prices = Array.from({ length: 100 }, (_, i) =>
      obs({ observedPrice: `${(i + 1) * 1}.00` }),
    );
    const reader = new InMemoryPriceObservationReader(prices);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const row = repo.list()[0]!;
    expect(row.sampleCount).toBe(90);
    expect(row.lowPrice).toBe('6.00');
    expect(row.highPrice).toBe('95.00');
    expect(report.observationsDroppedAsOutliers).toBe(10);
  });
});

// ============================================================
// Breakdowns
// ============================================================

describe('runPricingRollup — source/kind breakdowns', () => {
  it('breakdown maps sum to sample_count', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ source: 'ebay_browse', observationKind: 'active_listing', observedPrice: '100.00' }),
      obs({ source: 'ebay_browse', observationKind: 'active_listing', observedPrice: '110.00' }),
      obs({ source: 'aggregator_mock', observationKind: 'sold', observedPrice: '120.00' }),
      obs({
        source: 'aggregator_mock',
        observationKind: 'aggregator_quote',
        observedPrice: '130.00',
      }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const row = repo.list()[0]!;
    expect(row.sampleCount).toBe(4);
    expect(row.sourceBreakdown).toEqual({ ebay_browse: 2, aggregator_mock: 2 });
    expect(row.observationKindBreakdown).toEqual({
      active_listing: 2,
      sold: 1,
      aggregator_quote: 1,
    });
    const sumSrc = Object.values(row.sourceBreakdown).reduce((a, b) => a + b, 0);
    const sumKind = Object.values(row.observationKindBreakdown).reduce((a, b) => a + b, 0);
    expect(sumSrc).toBe(row.sampleCount);
    expect(sumKind).toBe(row.sampleCount);
  });
});

// ============================================================
// Idempotency
// ============================================================

describe('runPricingRollup — idempotency', () => {
  it('re-running the same day overwrites in place; row count steady', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedPrice: '100.00' }),
      obs({ observedPrice: '120.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({ reader, repo, date: '2026-05-03', now: () => FIXED_NOW });
    expect(repo.size()).toBe(1);
    await runPricingRollup({ reader, repo, date: '2026-05-03', now: () => FIXED_NOW });
    expect(repo.size()).toBe(1);
    expect(repo.list()[0]?.meanPrice).toBe('110.00');
  });
});

// ============================================================
// Multi-day backfill
// ============================================================

describe('runPricingRollup — multi-day', () => {
  it('--days 3 produces 3 per-day rollups in ascending order', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedDate: '2026-05-01', observedPrice: '100.00' }),
      obs({ observedDate: '2026-05-02', observedPrice: '200.00' }),
      obs({ observedDate: '2026-05-03', observedPrice: '300.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      days: 3,
      now: () => FIXED_NOW,
    });
    expect(report.datesProcessed).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    const rows = repo.list();
    expect(rows.map((r) => r.periodStart)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    expect(rows.map((r) => r.meanPrice)).toEqual(['100.00', '200.00', '300.00']);
  });

  it('captures per-day failure and continues to remaining days', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedDate: '2026-05-01', observedPrice: '100.00' }),
      obs({ observedDate: '2026-05-02', observedPrice: '200.00' }),
      obs({ observedDate: '2026-05-03', observedPrice: '300.00' }),
    ]);
    let calls = 0;
    const repo: PriceAggregateRepo = {
      async upsertMany(rows) {
        calls += 1;
        if (calls === 2) throw new Error('synthetic day-2 failure');
        return rows.length;
      },
    };
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      days: 3,
      now: () => FIXED_NOW,
    });
    expect(report.datesProcessed).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toEqual({
      date: '2026-05-02',
      kind: 'rollup_day_failed',
      message: 'synthetic day-2 failure',
    });
    expect(report.aggregatesUpserted).toBe(2); // days 1 + 3 succeeded
  });
});

// ============================================================
// Filters
// ============================================================

describe('runPricingRollup — filters', () => {
  it('printingId restricts the stream', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ printingId: PR_A, observedPrice: '100.00' }),
      obs({ printingId: PR_B, observedPrice: '500.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      printingId: PR_A,
      now: () => FIXED_NOW,
    });
    expect(report.observationsRead).toBe(1);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]?.printingId).toBe(PR_A);
  });

  it('dryRun: no upserts, but report reflects what would have been written', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedPrice: '100.00' }),
      obs({ observedPrice: '110.00' }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      dryRun: true,
      now: () => FIXED_NOW,
    });
    expect(report.aggregatesProduced).toBe(1);
    expect(report.aggregatesUpserted).toBe(0);
    expect(repo.size()).toBe(0);
    expect(report.rangeRequested.dryRun).toBe(true);
  });
});

// ============================================================
// Empty days
// ============================================================

describe('runPricingRollup — empty days', () => {
  it('zero rows in → zero rows out, no error', async () => {
    const reader = new InMemoryPriceObservationReader([]);
    const repo = new InMemoryPriceAggregateRepo();
    const report = await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    expect(report.observationsRead).toBe(0);
    expect(report.aggregatesProduced).toBe(0);
    expect(report.aggregatesUpserted).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(repo.size()).toBe(0);
  });
});

// ============================================================
// Pure helpers
// ============================================================

describe('aggregateBucket — pure helper', () => {
  it('returns null on an empty list', () => {
    expect(aggregateBucket([], FIXED_NOW)).toBeNull();
  });
});

describe('enumerateBackwardWindow', () => {
  it('days=1 → [date]', () => {
    expect(enumerateBackwardWindow('2026-05-03', 1)).toEqual(['2026-05-03']);
  });

  it('days=3 → [date-2 .. date]', () => {
    expect(enumerateBackwardWindow('2026-05-03', 3)).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ]);
  });

  it('handles UTC month boundary (no off-by-one for May 1)', () => {
    expect(enumerateBackwardWindow('2026-05-01', 3)).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
    ]);
  });
});

// ============================================================
// Aggregate row shape (defensive sanity)
// ============================================================

describe('runPricingRollup — emitted row shape', () => {
  it('emits all PriceAggregateRow columns with sensible types', async () => {
    const reader = new InMemoryPriceObservationReader([
      obs({ observedPrice: '100.00', source: 'ebay_browse', observationKind: 'active_listing' }),
      obs({
        observedPrice: '200.00',
        source: 'aggregator_mock',
        observationKind: 'aggregator_quote',
      }),
    ]);
    const repo = new InMemoryPriceAggregateRepo();
    await runPricingRollup({
      reader,
      repo,
      date: '2026-05-03',
      now: () => FIXED_NOW,
    });
    const row = repo.list()[0] as PriceAggregateRow;
    expect(typeof row.printingId).toBe('string');
    expect(typeof row.gradeTier).toBe('string');
    expect(typeof row.market).toBe('string');
    expect(typeof row.currency).toBe('string');
    expect(row.periodStart).toBe('2026-05-03');
    expect(row.periodEnd).toBe('2026-05-03');
    expect(typeof row.medianPrice).toBe('string');
    expect(typeof row.meanPrice).toBe('string');
    expect(typeof row.lowPrice).toBe('string');
    expect(typeof row.highPrice).toBe('string');
    expect(row.sampleCount).toBe(2);
    expect(row.sourceBreakdown).toEqual({ ebay_browse: 1, aggregator_mock: 1 });
    expect(row.observationKindBreakdown).toEqual({
      active_listing: 1,
      aggregator_quote: 1,
    });
    expect(row.computedAt).toBeInstanceOf(Date);
  });
});
