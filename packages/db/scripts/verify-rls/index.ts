// `runVerification` — orchestrates the structural and behavioral
// assertions defined in `assertions.ts` against a target Postgres.
//
// Connects via postgres-js. Wraps the entire verification in a single
// transaction so behavioral fixtures (synthetic auth.users + profile
// rows) ROLLBACK at the end and never persist. Returns a typed outcome
// the CLI entry point in `cli.ts` formats.

import postgres, { type Sql } from 'postgres';

import {
  assertBehavior,
  assertPolicyInventory,
  assertRlsEnabled,
  assertTablesExist,
  type AssertionResult,
} from './assertions.js';

export interface VerifyConfig {
  readonly connectionString: string;
}

export interface VerifyOutcome {
  readonly results: readonly AssertionResult[];
  /** True when at least one assertion failed. */
  readonly failed: boolean;
}

/**
 * Run the full RLS verification suite against `config.connectionString`.
 *
 * Connection identity matters: the caller must supply a connection that
 * has either superuser or `service_role` rights so the script can:
 *   - read pg_class / pg_policies / auth.users
 *   - INSERT into auth.users + public.profile to set up behavioral fixtures
 *   - SET LOCAL ROLE between authenticated / anon / service_role
 *
 * The local Supabase Postgres on `:54322` connects as `postgres` (a
 * superuser) by default, so `SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres`
 * just works out of the box.
 */
export async function runVerification(config: VerifyConfig): Promise<VerifyOutcome> {
  const sql = postgres(config.connectionString, {
    max: 1,
    onnotice: () => {
      // postgres-js logs NOTICEs by default; the SET LOCAL machinery emits
      // a stream of them and they're not interesting here.
    },
  });
  const results: AssertionResult[] = [];

  try {
    await assertTablesExist(sql, results);
    if (anyFailed(results)) {
      // No point running RLS assertions if the tables themselves are
      // missing — the user almost certainly forgot to apply migrations.
      return { results, failed: true };
    }

    await assertRlsEnabled(sql, results);
    await assertPolicyInventory(sql, results);

    // Behavioral assertions live inside an explicit transaction so the
    // synthetic fixtures the suite inserts into auth.users + public.profile
    // disappear when the script exits.
    await runInTransaction(sql, async () => {
      await assertBehavior(sql, results);
    });

    return { results, failed: anyFailed(results) };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function anyFailed(results: readonly AssertionResult[]): boolean {
  return results.some((r) => !r.passed);
}

/**
 * Run `body` between `BEGIN` and `ROLLBACK`. We intentionally always
 * ROLLBACK (success or failure) so verification leaves zero side
 * effects — it only reads.
 */
async function runInTransaction(sql: Sql, body: () => Promise<void>): Promise<void> {
  await sql`BEGIN`;
  try {
    await body();
  } finally {
    await sql`ROLLBACK`;
  }
}
