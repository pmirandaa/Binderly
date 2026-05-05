// scripts/pricing-current-view.ts — CLI entry for the
// `mv_current_price` materialized-view refresh
// (T-DL-PRICING-CURRENT-VIEW).
//
// Wires `runPricingCurrentViewRefresh` to:
//   - a postgres-js-backed `MaterializedViewRefresher` that detects
//     the view's populated state via `pg_class.relpages` and issues
//     the right `REFRESH MATERIALIZED VIEW [CONCURRENTLY] …`
//     statement, OR
//   - the in-memory shim from `pricing-current-view.ts` when
//     `MOCK_PRICING_CURRENT_VIEW=1`.
//
// Modes:
//
//   pnpm --filter @binderly/data-pipeline pricing-current-view --refresh
//   pnpm --filter @binderly/data-pipeline pricing-current-view --refresh --dry-run
//   MOCK_PRICING_CURRENT_VIEW=1 pnpm --filter @binderly/data-pipeline \
//     pricing-current-view --refresh
//
// On success: prints the `PricingCurrentViewReport` as a single line
// of JSON to stdout and exits 0. On any unrecoverable error prints
// a diagnostic to stderr and exits 1 (sets `process.exitCode`,
// matching the posture of `scripts/fx-rates.ts` /
// `scripts/pricing-rollup.ts`).

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pino from 'pino';

// `@binderly/db` ships a thin barrel via `dist/`. The deep-path
// import shape mirrors `scripts/fx-rates.ts` / `scripts/pricing-rollup.ts`.
import { createDbClient } from '@binderly/db/src/client.js';

import {
  composeRefreshSql,
  InMemoryMaterializedViewRefresher,
  MV_CURRENT_PRICE,
  runPricingCurrentViewRefresh,
  type MaterializedViewRefresher,
  type RunPricingCurrentViewRefreshOptions,
} from '../src/jobs/pricing-current-view.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = path.basename(__filename);

// ============================================================
// Argument parsing
// ============================================================

interface ParsedArgs {
  refresh: boolean;
  dryRun: boolean;
  url?: string;
  help: boolean;
}

class CliError extends Error {}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = { refresh: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--refresh':
        args.refresh = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
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
    `Usage: ${SCRIPT_NAME} --refresh [--dry-run] [--url <conn>]\n` +
    `\n` +
    `Operations (exactly one required):\n` +
    `  --refresh            Refresh the ${MV_CURRENT_PRICE} materialized view.\n` +
    `\n` +
    `Modifiers:\n` +
    `  --dry-run            Skip the refresh; print the SQL that WOULD have run.\n` +
    `  --url <conn>         Postgres connection string (defaults DATABASE_URL → SUPABASE_DB_URL).\n` +
    `  -h, --help           Print this help.\n` +
    `\n` +
    `Env:\n` +
    `  MOCK_PRICING_CURRENT_VIEW=1   Use synthetic in-memory refresher (no DB).\n` +
    `  DATABASE_URL                  Postgres connection (or pass --url).\n` +
    `  SUPABASE_DB_URL               Fallback Postgres connection.\n`
  );
}

function isMockMode(): boolean {
  return process.env['MOCK_PRICING_CURRENT_VIEW'] === '1';
}

function resolveUrl(args: ParsedArgs): string | null {
  if (args.url) return args.url;
  const envDb = process.env['DATABASE_URL'];
  if (envDb) return envDb;
  const envSupabase = process.env['SUPABASE_DB_URL'];
  if (envSupabase) return envSupabase;
  return null;
}

// ============================================================
// Drizzle wiring (production refresher)
// ============================================================

type DrizzleDb = ReturnType<typeof createDbClient>;

interface PgClient {
  unsafe: (sql: string) => Promise<unknown>;
  end: (opts?: { timeout?: number }) => Promise<void>;
}

/**
 * Production refresher — reads `pg_class.relpages` to detect whether
 * the view has been populated yet, then issues the right
 * `REFRESH MATERIALIZED VIEW …` form via the underlying
 * `postgres-js` client's `.unsafe()` (Drizzle does not model
 * materialized views, and the SQL is parameterless DDL).
 *
 * `pg_class.relpages = 0` is the canonical "never populated" signal
 * for a materialized view created `WITH NO DATA`. Once the first
 * `REFRESH MATERIALIZED VIEW` runs the view occupies storage and
 * `relpages > 0`. The CONCURRENTLY form is then safe; PG fails
 * `REFRESH … CONCURRENTLY` on a never-populated view with
 * "CONCURRENTLY cannot be used when the materialized view is not
 * populated", so the gating is mandatory.
 */
function makeRefresher(db: DrizzleDb): MaterializedViewRefresher {
  const pg = db.$client as unknown as PgClient & {
    // postgres-js exposes a tagged-template `sql` directly on the
    // client; we use `.unsafe()` for the DDL because the `REFRESH`
    // statement has no parameters.
    <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  };
  return {
    async isPopulated(): Promise<boolean> {
      const rows = (await pg`
        SELECT relpages
        FROM pg_class
        WHERE relname = ${MV_CURRENT_PRICE}
          AND relkind = 'm'
        LIMIT 1
      `) as ReadonlyArray<{ relpages: number }>;
      const first = rows[0];
      if (!first) {
        // Defensive — should not happen in production because the
        // migration creates the view. If it does, the next step
        // (the refresh) will fail loudly with a clearer error
        // ("relation \"mv_current_price\" does not exist") than a
        // misleading `false` from us.
        return false;
      }
      return first.relpages > 0;
    },
    async refresh(opts: { readonly concurrently: boolean }): Promise<{ readonly sql: string }> {
      const sql = composeRefreshSql({ concurrently: opts.concurrently });
      await pg.unsafe(sql);
      return { sql };
    },
  };
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
  if (!args.refresh) {
    console.error(`${SCRIPT_NAME}: an operation is required (use --refresh)`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { script: SCRIPT_NAME },
  });

  const mock = isMockMode();

  let refresher: MaterializedViewRefresher;
  let pgClient: { end: (opts?: { timeout?: number }) => Promise<void> } | null = null;

  if (mock) {
    refresher = new InMemoryMaterializedViewRefresher({ populated: false });
    logger.info({ mock: true }, 'pricing-current-view.cli.mock_mode');
  } else {
    const url = resolveUrl(args);
    if (!url) {
      console.error(
        `${SCRIPT_NAME}: no target connection string. Pass --url <postgres://...> or set DATABASE_URL / SUPABASE_DB_URL, or use MOCK_PRICING_CURRENT_VIEW=1.`,
      );
      process.exitCode = 1;
      return;
    }
    const db = createDbClient(url, { poolOptions: { max: 1, onnotice: () => {} } });
    pgClient = db.$client as unknown as {
      end: (opts?: { timeout?: number }) => Promise<void>;
    };
    refresher = makeRefresher(db);
  }

  try {
    const runOpts: RunPricingCurrentViewRefreshOptions = {
      refresher,
      dryRun: args.dryRun,
      logger,
    };
    const report = await runPricingCurrentViewRefresh(runOpts);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'pricing-current-view.cli.failed');
    process.exitCode = 1;
  } finally {
    if (pgClient) {
      await pgClient.end({ timeout: 5 });
    }
  }
}

await main();
