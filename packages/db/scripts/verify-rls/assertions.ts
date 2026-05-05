// Structural and behavioral assertions for verify-rls.
//
// Each asserter pushes one or more `AssertionResult` rows into the shared
// list and returns. The caller (`runVerification` in `index.ts`) decides
// whether to short-circuit on a structural failure or continue.
//
// Style note: SQL is authored with postgres-js's tagged-template syntax so
// parameters cannot be SQL-injected. The few places that interpolate
// identifiers (table names, role names) only do so against
// hard-coded constants in `inventory.ts`.

import { randomUUID } from 'node:crypto';

import {
  EXPECTED_DEBUG_VIEWS,
  EXPECTED_POLICIES,
  EXPECTED_TABLES,
  NO_PERMISSIVE_POLICY_TABLES,
  type ExpectedPolicy,
} from './inventory.js';

import type { Sql } from 'postgres';

export interface AssertionResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string | null;
}

interface PgPolicyRow {
  readonly tablename: string;
  readonly policyname: string;
  readonly cmd: string;
  readonly roles: readonly string[];
}

function ok(name: string): AssertionResult {
  return { name, passed: true, message: null };
}

function fail(name: string, message: string): AssertionResult {
  return { name, passed: false, message };
}

// ============================================================
// Structural assertions
// ============================================================

export async function assertTablesExist(sql: Sql, results: AssertionResult[]): Promise<void> {
  const expectedNames = EXPECTED_TABLES.map((t) => t.tablename);
  const rows = await sql<{ tablename: string }[]>`
    SELECT tablename
    FROM   pg_catalog.pg_tables
    WHERE  schemaname = 'public'
      AND  tablename = ANY(${expectedNames})
  `;
  const found = new Set(rows.map((r) => r.tablename));
  for (const t of EXPECTED_TABLES) {
    if (found.has(t.tablename)) {
      results.push(ok(`table:${t.tablename} exists`));
    } else {
      results.push(
        fail(
          `table:${t.tablename} exists`,
          `missing in public schema (note: ${t.note}). Have you run ` +
            '`pnpm --filter @binderly/db db:migrate` against this DB?',
        ),
      );
    }
  }
}

export async function assertViewsExist(sql: Sql, results: AssertionResult[]): Promise<void> {
  const expectedNames = EXPECTED_DEBUG_VIEWS.map((v) => v.viewname);
  if (expectedNames.length === 0) return;
  const rows = await sql<{ viewname: string }[]>`
    SELECT viewname
    FROM   pg_catalog.pg_views
    WHERE  schemaname = 'public'
      AND  viewname = ANY(${expectedNames})
  `;
  const found = new Set(rows.map((r) => r.viewname));
  for (const v of EXPECTED_DEBUG_VIEWS) {
    if (found.has(v.viewname)) {
      results.push(ok(`view:${v.viewname} exists`));
    } else {
      results.push(
        fail(
          `view:${v.viewname} exists`,
          `missing in public schema (note: ${v.note}). Have you run ` +
            '`pnpm --filter @binderly/db db:migrate` against this DB? ' +
            '0016_admin_debug_views.sql ships this view.',
        ),
      );
    }
  }
}

export async function assertRlsEnabled(sql: Sql, results: AssertionResult[]): Promise<void> {
  const expectedNames = EXPECTED_TABLES.map((t) => t.tablename);
  const rows = await sql<{ tablename: string; rowsecurity: boolean }[]>`
    SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity
    FROM   pg_catalog.pg_class c
    JOIN   pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  c.relname = ANY(${expectedNames})
  `;
  const byName = new Map(rows.map((r) => [r.tablename, r.rowsecurity]));
  for (const t of EXPECTED_TABLES) {
    const enabled = byName.get(t.tablename);
    if (enabled === undefined) {
      // table-existence pass already reported the missing table; skip a
      // duplicate failure here.
      continue;
    }
    if (enabled) {
      results.push(ok(`rls:${t.tablename} enabled`));
    } else {
      results.push(
        fail(
          `rls:${t.tablename} enabled`,
          'pg_class.relrowsecurity = false — table is unprotected. Run the ' +
            'companion `*_rls.sql` migration that enables RLS on this table.',
        ),
      );
    }
  }
}

function policyKey(p: { tablename: string; policyname: string }): string {
  return `${p.tablename}|${p.policyname}`;
}

export async function assertPolicyInventory(sql: Sql, results: AssertionResult[]): Promise<void> {
  const tablenames = [...new Set(EXPECTED_POLICIES.map((p) => p.tablename))];
  const rows = await sql<PgPolicyRow[]>`
    SELECT tablename, policyname, cmd, roles
    FROM   pg_catalog.pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = ANY(${tablenames})
  `;
  const found = new Map<string, PgPolicyRow>();
  for (const r of rows) {
    found.set(policyKey(r), r);
  }

  for (const expected of EXPECTED_POLICIES) {
    const actual = found.get(policyKey(expected));
    const name = `policy:${expected.tablename}.${expected.policyname}`;
    if (!actual) {
      results.push(
        fail(
          name,
          'missing in pg_policies. Re-run the relevant `*_rls.sql` migration ' +
            '(see `src/migrations/rls/README.md` for the migration → policy map).',
        ),
      );
      continue;
    }
    const cmdMatch = matchesCmd(expected, actual.cmd);
    const rolesMatch = matchesRoles(expected.roles, actual.roles);
    if (cmdMatch && rolesMatch) {
      results.push(ok(name));
    } else {
      const detail: string[] = [];
      if (!cmdMatch) detail.push(`cmd: expected ${expected.cmd}, got ${actual.cmd}`);
      if (!rolesMatch) {
        const expectedRolesStr = [...expected.roles].sort().join(',');
        const actualRolesStr = [...actual.roles].sort().join(',');
        detail.push(`roles: expected [${expectedRolesStr}], got [${actualRolesStr}]`);
      }
      results.push(fail(name, detail.join('; ')));
    }
  }

  // Tables explicitly meant to carry NO permissive policy: surface a
  // failure if anything has been silently added.
  const tablesWithExtras = new Set<string>();
  for (const r of rows) {
    if (NO_PERMISSIVE_POLICY_TABLES.includes(r.tablename)) {
      tablesWithExtras.add(r.tablename);
    }
  }
  for (const t of NO_PERMISSIVE_POLICY_TABLES) {
    const name = `policy:${t}.<none>`;
    if (tablesWithExtras.has(t)) {
      results.push(
        fail(
          name,
          `${t} should have NO permissive policy, but pg_policies contains entries for it. ` +
            'Adding a policy here changes a security boundary; surface to the orchestrator.',
        ),
      );
    } else {
      results.push(ok(name));
    }
  }
}

function matchesCmd(expected: ExpectedPolicy, actualCmd: string): boolean {
  // `pg_policies.cmd` reports the verb as 'SELECT' / 'INSERT' / 'UPDATE'
  // / 'DELETE' / 'ALL'. Direct equality.
  return expected.cmd === actualCmd;
}

function matchesRoles(expected: readonly string[], actual: readonly string[]): boolean {
  const a = [...expected].sort();
  const b = [...actual].sort();
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================
// Behavioral assertion
// ============================================================

interface AuthFixture {
  readonly userA: string;
  readonly userB: string;
}

/**
 * Insert two synthetic auth.users rows and the matching profile rows so
 * the behavioral assertions have something to look at. Every fixture
 * lives inside the caller's transaction and disappears on ROLLBACK.
 *
 * Returns null and pushes a "skipped" assertion if auth.users isn't
 * insertable (e.g. column shape on this Supabase version diverges from
 * what we expect). Behavioral assertions become best-effort in that case.
 */
async function setupAuthFixtures(
  sql: Sql,
  results: AssertionResult[],
): Promise<AuthFixture | null> {
  const userA = randomUUID();
  const userB = randomUUID();
  try {
    await sql`
      INSERT INTO auth.users (instance_id, id, aud, role, email)
      VALUES
        ('00000000-0000-0000-0000-000000000000'::uuid, ${userA}::uuid,
         'authenticated', 'authenticated', ${`verify-rls-a-${userA}@verify.local`}),
        ('00000000-0000-0000-0000-000000000000'::uuid, ${userB}::uuid,
         'authenticated', 'authenticated', ${`verify-rls-b-${userB}@verify.local`})
    `;
    await sql`
      INSERT INTO public.profile (user_id, handle, display_name)
      VALUES
        (${userA}::uuid, ${`verify_a_${userA.replaceAll('-', '').slice(0, 12)}`}, 'Verify User A'),
        (${userB}::uuid, ${`verify_b_${userB.replaceAll('-', '').slice(0, 12)}`}, 'Verify User B')
    `;
    return { userA, userB };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push(
      fail(
        'behavior:setup',
        `could not insert auth.users + profile fixtures (${message}). ` +
          'Behavioral checks skipped; structural checks above are still authoritative.',
      ),
    );
    return null;
  }
}

/**
 * Drive each role through the documented matrix and assert visibility.
 * Runs inside a single transaction; the caller wraps with BEGIN/ROLLBACK
 * so nothing persists.
 */
export async function assertBehavior(sql: Sql, results: AssertionResult[]): Promise<void> {
  const fixtures = await setupAuthFixtures(sql, results);
  if (!fixtures) return;
  const { userA, userB } = fixtures;

  // ---- authenticated (userA) — sees own profile, not userB's owner row ----
  await switchRole(sql, 'authenticated', userA, results);

  await withTry(sql, results, 'behavior:authenticated reads own profile row', async () => {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM public.profile WHERE user_id = ${userA}::uuid
    `;
    return rows.length === 1
      ? null
      : `expected 1 row, got ${rows.length}. Either profile_owner_select is missing or the ` +
          'privilege snapshot does not GRANT SELECT on profile to authenticated.';
  });

  await withTry(
    sql,
    results,
    'behavior:authenticated cannot read other-user profile row via owner_select',
    async () => {
      const rows = await sql<{ user_id: string }[]>`
        SELECT user_id FROM public.profile
        WHERE  user_id = ${userB}::uuid
      `;
      return rows.length === 0 ? null : "profile.owner_select leaked another user's row";
    },
  );

  await withTry(
    sql,
    results,
    'behavior:authenticated grading_submission is owner-scoped (no rows)',
    async () => {
      const rows = await sql<{ id: string }[]>`SELECT id FROM public.grading_submission`;
      return rows.length === 0
        ? null
        : `expected 0 rows for a user with no submissions, got ${rows.length}`;
    },
  );

  await assertSelectDenied(sql, 'grading_training_sample', 'authenticated', results);
  await assertSelectDenied(sql, 'price_observation', 'authenticated', results);
  await assertSelectDenied(sql, 'data_conflict', 'authenticated', results);

  // Admin debug views: service-role-only. authenticated must be denied
  // on every view shipped by `0016_admin_debug_views.sql`.
  for (const view of EXPECTED_DEBUG_VIEWS) {
    await assertSelectDenied(sql, view.viewname, 'authenticated', results);
  }

  // ---- anon — public read of catalog + profile, blocked from owner tables ----
  await switchRole(sql, 'anon', null, results);

  for (const tname of ['set', 'card', 'printing', 'market', 'price_aggregate', 'fx_rate']) {
    await assertSelectAllowed(sql, tname, 'anon', results);
  }

  await withTry(sql, results, 'behavior:anon profile_public_read sees rows', async () => {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM public.profile
      WHERE  user_id IN (${userA}::uuid, ${userB}::uuid)
    `;
    return rows.length === 2
      ? null
      : `expected 2 rows from public_read, got ${rows.length}. Either profile_public_read is ` +
          'missing or the privilege snapshot does not GRANT SELECT on profile to anon.';
  });

  await assertOwnerTableInvisibleToAnon(sql, 'collection_item', userA, results);
  await assertOwnerTableInvisibleToAnon(sql, 'custom_collection', userA, results);
  await assertOwnerTableInvisibleToAnon(sql, 'subscription', userA, results);
  await assertOwnerTableInvisibleToAnon(sql, 'grading_submission', userA, results);

  await assertSelectDenied(sql, 'grading_training_sample', 'anon', results);
  await assertSelectDenied(sql, 'price_observation', 'anon', results);
  await assertSelectDenied(sql, 'data_conflict', 'anon', results);

  // Admin debug views: anon must also be denied (same posture as
  // service-role-only base tables).
  for (const view of EXPECTED_DEBUG_VIEWS) {
    await assertSelectDenied(sql, view.viewname, 'anon', results);
  }

  // ---- service_role — bypasses every policy ----
  await switchRole(sql, 'service_role', null, results);

  await withTry(sql, results, 'behavior:service_role bypass — sees all profile rows', async () => {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM public.profile
      WHERE  user_id IN (${userA}::uuid, ${userB}::uuid)
    `;
    return rows.length === 2 ? null : `expected 2 rows under BYPASSRLS, got ${rows.length}`;
  });

  for (const tname of ['grading_training_sample', 'price_observation', 'data_conflict']) {
    await assertSelectAllowed(sql, tname, 'service_role', results);
  }

  // Admin debug views: service_role must SELECT successfully on each.
  // (The wrappers in `public` are owned by `postgres`, so the underlying-
  // table reads — `extensions.pg_stat_statements` etc. — use the view
  // owner's privileges per PG 17's `security_invoker = false` default.)
  for (const view of EXPECTED_DEBUG_VIEWS) {
    await assertSelectAllowed(sql, view.viewname, 'service_role', results);
  }

  await withTry(sql, results, 'behavior:reset role', async () => {
    await sql`RESET ROLE`;
    return null;
  });
}

/**
 * Switch the current transaction's effective role and (optionally) install
 * a synthetic JWT claim. Captures any error as an assertion failure so
 * downstream queries get a chance to record their own results rather
 * than aborting the whole suite.
 */
async function switchRole(
  sql: Sql,
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  results: AssertionResult[],
): Promise<void> {
  await withTry(sql, results, `behavior:switch to ${role}`, async () => {
    await sql`RESET ROLE`;
    if (role === 'anon') {
      await sql`SET LOCAL ROLE anon`;
      await sql`SELECT set_config('request.jwt.claims', '', true)`;
    } else if (role === 'authenticated') {
      await sql`SET LOCAL ROLE authenticated`;
      const claims = JSON.stringify({ sub: userId ?? '', role: 'authenticated' });
      await sql`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    } else {
      await sql`SET LOCAL ROLE service_role`;
      await sql`SELECT set_config('request.jwt.claims', '', true)`;
    }
    return null;
  });
}

/**
 * Run `fn` inside a SAVEPOINT. If `fn` throws, the savepoint is rolled
 * back so the surrounding transaction stays usable for subsequent
 * assertions. (Without this, a single "permission denied" error would
 * abort the entire outer transaction and every later assertion would
 * fail with "current transaction is aborted, commands ignored until end
 * of transaction block".)
 *
 * Returns a discriminated union the caller can pattern-match on.
 */
let savepointCounter = 0;
type SavepointOutcome<T> = { ok: true; value: T } | { ok: false; error: Error };

async function inSavepoint<T>(sql: Sql, fn: () => Promise<T>): Promise<SavepointOutcome<T>> {
  savepointCounter += 1;
  const sp = `verify_rls_sp_${savepointCounter}`;
  let savepointEstablished = false;
  try {
    await sql.unsafe(`SAVEPOINT ${sp}`);
    savepointEstablished = true;
  } catch {
    // Not inside a transaction — run the body without a savepoint and
    // accept that one cascading "transaction aborted" failure is
    // possible.
  }
  try {
    const value = await fn();
    if (savepointEstablished) {
      await sql.unsafe(`RELEASE SAVEPOINT ${sp}`);
    }
    return { ok: true, value };
  } catch (error) {
    if (savepointEstablished) {
      try {
        await sql.unsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
        await sql.unsafe(`RELEASE SAVEPOINT ${sp}`);
      } catch {
        // Best effort — the outer transaction's ROLLBACK will clean up.
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Run an assertion body and record its outcome. The body returns `null`
 * for a pass or a string with the failure detail; any thrown error is a
 * failure with the error's message. Wraps the body in a SAVEPOINT so a
 * failing query doesn't poison the outer transaction.
 */
async function withTry(
  sql: Sql,
  results: AssertionResult[],
  name: string,
  body: () => Promise<string | null>,
): Promise<void> {
  const outcome = await inSavepoint(sql, body);
  if (outcome.ok) {
    results.push(outcome.value === null ? ok(name) : fail(name, outcome.value));
  } else {
    results.push(fail(name, outcome.error.message));
  }
}

function isPrivilegeDenied(message: string): boolean {
  return (
    message.includes('permission denied') ||
    message.includes('insufficient_privilege') ||
    message.includes('42501')
  );
}

/**
 * Assert that `role` cannot SELECT from `tablename`. Two acceptable
 * outcomes count as "denied": (a) the SELECT runs and returns zero
 * rows (RLS gates with no permissive policy + EXISTS is empty); (b)
 * the SELECT throws "permission denied" (no SQL-level grant for the
 * role). Either way the security boundary holds. The failure mode is
 * "rows came back".
 */
async function assertSelectDenied(
  sql: Sql,
  tablename: string,
  role: string,
  results: AssertionResult[],
): Promise<void> {
  const name = `behavior:${role} blocked from ${tablename}`;
  const outcome = await inSavepoint(
    sql,
    async () =>
      await sql<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM ${sql(tablename)}) AS exists
      `,
  );
  if (!outcome.ok) {
    if (isPrivilegeDenied(outcome.error.message)) {
      results.push(ok(name));
    } else {
      results.push(fail(name, `unexpected error: ${outcome.error.message}`));
    }
    return;
  }
  const leaked = outcome.value[0]?.exists === true;
  results.push(
    leaked
      ? fail(name, `${role} got rows back from ${tablename} — RLS missing or too permissive`)
      : ok(name),
  );
}

async function assertSelectAllowed(
  sql: Sql,
  tablename: string,
  role: string,
  results: AssertionResult[],
): Promise<void> {
  const name = `behavior:${role} can SELECT ${tablename}`;
  const outcome = await inSavepoint(sql, async () => {
    await sql`SELECT 1 FROM ${sql(tablename)} LIMIT 0`;
  });
  results.push(outcome.ok ? ok(name) : fail(name, `SELECT denied: ${outcome.error.message}`));
}

async function assertOwnerTableInvisibleToAnon(
  sql: Sql,
  tablename: string,
  ownerUserId: string,
  results: AssertionResult[],
): Promise<void> {
  const name = `behavior:anon cannot see owner-only ${tablename}`;
  const outcome = await inSavepoint(
    sql,
    async () =>
      await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM ${sql(tablename)} WHERE user_id = ${ownerUserId}::uuid
      `,
  );
  if (!outcome.ok) {
    if (isPrivilegeDenied(outcome.error.message)) {
      results.push(ok(name));
    } else {
      results.push(fail(name, `unexpected error: ${outcome.error.message}`));
    }
    return;
  }
  const visible = (outcome.value[0]?.count ?? 0) > 0;
  results.push(
    visible
      ? fail(
          name,
          `${tablename} returned rows for anon — owner_select policy may not be gating to authenticated.`,
        )
      : ok(name),
  );
}
