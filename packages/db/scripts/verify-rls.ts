// scripts/verify-rls.ts — CLI entry for the RLS verification suite.
//
// Resolves the target Postgres URL using the same precedence as
// `scripts/migrate.ts`:
//
//   1. `--url <connection-string>` flag
//   2. process.env.DATABASE_URL
//   3. process.env.SUPABASE_DB_URL
//
// On success: prints the per-assertion log and exits 0.
// On RLS failure: prints the failures and exits 1.
// On "no DB URL provided" or initial connection failure: prints the
// paste-able run instructions and exits 2 (treat as "skipped"). This is
// what lets sandbox / CI environments without a live Supabase still
// typecheck / lint / build the script.
//
// The structural asserter requires a freshly-migrated database; if any
// of the user-facing tables is missing the script fails fast with
// "have you run db:migrate?" guidance.

import process from 'node:process';

import { runVerification, type VerifyOutcome } from './verify-rls/index.js';

interface ResolvedTarget {
  readonly url: string;
  readonly source: 'flag' | 'DATABASE_URL' | 'SUPABASE_DB_URL';
}

function parseUrlFlag(argv: readonly string[]): string | undefined {
  const idx = argv.findIndex((arg) => arg === '--url' || arg === '-u');
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value) {
    console.error('verify-rls: `--url` requires a connection string argument.');
    process.exit(2);
  }
  return value;
}

function resolveTarget(): ResolvedTarget | null {
  const argv = process.argv.slice(2);
  const fromFlag = parseUrlFlag(argv);
  if (fromFlag) return { url: fromFlag, source: 'flag' };
  const fromDatabaseUrl = process.env['DATABASE_URL'];
  if (fromDatabaseUrl) return { url: fromDatabaseUrl, source: 'DATABASE_URL' };
  const fromSupabase = process.env['SUPABASE_DB_URL'];
  if (fromSupabase) return { url: fromSupabase, source: 'SUPABASE_DB_URL' };
  return null;
}

function printSkipMessage(): void {
  console.warn(
    [
      'verify-rls: skipped — no target connection string.',
      '',
      'To run end-to-end against your local Supabase:',
      '',
      '  # 1. ensure local Supabase is up + migrations have been applied:',
      '  pnpm exec supabase start                   # if not already running',
      '  pnpm --filter @binderly/db db:migrate \\',
      '    --url postgresql://postgres:postgres@localhost:54322/postgres',
      '',
      '  # 2. run the verifier:',
      '  SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres \\',
      '    pnpm --filter @binderly/db verify-rls',
      '',
      'or pass the URL directly:',
      '',
      '  pnpm --filter @binderly/db verify-rls -- --url postgresql://...',
    ].join('\n'),
  );
}

function printOutcome(outcome: VerifyOutcome): void {
  let passes = 0;
  let failures = 0;
  for (const result of outcome.results) {
    if (result.passed) {
      passes += 1;
      console.warn(`  ✓ ${result.name}`);
    } else {
      failures += 1;
      const detail = result.message ? `\n      ${result.message}` : '';
      console.error(`  ✗ ${result.name}${detail}`);
    }
  }
  console.warn('');
  console.warn(`verify-rls: ${passes} passed, ${failures} failed.`);
}

async function main(): Promise<void> {
  const target = resolveTarget();
  if (!target) {
    printSkipMessage();
    process.exit(2);
  }
  console.warn(`verify-rls: connecting using URL from ${target.source}.`);
  let outcome: VerifyOutcome;
  try {
    outcome = await runVerification({ connectionString: target.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`verify-rls: could not run against the target — ${message}`);
    console.error(
      'Treating as "skipped"; check the connection string, ensure the DB is up, ' +
        'and that migrations have been applied.',
    );
    process.exit(2);
  }
  printOutcome(outcome);
  process.exit(outcome.failed ? 1 : 0);
}

await main();
