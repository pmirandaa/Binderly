// SmartCollectionRepository tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTesting } from '../../db/index.js';
import { smartCollectionRepo } from '../SmartCollectionRepository.js';

import type { LocalWriteEvent, SmartCollection } from '../types.js';

const USER_ID = 'user-001';
const EXPR = JSON.stringify({ type: 'filter', field: 'set', op: 'eq', value: 'base1' });

function makeSmartCollection(overrides: Partial<{
  id: string;
  userId: string;
  name: string;
  slug: string;
  expression: string;
  description: string | null;
  syncStatus: SmartCollection['syncStatus'];
}> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'sc-001',
    userId: overrides.userId ?? USER_ID,
    name: overrides.name ?? 'Base Set Holos',
    slug: overrides.slug ?? 'base-set-holos',
    expression: overrides.expression ?? EXPR,
    description: overrides.description ?? null,
    createdAt: now,
    updatedAt: now,
    syncStatus: overrides.syncStatus ?? 'pending_create' as const,
  };
}

describe('SmartCollectionRepository', () => {
  beforeEach(async () => {
    await resetDbForTesting();
  });

  afterEach(async () => {
    await resetDbForTesting();
  });

  // ---- findAll ----

  it('findAll returns empty for a user with no smart collections', async () => {
    const result = await smartCollectionRepo.findAll(USER_ID);
    expect(result).toEqual([]);
  });

  it('findAll returns all smart collections for a user', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc1', slug: 's1' }));
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc2', slug: 's2' }));
    const result = await smartCollectionRepo.findAll(USER_ID);
    expect(result).toHaveLength(2);
  });

  it('findAll excludes other users collections', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc1', userId: USER_ID }));
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc2', userId: 'other-user' }));
    const result = await smartCollectionRepo.findAll(USER_ID);
    expect(result).toHaveLength(1);
  });

  // ---- findById ----

  it('findById returns null for non-existent id', async () => {
    expect(await smartCollectionRepo.findById('missing')).toBeNull();
  });

  it('findById returns correct collection', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc-xyz' }));
    const result = await smartCollectionRepo.findById('sc-xyz');
    expect(result).not.toBeNull();
    expect(result!.expression).toBe(EXPR);
  });

  // ---- create ----

  it('create returns a collection with pending_create status', async () => {
    const result = await smartCollectionRepo.create(makeSmartCollection());
    expect(result.syncStatus).toBe('pending_create');
    expect(result.lastEvaluatedAt).toBeNull();
    expect(result.cachedCount).toBeNull();
  });

  it('create stores the DSL expression', async () => {
    const expr = JSON.stringify({ type: 'and', children: [] });
    const result = await smartCollectionRepo.create(makeSmartCollection({ expression: expr }));
    expect(result.expression).toBe(expr);
  });

  it('create emits a created event', async () => {
    const events: LocalWriteEvent<SmartCollection>[] = [];
    const unsub = smartCollectionRepo.onLocalWrite((e) => events.push(e));
    await smartCollectionRepo.create(makeSmartCollection());
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('created');
    expect(events[0]!.table).toBe('smart_collection');
  });

  // ---- update ----

  it('update returns null for non-existent id', async () => {
    const result = await smartCollectionRepo.update('missing', {
      name: 'New',
      updatedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it('update changes the name and sets pending_update', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ syncStatus: 'synced' }));
    const result = await smartCollectionRepo.update('sc-001', {
      name: 'Renamed',
      updatedAt: new Date().toISOString(),
    });
    expect(result!.name).toBe('Renamed');
    expect(result!.syncStatus).toBe('pending_update');
  });

  it('update changes the expression', async () => {
    await smartCollectionRepo.create(makeSmartCollection());
    const newExpr = JSON.stringify({ type: 'filter', field: 'rarity', op: 'eq', value: 'holo' });
    const result = await smartCollectionRepo.update('sc-001', {
      expression: newExpr,
      updatedAt: new Date().toISOString(),
    });
    expect(result!.expression).toBe(newExpr);
  });

  it('update emits an updated event', async () => {
    await smartCollectionRepo.create(makeSmartCollection());
    const events: LocalWriteEvent<SmartCollection>[] = [];
    const unsub = smartCollectionRepo.onLocalWrite((e) => events.push(e));
    await smartCollectionRepo.update('sc-001', {
      name: 'Updated',
      updatedAt: new Date().toISOString(),
    });
    unsub();
    expect(events[0]!.type).toBe('updated');
  });

  // ---- remove ----

  it('remove is a no-op for non-existent id', async () => {
    await expect(smartCollectionRepo.remove('missing')).resolves.not.toThrow();
  });

  it('remove a pending_create collection deletes it immediately', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ syncStatus: 'pending_create' }));
    await smartCollectionRepo.remove('sc-001');
    expect(await smartCollectionRepo.findById('sc-001')).toBeNull();
  });

  it('remove a synced collection marks it pending_delete', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ syncStatus: 'synced' }));
    await smartCollectionRepo.remove('sc-001');
    const result = await smartCollectionRepo.findById('sc-001');
    expect(result!.syncStatus).toBe('pending_delete');
  });

  it('remove emits a deleted event', async () => {
    await smartCollectionRepo.create(makeSmartCollection());
    const events: LocalWriteEvent<SmartCollection>[] = [];
    const unsub = smartCollectionRepo.onLocalWrite((e) => events.push(e));
    await smartCollectionRepo.remove('sc-001');
    unsub();
    expect(events[0]!.type).toBe('deleted');
  });

  // ---- markSynced ----

  it('markSynced sets sync_status to synced and stores synced_at', async () => {
    await smartCollectionRepo.create(makeSmartCollection());
    const syncedAt = new Date().toISOString();
    await smartCollectionRepo.markSynced('sc-001', syncedAt);
    const result = await smartCollectionRepo.findById('sc-001');
    expect(result!.syncStatus).toBe('synced');
    expect(result!.syncedAt).toBe(syncedAt);
  });

  // ---- findPending ----

  it('findPending returns only non-synced collections', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc1', slug: 's1', syncStatus: 'synced' }));
    await smartCollectionRepo.create(makeSmartCollection({ id: 'sc2', slug: 's2', syncStatus: 'pending_create' }));
    const pending = await smartCollectionRepo.findPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('sc2');
  });

  // ---- updateEvaluationCache ----

  it('updateEvaluationCache sets cached_count and last_evaluated_at', async () => {
    await smartCollectionRepo.create(makeSmartCollection());
    const evaluatedAt = new Date().toISOString();
    await smartCollectionRepo.updateEvaluationCache('sc-001', 42, evaluatedAt);
    const result = await smartCollectionRepo.findById('sc-001');
    expect(result!.cachedCount).toBe(42);
    expect(result!.lastEvaluatedAt).toBe(evaluatedAt);
  });

  it('updateEvaluationCache does not change sync_status', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ syncStatus: 'synced' }));
    await smartCollectionRepo.updateEvaluationCache('sc-001', 10, new Date().toISOString());
    const result = await smartCollectionRepo.findById('sc-001');
    expect(result!.syncStatus).toBe('synced');
  });

  it('updateEvaluationCache can update count to 0', async () => {
    await smartCollectionRepo.create(makeSmartCollection());
    await smartCollectionRepo.updateEvaluationCache('sc-001', 0, new Date().toISOString());
    const result = await smartCollectionRepo.findById('sc-001');
    expect(result!.cachedCount).toBe(0);
  });

  // ---- onLocalWrite / subscribe ----

  it('onLocalWrite unsubscribe removes the observer', async () => {
    const events: LocalWriteEvent<SmartCollection>[] = [];
    const unsub = smartCollectionRepo.onLocalWrite((e) => events.push(e));
    unsub();
    await smartCollectionRepo.create(makeSmartCollection());
    expect(events).toHaveLength(0);
  });

  it('multiple observers all receive events', async () => {
    const a: LocalWriteEvent<SmartCollection>[] = [];
    const b: LocalWriteEvent<SmartCollection>[] = [];
    const u1 = smartCollectionRepo.onLocalWrite((e) => a.push(e));
    const u2 = smartCollectionRepo.onLocalWrite((e) => b.push(e));
    await smartCollectionRepo.create(makeSmartCollection());
    u1();
    u2();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  // ---- edge cases ----

  it('description can be null', async () => {
    const result = await smartCollectionRepo.create(
      makeSmartCollection({ description: null }),
    );
    expect(result.description).toBeNull();
  });

  it('description can be updated to null', async () => {
    await smartCollectionRepo.create(makeSmartCollection({ description: 'Some desc' }));
    const updated = await smartCollectionRepo.update('sc-001', {
      description: null,
      updatedAt: new Date().toISOString(),
    });
    expect(updated!.description).toBeNull();
  });
});
