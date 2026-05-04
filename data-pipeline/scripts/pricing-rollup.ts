// scripts/pricing-rollup.ts — CLI entry for the daily price-observation
// rollup job (T-DL-PRICING-ROLLUP).
//
// Wires `runPricingRollup` to:
//   - a Drizzle-backed `PriceObservationReader` over
//     `price_observation` (with the canonical `observed_date = $date`
//     + `parse_confidence IS NULL OR parse_confidence >= 0.70`
//     filter), OR a synthetic in-memory reader when
//     `MOCK_PRICING_ROLLUP=1`.
//   - a Drizzle-backed `PriceAggregateRepo` over `price_aggregate`
//     issuing `ON CONFLICT (printing_id, grade_tier, market,
//     currency, period_start) DO UPDATE`, OR an in-memory repo
//     when `--dry-run` or `MOCK_PRICING_ROLLUP=1`.
//
// Modes (mutually exclusive — set via the env var):
//
//   pnpm --filter @binderly/data-pipeline pricing-rollup --date 2026-05-03
//   pnpm --filter @binderly/data-pipeline pricing-rollup --date 2026-05-03 --days 7
//   pnpm --filter @binderly/data-pipeline pricing-rollup --printing <UUID>
//   MOCK_PRICING_ROLLUP=1 pnpm --filter @binderly/data-pipeline pricing-rollup --dry-run
//
// On success: prints the `PricingRollupReport` as a single line of
// JSON to stdout and exits 0. On any unrecoverable error prints a
// diagnostic to stderr and exits 1. Same posture as
// `scripts/fx-rates.ts` and `scripts/pricing-ebay-browse.ts` — sets
// `process.exitCode` instead of calling `process.exit()`.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';
import pino from 'pino';

// `@binderly/db` ships a thin barrel via `dist/`. The deep-path
// import shape mirrors `scripts/fx-rates.ts` /
// `scripts/pricing-ebay-browse.ts`.
import { createDbClient } from '@binderly/db/src/client.js';
import {
  priceAggregateTable,
  type NewPriceAggregate,
} from '@binderly/db/src/schema/price_snapshots.js';
import { priceObservationTable } from '@binderly/db/src/schema/prices.js';

import {
  runPricingRollup,
  type PriceAggregateRepo,
  type PriceAggregateRow,
  type PriceObservationReader,
  type RollupObservation,
  type RunPricingRollupOptions,
} from '../src/jobs/pricing-rollup.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = path.basename(__filename);

// ============================================================
// Argument parsing
// ============================================================

interface ParsedArgs {
  date?: string;
  days: number;
  printingId?: string;
  url?: string;
  dryRun: boolean;
  help: boolean;
}

class CliError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = { days: 1, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--date': {
        const v = argv[++i];
        if (!v) throw new CliError('`--date` requires a value (YYYY-MM-DD)');
        if (!ISO_DATE.test(v)) {
          throw new CliError(`--date must be YYYY-MM-DD (got ${v})`);
        }
        args.date = v;
        break;
      }
      case '--days': {
        const v = argv[++i];
        if (!v) throw new CliError('`--days` requires a value');
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1) {
          throw new CliError(`--days must be a positive integer (got ${v})`);
        }
        args.days = n;
        break;
      }
      case '--printing': {
        const v = argv[++i];
        if (!v) throw new CliError('`--printing` requires a printing UUID');
        args.printingId = v;
        break;
      }
      case '--url':
      case '-u': {
        const v = argv[++i];
        if (!v) throw new CliError('`--url` requires a connection string argument');
        args.url = v;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new CliError(`unknown argument: ${arg ?? '(empty)'}`);
    }
  }
  return args;
}

function usage(): string {
  return (
    `Usage: ${SCRIPT_NAME} [--date YYYY-MM-DD] [--days N] [--printing UUID]\n` +
    `       [--url <conn>] [--dry-run]\n` +
    `\n` +
    `Defaults:\n` +
    `  --date    yesterday-UTC\n` +
    `  --days    1\n` +
    `\n` +
    `Env:\n` +
    `  MOCK_PRICING_ROLLUP=1   Use synthetic in-memory observations (no DB).\n` +
    `  DATABASE_URL            Postgres connection (or pass --url).\n` +
    `  SUPABASE_DB_URL         Fallback Postgres connection.\n`
  );
}

function isMockMode(): boolean {
  return process.env['MOCK_PRICING_ROLLUP'] === '1';
}

function resolveUrl(args: ParsedArgs): string | null {
  if (args.url) return args.url;
  const envDb = process.env['DATABASE_URL'];
  if (envDb) return envDb;
  const envSupabase = process.env['SUPABASE_DB_URL'];
  if (envSupabase) return envSupabase;
  return null;
}

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// Drizzle wiring
// ============================================================

type DrizzleDb = ReturnType<typeof createDbClient>;

/**
 * Production reader — yields observations from `price_observation`
 * for one calendar date, applying the canonical confidence filter
 * at the `WHERE` clause so the runner's bucket loop is O(retained).
 *
 * Rows are streamed via `.execute()` + a single-batch fetch (the
 * v1 expected per-day volume is bounded by primary-set rollouts —
 * single-thousands of rows; well within `postgres-js`'s default
 * memory). If the table grows past tens of thousands per day, swap
 * for a `.cursor()` (postgres-js exposes one) without changing the
 * runner.
 */
function makeReader(db: DrizzleDb): PriceObservationReader {
  return {
    async *streamObservationsForDate(
      observedDate: string,
      opts?: { readonly printingId?: string },
    ): AsyncIterable<RollupObservation> {
      const conditions = [
        eq(priceObservationTable.observedDate, observedDate),
        or(
          isNull(priceObservationTable.parseConfidence),
          gte(priceObservationTable.parseConfidence, '0.70'),
        ),
      ];
      if (opts?.printingId !== undefined) {
        conditions.push(eq(priceObservationTable.printingId, opts.printingId));
      }
      const rows = await db
        .select({
          printingId: priceObservationTable.printingId,
          gradeTier: priceObservationTable.gradeTier,
          market: priceObservationTable.market,
          source: priceObservationTable.source,
          observationKind: priceObservationTable.observationKind,
          observedPrice: priceObservationTable.observedPrice,
          observedCurrency: priceObservationTable.observedCurrency,
          parseConfidence: priceObservationTable.parseConfidence,
          observedDate: priceObservationTable.observedDate,
        })
        .from(priceObservationTable)
        .where(and(...conditions));
      for (const row of rows) {
        yield row as RollupObservation;
      }
    },
  };
}

/**
 * Production repo — `INSERT … ON CONFLICT … DO UPDATE` against the
 * schema's composite PK `(printing_id, grade_tier, market,
 * currency, period_start)`. Mirrors the posture of
 * `DrizzlePriceObservationRepo` from
 * `data-pipeline/src/adapters/pricing-aggregator/repo.ts` and the
 * eBay-browse / fx-rates Drizzle repos.
 */
function makeRepo(db: DrizzleDb): PriceAggregateRepo {
  return {
    async upsertMany(rows: ReadonlyArray<PriceAggregateRow>): Promise<number> {
      if (rows.length === 0) return 0;
      const values: NewPriceAggregate[] = rows.map((r) => ({
        printingId: r.printingId,
        gradeTier: r.gradeTier,
        market: r.market,
        currency: r.currency,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        medianPrice: r.medianPrice,
        meanPrice: r.meanPrice,
        lowPrice: r.lowPrice,
        highPrice: r.highPrice,
        sampleCount: r.sampleCount,
        sourceBreakdown: r.sourceBreakdown,
        observationKindBreakdown: r.observationKindBreakdown,
        computedAt: r.computedAt,
      }));
      await db
        .insert(priceAggregateTable)
        .values(values)
        .onConflictDoUpdate({
          target: [
            priceAggregateTable.printingId,
            priceAggregateTable.gradeTier,
            priceAggregateTable.market,
            priceAggregateTable.currency,
            priceAggregateTable.periodStart,
          ],
          set: {
            periodEnd: sql`excluded.period_end`,
            medianPrice: sql`excluded.median_price`,
            meanPrice: sql`excluded.mean_price`,
            lowPrice: sql`excluded.low_price`,
            highPrice: sql`excluded.high_price`,
            sampleCount: sql`excluded.sample_count`,
            sourceBreakdown: sql`excluded.source_breakdown`,
            observationKindBreakdown: sql`excluded.observation_kind_breakdown`,
            computedAt: sql`excluded.computed_at`,
          },
        });
      return rows.length;
    },
  };
}

// ============================================================
// Mock-mode wiring (no network, no DB)
// ============================================================

function makeMockReader(): PriceObservationReader {
  // Two printings × two grade tiers × two days, with a low-confidence
  // outlier on the first day so a smoke-test reader sees the
  // confidence filter in action. Hard-coded UUIDs match the eBay-
  // browse mock catalog where overlap matters.
  const PR_A = '00000000-0000-4000-8000-000000000001';
  const PR_B = '00000000-0000-4000-8000-000000000002';
  const fixtures: ReadonlyArray<RollupObservation> = [
    // PR_A / PSA_10 / EBAY_US / USD / day 1 — three honest prices
    // and one low-confidence row that must NOT contribute.
    {
      printingId: PR_A,
      gradeTier: 'PSA_10',
      market: 'EBAY_US',
      source: 'ebay_browse',
      observationKind: 'active_listing',
      observedPrice: '1200.00',
      observedCurrency: 'USD',
      parseConfidence: '0.86',
      observedDate: '2026-05-02',
    },
    {
      printingId: PR_A,
      gradeTier: 'PSA_10',
      market: 'EBAY_US',
      source: 'aggregator_mock',
      observationKind: 'sold',
      observedPrice: '1240.00',
      observedCurrency: 'USD',
      parseConfidence: null,
      observedDate: '2026-05-02',
    },
    {
      printingId: PR_A,
      gradeTier: 'PSA_10',
      market: 'EBAY_US',
      source: 'ebay_browse',
      observationKind: 'active_listing',
      observedPrice: '9999.00',
      observedCurrency: 'USD',
      parseConfidence: '0.45',
      observedDate: '2026-05-02',
    },
    // PR_B / RAW_NM / CARDMARKET_EU / EUR / day 1
    {
      printingId: PR_B,
      gradeTier: 'RAW_NM',
      market: 'CARDMARKET_EU',
      source: 'aggregator_mock',
      observationKind: 'aggregator_quote',
      observedPrice: '85.00',
      observedCurrency: 'EUR',
      parseConfidence: null,
      observedDate: '2026-05-02',
    },
    // PR_A / PSA_10 / EBAY_US / USD / day 2
    {
      printingId: PR_A,
      gradeTier: 'PSA_10',
      market: 'EBAY_US',
      source: 'ebay_browse',
      observationKind: 'active_listing',
      observedPrice: '1300.00',
      observedCurrency: 'USD',
      parseConfidence: '0.91',
      observedDate: '2026-05-03',
    },
  ];
  return {
    async *streamObservationsForDate(observedDate, opts) {
      for (const row of fixtures) {
        if (row.observedDate !== observedDate) continue;
        if (opts?.printingId !== undefined && row.printingId !== opts.printingId) continue;
        if (row.parseConfidence != null) {
          const c = parseFloat(row.parseConfidence);
          if (Number.isFinite(c) && c < 0.7) continue;
        }
        yield row;
      }
    },
  };
}

class InMemoryPriceAggregateCliRepo implements PriceAggregateRepo {
  private readonly rows = new Map<string, PriceAggregateRow>();
  async upsertMany(rows: ReadonlyArray<PriceAggregateRow>): Promise<number> {
    for (const r of rows) {
      const k = `${r.printingId}|${r.gradeTier}|${r.market}|${r.currency}|${r.periodStart}`;
      this.rows.set(k, { ...r });
    }
    return rows.length;
  }
  size(): number {
    return this.rows.size;
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`${SCRIPT_NAME}: ${err.message}`);
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (args.help) {
    console.warn(usage());
    return;
  }

  const date = args.date ?? yesterdayUtc();
  const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { script: SCRIPT_NAME },
  });

  const mock = isMockMode();

  let reader: PriceObservationReader;
  let repo: PriceAggregateRepo;
  let pgClient: { end: (opts?: { timeout?: number }) => Promise<void> } | null = null;

  if (mock) {
    reader = makeMockReader();
    repo = new InMemoryPriceAggregateCliRepo();
    logger.info({ mock: true }, 'pricing-rollup.cli.mock_mode');
  } else {
    const url = resolveUrl(args);
    if (!url) {
      console.error(
        `${SCRIPT_NAME}: no target connection string. Pass --url <postgres://...> or set DATABASE_URL / SUPABASE_DB_URL, or use MOCK_PRICING_ROLLUP=1.`,
      );
      process.exitCode = 1;
      return;
    }
    const db = createDbClient(url, { poolOptions: { max: 1, onnotice: () => {} } });
    pgClient = db.$client as unknown as {
      end: (opts?: { timeout?: number }) => Promise<void>;
    };
    reader = makeReader(db);
    if (args.dryRun) {
      repo = new InMemoryPriceAggregateCliRepo();
      logger.info({ dryRun: true }, 'pricing-rollup.cli.dry_run_repo');
    } else {
      repo = makeRepo(db);
    }
  }

  try {
    const runOpts: RunPricingRollupOptions = {
      reader,
      repo,
      date,
      days: args.days,
      dryRun: args.dryRun,
      logger,
    };
    if (args.printingId !== undefined) runOpts.printingId = args.printingId;
    const report = await runPricingRollup(runOpts);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.errors.length > 0) {
      logger.warn({ errorCount: report.errors.length }, 'pricing-rollup.cli.partial_success');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'pricing-rollup.cli.failed');
    process.exitCode = 1;
  } finally {
    if (pgClient) {
      await pgClient.end({ timeout: 5 });
    }
  }
}

await main();
