// scripts/migrate.mjs — apply generated SQL migrations to a target
// Postgres. Plain ESM (run with `node`, not `tsx`) so the script never
// touches the tsx transpile-and-IPC runtime that intermittently fails in
// the sandbox (see #FU-1). The target URL precedence is:
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
// Graceful degradation (#FU-7): if `meta/_journal.json` is missing,
// unparseable, or carries no entries, there is simply nothing to apply,
// so we log a clear message and exit 0 rather than letting drizzle's
// migrator throw an opaque error. If the journal references a SQL file
// that is not on disk we refuse with an actionable message instead of a
// raw ENOENT stack.
//
// Exit codes:
//   0  success (including the graceful "nothing to apply" case)
//   1  usage / connection error / migration failure

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_FOLDER = path.join(PACKAGE_ROOT, 'src', 'migrations');

/** Usage error — thrown by the pure helpers, caught by the CLI wrapper. */
export class MigrateUsageError extends Error {}

function fail(message) {
  console.error(`db:migrate: ${message}`);
  process.exit(1);
}

/**
 * Read the `--url` / `-u` flag from a parsed argv slice.
 * @param {readonly string[]} argv
 * @returns {string | undefined}
 */
export function parseUrlFlag(argv) {
  const idx = argv.findIndex((arg) => arg === '--url' || arg === '-u');
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value) {
    throw new MigrateUsageError('`--url` requires a connection string argument.');
  }
  return value;
}

/**
 * Resolve the migration target from argv + the environment.
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, source: 'flag' | 'DATABASE_URL' | 'SUPABASE_DB_URL' } | null}
 */
export function resolveTarget(argv, env) {
  const fromFlag = parseUrlFlag(argv);
  if (fromFlag) return { url: fromFlag, source: 'flag' };
  if (env['DATABASE_URL']) return { url: env['DATABASE_URL'], source: 'DATABASE_URL' };
  if (env['SUPABASE_DB_URL']) return { url: env['SUPABASE_DB_URL'], source: 'SUPABASE_DB_URL' };
  return null;
}

/**
 * Inspect the migration journal and decide whether there is anything to
 * apply. Returns a discriminated result the CLI turns into log lines.
 *
 * @param {string} migrationsFolder
 * @returns {{ status: 'skip', reason: string, message: string }
 *   | { status: 'apply', entries: ReadonlyArray<{ tag: string }>, missingFiles: string[] }}
 */
export function planMigration(migrationsFolder) {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    return {
      status: 'skip',
      reason: 'no-journal',
      message: `no migration journal at ${path.relative(PACKAGE_ROOT, journalPath)} — nothing to apply.`,
    };
  }

  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: 'skip',
      reason: 'unparseable-journal',
      message: `migration journal ${path.relative(PACKAGE_ROOT, journalPath)} is not valid JSON (${detail}) — nothing to apply.`,
    };
  }

  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  if (entries.length === 0) {
    return {
      status: 'skip',
      reason: 'empty-journal',
      message: `migration journal ${path.relative(PACKAGE_ROOT, journalPath)} has no entries — nothing to apply.`,
    };
  }

  const missingFiles = entries
    .map((entry) => entry?.tag)
    .filter((tag) => typeof tag === 'string')
    .filter((tag) => !existsSync(path.join(migrationsFolder, `${tag}.sql`)));

  return { status: 'apply', entries, missingFiles };
}

async function main() {
  let target;
  try {
    target = resolveTarget(process.argv.slice(2), process.env);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!target) {
    fail(
      'no target connection string. Pass `--url <postgres://...>` or set ' +
        '`DATABASE_URL` / `SUPABASE_DB_URL` in the environment.',
    );
    return;
  }

  const plan = planMigration(MIGRATIONS_FOLDER);
  if (plan.status === 'skip') {
    console.warn(`db:migrate: ${plan.message} Skipping gracefully — nothing to do.`);
    return;
  }
  if (plan.missingFiles.length > 0) {
    fail(
      `migration journal references SQL file(s) not present on disk: ` +
        `${plan.missingFiles.map((tag) => `${tag}.sql`).join(', ')}. ` +
        `Run \`db:generate\` to regenerate them, or restore the missing file(s). ` +
        `Refusing to apply a partial migration set.`,
    );
    return;
  }

  console.warn(
    `db:migrate: applying ${plan.entries.length} migration(s) from ` +
      `${path.relative(PACKAGE_ROOT, MIGRATIONS_FOLDER)} using URL from ${target.source}.`,
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

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  await main();
}
