// Unit tests for the ConflictLogRepo + helper. Driven against the
// in-memory shim so the tests run with no DB dependency.

import { describe, expect, it } from 'vitest';

import {
  dataConflictFromResolverConflict,
  InMemoryConflictLogRepo,
  type RawDataConflict,
} from './conflict-log.js';

import type { DataConflict } from '../types.js';

const FROZEN_NOW = new Date('2026-05-04T20:00:00.000Z');

function rowOf(over: Partial<RawDataConflict> = {}): RawDataConflict {
  return {
    entityKind: 'card',
    entityCanonicalKey: 'en-swsh9-018',
    fieldName: 'name',
    sources: { 'tcgdex-en': 'Charizard VSTAR', ptcgio: 'Charizard V-STAR' },
    keptValue: 'Charizard VSTAR',
    resolution: 'kept_tcgdex-en',
    lastSeenAt: FROZEN_NOW,
    ...over,
  };
}

describe('InMemoryConflictLogRepo', () => {
  it('upsertMany([]) is a no-op (returns 0, no rows added)', async () => {
    const repo = new InMemoryConflictLogRepo();
    const written = await repo.upsertMany([]);
    expect(written).toBe(0);
    expect(repo.size()).toBe(0);
  });

  it('first insert: a single row goes in with disputeCount === 1', async () => {
    const repo = new InMemoryConflictLogRepo();
    const written = await repo.upsertMany([rowOf({})]);
    expect(written).toBe(1);
    expect(repo.size()).toBe(1);
    const stored = repo.list()[0];
    expect(stored).toBeDefined();
    expect(stored?.disputeCount).toBe(1);
    expect(stored?.entityKind).toBe('card');
    expect(stored?.entityCanonicalKey).toBe('en-swsh9-018');
    expect(stored?.fieldName).toBe('name');
    expect(stored?.resolution).toBe('kept_tcgdex-en');
    expect(stored?.keptValue).toBe('Charizard VSTAR');
  });

  it('re-insert against the same triple bumps disputeCount and refreshes lastSeenAt', async () => {
    const repo = new InMemoryConflictLogRepo();
    const earlier = new Date('2026-05-04T20:00:00.000Z');
    const later = new Date('2026-05-04T21:00:00.000Z');

    await repo.upsertMany([rowOf({ lastSeenAt: earlier })]);
    await repo.upsertMany([rowOf({ lastSeenAt: later })]);

    expect(repo.size()).toBe(1);
    const stored = repo.list()[0];
    expect(stored?.disputeCount).toBe(2);
    expect(stored?.lastSeenAt).toEqual(later);
  });

  it('distinct triples produce distinct rows', async () => {
    const repo = new InMemoryConflictLogRepo();
    await repo.upsertMany([
      rowOf({ entityCanonicalKey: 'en-swsh9-018' }),
      rowOf({ entityCanonicalKey: 'en-swsh9-019' }),
      rowOf({ entityCanonicalKey: 'en-swsh9-018', fieldName: 'hp' }),
      rowOf({ entityCanonicalKey: 'en-swsh9-018', entityKind: 'set', fieldName: 'name' }),
    ]);
    expect(repo.size()).toBe(4);
    const all = repo.list();
    for (const row of all) {
      expect(row.disputeCount).toBe(1);
    }
  });

  it('list() returns a stable, sorted view (ergonomic for snapshot tests)', async () => {
    const repo = new InMemoryConflictLogRepo();
    await repo.upsertMany([
      rowOf({ entityKind: 'printing', entityCanonicalKey: 'cccc', fieldName: 'foo' }),
      rowOf({ entityKind: 'card', entityCanonicalKey: 'aaaa', fieldName: 'baz' }),
      rowOf({ entityKind: 'card', entityCanonicalKey: 'aaaa', fieldName: 'bar' }),
      rowOf({ entityKind: 'set', entityCanonicalKey: 'bbbb', fieldName: 'name' }),
    ]);
    const sorted = repo.list().map((r) => `${r.entityKind}|${r.entityCanonicalKey}|${r.fieldName}`);
    expect(sorted).toEqual([
      'card|aaaa|bar',
      'card|aaaa|baz',
      'printing|cccc|foo',
      'set|bbbb|name',
    ]);
  });

  it('mixed batch (insert + update) processes all rows in one upsertMany call', async () => {
    const repo = new InMemoryConflictLogRepo();
    await repo.upsertMany([rowOf({ fieldName: 'name' })]);
    const written = await repo.upsertMany([
      rowOf({ fieldName: 'name' }), // existing → bump
      rowOf({ fieldName: 'hp' }), // new
    ]);
    expect(written).toBe(2);
    expect(repo.size()).toBe(2);
    const byField = new Map(repo.list().map((r) => [r.fieldName, r]));
    expect(byField.get('name')?.disputeCount).toBe(2);
    expect(byField.get('hp')?.disputeCount).toBe(1);
  });
});

describe('dataConflictFromResolverConflict', () => {
  const FIXED = new Date('2026-05-04T20:00:00.000Z');
  const now = (): Date => FIXED;

  it('primary-won: maps chosenSource → resolution = `kept_<source>` and value → keptValue', () => {
    const c: DataConflict = {
      entity: 'card',
      entityKey: 'en-swsh9-018',
      field: 'name',
      sources: { 'tcgdex-en': 'Charizard VSTAR', ptcgio: 'Charizard V-STAR' },
      chosenValue: 'Charizard VSTAR',
      chosenSource: 'tcgdex-en',
    };
    const row = dataConflictFromResolverConflict(c, now);
    expect(row).toEqual({
      entityKind: 'card',
      entityCanonicalKey: 'en-swsh9-018',
      fieldName: 'name',
      sources: { 'tcgdex-en': 'Charizard VSTAR', ptcgio: 'Charizard V-STAR' },
      keptValue: 'Charizard VSTAR',
      resolution: 'kept_tcgdex-en',
      lastSeenAt: FIXED,
    });
  });

  it('__presence: maps chosenSource = "primary" + null value → resolution = "unresolved"', () => {
    const c: DataConflict = {
      entity: 'set',
      entityKey: 'en-someother',
      field: '__presence',
      sources: { 'tcgdex-jp': 'present', primary: 'absent' },
      chosenValue: null,
      chosenSource: 'primary',
    };
    const row = dataConflictFromResolverConflict(c, now);
    expect(row.resolution).toBe('unresolved');
    expect(row.keptValue).toBeNull();
    expect(row.entityKind).toBe('set');
  });

  it('preserves the resolver`s sources map (deep copy, not reference)', () => {
    const sources: Record<string, unknown> = {
      'tcgdex-en': 'X',
      ptcgio: 'Y',
      reason: 'mismatch',
    };
    const c: DataConflict = {
      entity: 'card',
      entityKey: 'en-swsh9-001',
      field: 'hp',
      sources,
      chosenValue: 270,
      chosenSource: 'tcgdex-en',
    };
    const row = dataConflictFromResolverConflict(c, now);
    expect(row.sources).toEqual(sources);
    expect(row.sources).not.toBe(sources); // shallow copy
  });

  it('defaults `now` to a real Date when not provided (smoke)', () => {
    const c: DataConflict = {
      entity: 'card',
      entityKey: 'en-swsh9-002',
      field: 'name',
      sources: { 'tcgdex-en': 'A', ptcgio: 'B' },
      chosenValue: 'A',
      chosenSource: 'tcgdex-en',
    };
    const before = Date.now();
    const row = dataConflictFromResolverConflict(c);
    const after = Date.now();
    expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.lastSeenAt.getTime()).toBeLessThanOrEqual(after);
  });
});
