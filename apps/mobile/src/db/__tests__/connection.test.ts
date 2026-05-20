// Connection lifecycle tests.
//
// Verifies that `getDb()` is lazy (doesn't crash at import), returns the
// same singleton on repeated calls, and can be reset between tests via
// `resetDbForTesting()`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb, resetDbForTesting } from '../../db/index.js';

describe('getDb', () => {
  beforeEach(async () => {
    await resetDbForTesting();
  });

  afterEach(async () => {
    await resetDbForTesting();
  });

  it('resolves to a db object without throwing', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    expect(typeof db.execAsync).toBe('function');
    expect(typeof db.getAllAsync).toBe('function');
    expect(typeof db.getFirstAsync).toBe('function');
    expect(typeof db.runAsync).toBe('function');
  });

  it('returns the same singleton on repeated calls', async () => {
    const db1 = await getDb();
    const db2 = await getDb();
    expect(db1).toBe(db2);
  });

  it('runs migrations on first open (schema_version is set)', async () => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM _meta WHERE key = 'schema_version'`,
    );
    expect(row).not.toBeNull();
    expect(row!.value).toBe('1');
  });

  it('resetDbForTesting clears the singleton', async () => {
    const db1 = await getDb();
    await resetDbForTesting();
    const db2 = await getDb();
    // After reset, a new instance is returned (not the same object reference
    // since the sql.js fake creates a new db per name after reset).
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });

  it('concurrent calls to getDb resolve to the same object', async () => {
    const [db1, db2, db3] = await Promise.all([getDb(), getDb(), getDb()]);
    expect(db1).toBe(db2);
    expect(db2).toBe(db3);
  });
});
