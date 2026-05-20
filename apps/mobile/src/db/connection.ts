// Lazy singleton SQLite connection for the Binderly mobile local DB.
//
// Design notes:
//  - The database is opened on **first access**, not at module load time.
//    This avoids app-shell bootstrap crashes if the native SQLite module is
//    slow to initialise or if migrations are slow (both are I/O-bound).
//  - `getDb()` is safe to call concurrently: the in-flight open Promise is
//    reused so migrations only run once even if two callers race at startup.
//  - `resetDbForTesting()` is exported for use in test setup/teardown.
//    It closes the current DB handle and clears the singleton so the next
//    `getDb()` call opens a fresh in-memory database. In production this
//    function should never be called.
//
// The database name is `binderly.db`. In tests the expo-sqlite mock maps
// this to an isolated in-memory sql.js database, keyed by name, so
// repositories and migration tests share the same in-memory store.

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { runMigrations } from './migrations/index.js';

const DB_NAME = 'binderly.db';

let dbPromise: Promise<SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLiteDatabase> {
  if (dbPromise === null) {
    dbPromise = openDatabaseAsync(DB_NAME).then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }
  return dbPromise;
}

export async function resetDbForTesting(): Promise<void> {
  if (dbPromise !== null) {
    try {
      const db = await dbPromise;
      await db.closeAsync();
    } catch {
      // tolerated — the db may already be closed in some test scenarios
    }
    dbPromise = null;
  }
}
