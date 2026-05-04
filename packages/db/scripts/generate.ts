// scripts/generate.ts — wrap `drizzle-kit generate` and enforce the
// repo's migration conventions:
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
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, 'src', 'migrations');
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');

// Sequential numeric naming: NNNN_<snake_case_summary>.sql
// Drizzle-kit's default naming is already `0000_<name>.sql`; we double-
// check here so a future drizzle-kit upgrade can't silently change it.
const MIGRATION_NAME_RE = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

interface JournalFile {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
}

function listSqlMigrations(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      const full = path.join(MIGRATIONS_DIR, name);
      return statSync(full).isFile() && name.endsWith('.sql');
    })
    .sort();
}

function readJournal(): JournalFile | undefined {
  try {
    const raw = readFileSync(JOURNAL_PATH, 'utf8');
    return JSON.parse(raw) as JournalFile;
  } catch {
    return undefined;
  }
}

function fail(code: 1 | 2, message: string): never {
  console.error(`db:generate: ${message}`);
  process.exit(code);
}

function configFlag(): string[] {
  // Allow callers to override the drizzle config (e.g. the smoke
  // fixture uses `drizzle.smoke.config.ts`). Defaults to the canonical
  // `drizzle.config.ts` at the package root.
  const passthrough = process.argv.slice(2);
  return passthrough.length > 0 ? passthrough : ['--config', 'drizzle.config.ts'];
}

function runDrizzleGenerate(): void {
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

function assertConventions(beforeSql: readonly string[]): void {
  const afterSql = listSqlMigrations();
  const newFiles = afterSql.filter((name) => !beforeSql.includes(name));

  if (newFiles.length === 0) {
    console.warn(
      'db:generate: no new SQL migration was produced (schema unchanged?). ' +
        'Convention check skipped.',
    );
    return;
  }

  for (const file of newFiles) {
    if (!MIGRATION_NAME_RE.test(file)) {
      fail(
        2,
        `generated migration "${file}" violates the NNNN_<snake_case_summary>.sql convention. ` +
          `Rename it manually or restart with a cleaner schema name.`,
      );
    }
    const full = path.join(MIGRATIONS_DIR, file);
    const head = readFileSync(full, 'utf8').slice(0, 256).trim();
    if (head.length === 0) {
      fail(2, `generated migration "${file}" is empty.`);
    }
  }

  const journal = readJournal();
  if (!journal) {
    fail(
      2,
      `expected drizzle-kit to write ${path.relative(PACKAGE_ROOT, JOURNAL_PATH)} alongside ` +
        `the new SQL file. The journal is metadata-only but it MUST exist.`,
    );
  }
  if (journal.entries.length < afterSql.length) {
    fail(
      2,
      `journal has ${String(journal.entries.length)} entries but ${String(afterSql.length)} ` +
        `SQL migration files exist. Each migration must appear in _journal.json.`,
    );
  }

  console.warn(
    `db:generate: produced ${String(newFiles.length)} new SQL migration(s): ${newFiles.join(', ')}`,
  );
}

function main(): void {
  const before = listSqlMigrations();
  runDrizzleGenerate();
  assertConventions(before);
}

main();
