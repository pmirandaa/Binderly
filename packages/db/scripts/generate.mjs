// scripts/generate.mjs — wrap `drizzle-kit generate` and enforce the
// repo's migration conventions. Plain ESM (run with `node`, not `tsx`)
// so the wrapper never hits the sandbox tsx-IPC-pipe failures (#FU-1).
//
//   1. Migration files are SQL committed to git
//      (NNNN_<snake_case_summary>.sql under src/migrations/).
//   2. Drizzle's TS-managed metadata (`meta/_journal.json`) updates in
//      lockstep with new SQL files.
//
// Exit codes:
//   0  success
//   1  usage / unexpected error
//   2  convention violation (bad filename, missing journal entry,
//      generated TypeScript instead of SQL, etc.)

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, 'src', 'migrations');
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');

// Sequential numeric naming: NNNN_<snake_case_summary>.sql
// Drizzle-kit's default naming is already `0000_<name>.sql`; we double-
// check here so a future drizzle-kit upgrade can't silently change it.
export const MIGRATION_NAME_RE = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/**
 * List committed SQL migration filenames (sorted), or `[]` if the
 * directory does not exist.
 * @param {string} [migrationsDir]
 * @returns {string[]}
 */
export function listSqlMigrations(migrationsDir = MIGRATIONS_DIR) {
  let entries;
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      const full = path.join(migrationsDir, name);
      return statSync(full).isFile() && name.endsWith('.sql');
    })
    .sort();
}

/**
 * Parse the drizzle journal, or `undefined` when it is absent/unparseable.
 * @param {string} [journalPath]
 * @returns {{ version: string, dialect: string, entries: Array<unknown> } | undefined}
 */
export function readJournal(journalPath = JOURNAL_PATH) {
  try {
    return JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Pure convention evaluation over a before/after migration list + the
 * journal. Returns a discriminated result so the CLI can log + set the
 * right exit code without the policy logic being entangled with I/O.
 *
 * @param {{ before: readonly string[], after: readonly string[],
 *   journal: { entries: Array<unknown> } | undefined, migrationsDir?: string }} args
 * @returns {{ status: 'skip' | 'ok', message: string }
 *   | { status: 'violation', code: 2, message: string }}
 */
export function evaluateConventions({ before, after, journal, migrationsDir = MIGRATIONS_DIR }) {
  const newFiles = after.filter((name) => !before.includes(name));

  if (newFiles.length === 0) {
    return {
      status: 'skip',
      message: 'no new SQL migration was produced (schema unchanged?). Convention check skipped.',
    };
  }

  for (const file of newFiles) {
    if (!MIGRATION_NAME_RE.test(file)) {
      return {
        status: 'violation',
        code: 2,
        message:
          `generated migration "${file}" violates the NNNN_<snake_case_summary>.sql convention. ` +
          `Rename it manually or restart with a cleaner schema name.`,
      };
    }
    const head = readFileSync(path.join(migrationsDir, file), 'utf8').slice(0, 256).trim();
    if (head.length === 0) {
      return { status: 'violation', code: 2, message: `generated migration "${file}" is empty.` };
    }
  }

  if (!journal) {
    return {
      status: 'violation',
      code: 2,
      message:
        `expected drizzle-kit to write ${path.relative(PACKAGE_ROOT, JOURNAL_PATH)} alongside ` +
        `the new SQL file. The journal is metadata-only but it MUST exist.`,
    };
  }
  if (journal.entries.length < after.length) {
    return {
      status: 'violation',
      code: 2,
      message:
        `journal has ${journal.entries.length} entries but ${after.length} ` +
        `SQL migration files exist. Each migration must appear in _journal.json.`,
    };
  }

  return {
    status: 'ok',
    message: `produced ${newFiles.length} new SQL migration(s): ${newFiles.join(', ')}`,
  };
}

function fail(code, message) {
  console.error(`db:generate: ${message}`);
  process.exit(code);
}

function configFlag() {
  // Allow callers to override the drizzle config (e.g. the smoke
  // fixture uses `drizzle.smoke.config.ts`). Defaults to the canonical
  // `drizzle.config.ts` at the package root.
  const passthrough = process.argv.slice(2);
  return passthrough.length > 0 ? passthrough : ['--config', 'drizzle.config.ts'];
}

function runDrizzleGenerate() {
  const args = ['drizzle-kit', 'generate', ...configFlag()];
  console.warn(`db:generate: running \`pnpm exec ${args.join(' ')}\``);
  const result = spawnSync('pnpm', ['exec', ...args], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    fail(1, `drizzle-kit generate exited with status ${String(result.status)}`);
  }
}

function main() {
  const before = listSqlMigrations();
  runDrizzleGenerate();
  const after = listSqlMigrations();
  const journal = readJournal();
  const result = evaluateConventions({ before, after, journal });
  if (result.status === 'violation') {
    fail(result.code, result.message);
  }
  console.warn(`db:generate: ${result.message}`);
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  main();
}
