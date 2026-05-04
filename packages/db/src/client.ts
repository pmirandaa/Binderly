// Typed Drizzle client for Binderly. The runtime client used inside
// app-side code (web, mobile, edge functions) is the Supabase JS SDK so
// that RLS is enforced; this Drizzle client is for **server-side**
// callers only — migration scripts, data-pipeline jobs, and trusted
// service-role surfaces.
//
// Driver choice: `postgres` (a.k.a. postgres-js). Drizzle supports both
// `pg` and `postgres-js`; postgres-js is lighter, has first-class
// TypeScript types, and works in Edge runtimes. If we ever need pgBouncer
// transaction-pool support with prepared statements we'll revisit
// `pg` — surfaced as a note in T-FN-DB-MIGRATIONS' execution log.

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

// `schema/index.ts` is intentionally empty until Phase 1 lands. Until
// then we type the client over an empty record so TypeScript still
// considers `db` a `PostgresJsDatabase<Schema>` — once tables exist this
// type widens automatically because `schema` will start exporting them.
export type DbSchema = typeof schema;

export type DbClient = PostgresJsDatabase<DbSchema>;

export interface CreateDbClientOptions {
  /**
   * Passed straight through to `postgres()`. Use this to set
   * `max`, `prepare`, `idle_timeout`, etc. from the caller. The
   * defaults from postgres-js are fine for short-lived scripts.
   */
  readonly poolOptions?: Parameters<typeof postgres>[1];
}

/**
 * Construct a Drizzle client over postgres-js for the given connection
 * string. The caller owns the connection lifecycle — the underlying
 * `postgres` pool is exposed on `client.$client` so it can be `.end()`-ed
 * cleanly when the script exits.
 */
export function createDbClient(
  connectionString: string,
  options: CreateDbClientOptions = {},
): DbClient {
  if (!connectionString) {
    throw new Error(
      'createDbClient: connectionString is required (got empty string). ' +
        'Pass DATABASE_URL or SUPABASE_DB_URL.',
    );
  }
  const sql = postgres(connectionString, options.poolOptions);
  return drizzle(sql, { schema });
}
