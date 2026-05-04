// scripts/migrate.ts — apply generated SQL migrations to a target
// Postgres. The target URL precedence is:
//
//   1. `--url <connection-string>` flag (orchestrator / one-offs)
//   2. process.env.DATABASE_URL
//   3. process.env.SUPABASE_DB_URL
//
// In production we apply migrations via this script (e.g. CI hitting
// the cloud Supabase Postgres); locally we apply against the Supabase
// CLI Postgres on :54322. We never use `drizzle-kit push` in
// production — see context/tech-stack.md ("Why not Drizzle Studio for
// everything?").
//
// Exit codes:
//   0  success
//   1  usage / connection error / migration failure

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_FOLDER = path.join(PACKAGE_ROOT, 'src', 'migrations');

interface ResolvedTarget {
  readonly url: string;
  readonly source: 'flag' | 'DATABASE_URL' | 'SUPABASE_DB_URL';
}

function fail(message: string): never {
  console.error(`db:migrate: ${message}`);
  process.exit(1);
}

function parseUrlFlag(argv: readonly string[]): string | undefined {
  const idx = argv.findIndex((arg) => arg === '--url' || arg === '-u');
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value) {
    fail('`--url` requires a connection string argument.');
  }
  return value;
}

function resolveTarget(): ResolvedTarget {
  const argv = process.argv.slice(2);
  const fromFlag = parseUrlFlag(argv);
  if (fromFlag) {
    return { url: fromFlag, source: 'flag' };
  }
  const fromDatabaseUrl = process.env['DATABASE_URL'];
  if (fromDatabaseUrl) {
    return { url: fromDatabaseUrl, source: 'DATABASE_URL' };
  }
  const fromSupabase = process.env['SUPABASE_DB_URL'];
  if (fromSupabase) {
    return { url: fromSupabase, source: 'SUPABASE_DB_URL' };
  }
  fail(
    'no target connection string. Pass `--url <postgres://...>` or set ' +
      '`DATABASE_URL` / `SUPABASE_DB_URL` in the environment.',
  );
}

async function main(): Promise<void> {
  const target = resolveTarget();
  console.warn(
    `db:migrate: applying migrations from ${path.relative(PACKAGE_ROOT, MIGRATIONS_FOLDER)} ` +
      `using URL from ${target.source}.`,
  );

  // `max: 1` matches drizzle's documented migrator pattern: a single
  // dedicated connection runs the migration transaction; the pool is
  // closed cleanly on success or failure so the script exits.
  const sql = postgres(target.url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.warn('db:migrate: success.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`db:migrate: migration failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
