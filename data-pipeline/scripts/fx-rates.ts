// scripts/fx-rates.ts — CLI entry for the FX-rate ingestion job.
//
// Wires `runFxRatesIngest` to a Drizzle-backed `FxRateRepo` against
// the database identified by:
//
//   1. `--url <connection-string>` flag, or
//   2. `process.env.DATABASE_URL`, or
//   3. `process.env.SUPABASE_DB_URL`.
//
// Modes (mutually exclusive — exactly one is required):
//
//   pnpm --filter @binderly/data-pipeline fx-rates --latest
//   pnpm --filter @binderly/data-pipeline fx-rates --date 2026-04-30
//   pnpm --filter @binderly/data-pipeline fx-rates --from-date 2026-04-01 \
//                                                  --to-date 2026-04-30
//
// On success: prints the `FxRatesReport` as a single line of JSON to
// stdout and exits 0. On any unrecoverable error (bad args, network /
// schema failure, DB connection failure) prints a diagnostic to
// stderr and exits 1.
//
// We avoid `process.exit()` in this script (the `n/no-process-exit`
// lint rule is `warn` and the package builds with --max-warnings=0).
// All error paths set `process.exitCode = 1` and let the event loop
// drain naturally.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import pino from 'pino';

// `@binderly/db` has no `main` / `exports` entry in its package.json
// (yet — that's a workspace-wide concern outside this task's scope).
// Importing through the `src/` deep path still resolves correctly via
// the pnpm symlink and TypeScript's `moduleResolution: "bundler"`,
// and at runtime `tsx` transpiles the TS source on demand. Tests in
// other packages (`data-pipeline/src/types.alignment.test.ts`) already
// rely on the same workspace shape for type-only imports.
import { createDbClient } from '@binderly/db/src/client.js';
import { fxRateTable, type NewFxRate } from '@binderly/db/src/schema/price_snapshots.js';

import { createFrankfurterClient } from '../src/adapters/fx/index.js';
import {
  runFxRatesIngest,
  type FxRateRepo,
  type FxRateRow,
  type RunFxRatesIngestOptions,
} from '../src/jobs/fx-rates.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = path.basename(__filename);

interface ParsedArgs {
  latest: boolean;
  date?: string;
  fromDate?: string;
  toDate?: string;
  url?: string;
  help: boolean;
}

class CliError extends Error {}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = { latest: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--latest':
        args.latest = true;
        break;
      case '--date': {
        const v = argv[++i];
        if (!v) throw new CliError('`--date` requires a value (YYYY-MM-DD)');
        args.date = v;
        break;
      }
      case '--from-date': {
        const v = argv[++i];
        if (!v) throw new CliError('`--from-date` requires a value (YYYY-MM-DD)');
        args.fromDate = v;
        break;
      }
      case '--to-date': {
        const v = argv[++i];
        if (!v) throw new CliError('`--to-date` requires a value (YYYY-MM-DD)');
        args.toDate = v;
        break;
      }
      case '--url':
      case '-u': {
        const v = argv[++i];
        if (!v) throw new CliError('`--url` requires a connection string argument');
        args.url = v;
        break;
      }
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
    `Usage: ${SCRIPT_NAME} [--latest | --date YYYY-MM-DD | --from-date X --to-date Y] [--url <conn>]\n` +
    `Modes are mutually exclusive. Exactly one is required.\n` +
    `Connection precedence: --url > DATABASE_URL > SUPABASE_DB_URL.`
  );
}

function resolveUrl(args: ParsedArgs): string {
  if (args.url) return args.url;
  const envDb = process.env['DATABASE_URL'];
  if (envDb) return envDb;
  const envSupabase = process.env['SUPABASE_DB_URL'];
  if (envSupabase) return envSupabase;
  throw new CliError(
    'no target connection string. Pass `--url <postgres://...>` or set ' +
      '`DATABASE_URL` / `SUPABASE_DB_URL` in the environment.',
  );
}

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

  let url: string;
  try {
    url = resolveUrl(args);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`${SCRIPT_NAME}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { script: SCRIPT_NAME },
  });

  const client = createFrankfurterClient({ context: { logger, env: 'production' } });

  const db = createDbClient(url, { poolOptions: { max: 1, onnotice: () => {} } });
  const pg = db.$client;

  const repo: FxRateRepo = {
    async upsertMany(rows: ReadonlyArray<FxRateRow>): Promise<number> {
      if (rows.length === 0) return 0;
      const values: NewFxRate[] = rows.map((r) => ({
        rateDate: r.rateDate,
        baseCurrency: r.baseCurrency,
        quoteCurrency: r.quoteCurrency,
        rate: r.rate,
        fetchedAt: r.fetchedAt,
        source: r.source,
      }));
      // PK on (rate_date, base_currency, quote_currency) — see
      // packages/db/src/migrations/0008_pricing_tables.sql. `source`
      // is a metadata column intentionally NOT part of the conflict
      // target; re-running with a different source overwrites in
      // place (documented in the elaborated task spec).
      await db
        .insert(fxRateTable)
        .values(values)
        .onConflictDoUpdate({
          target: [fxRateTable.rateDate, fxRateTable.baseCurrency, fxRateTable.quoteCurrency],
          set: {
            rate: sql`excluded.rate`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      return rows.length;
    },
  };

  try {
    const runOpts: RunFxRatesIngestOptions = { client, repo, logger };
    if (args.latest) runOpts.latest = true;
    if (args.date) runOpts.date = args.date;
    if (args.fromDate) runOpts.fromDate = args.fromDate;
    if (args.toDate) runOpts.toDate = args.toDate;
    const report = await runFxRatesIngest(runOpts);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.errors.length > 0) {
      logger.warn({ errorCount: report.errors.length }, 'fx-rates.partial_success');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'fx-rates.failed');
    process.exitCode = 1;
  } finally {
    await pg.end({ timeout: 5 });
  }
}

await main();
