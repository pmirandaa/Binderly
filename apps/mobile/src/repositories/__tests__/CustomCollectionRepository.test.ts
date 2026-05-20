// CustomCollectionRepository tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTesting } from '../../db/index.js';
import { customCollectionRepo } from '../CustomCollectionRepository.js';

import type { CustomCollection, CustomCollectionItem, LocalWriteEvent } from '../types.js';

const USER_ID = 'user-001';
const OTHER_USER = 'user-002';

function makeCollection(overrides: Partial<{
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  syncStatus: CustomCollection['syncStatus'];
}> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'coll-001',
    userId: overrides.userId ?? USER_ID,
    name: overrides.name ?? 'My Collection',
    slug: overrides.slug ?? 'my-collection',
    description: overrides.description ?? null,
    createdAt: now,
    updatedAt: now,
    syncStatus: overrides.syncStatus ?? 'pending_create' as const,
  };
}

describe('CustomCollectionRepository', () => {
  beforeEach(async () => {
    await resetDbForTesting();
  });

  afterEach(async () => {
    await resetDbForTesting();
  });

  // ---- findAll ----

  it('findAll returns empty for a user with no collections', async () => {
    const result = await customCollectionRepo.findAll(USER_ID);
    expect(result).toEqual([]);
  });

  it('findAll returns all collections for a user', async () => {
    await customCollectionRepo.create(makeCollection({ id: 'c1', slug: 's1' }));
    await customCollectionRepo.create(makeCollection({ id: 'c2', slug: 's2' }));
    const result = await customCollectionRepo.findAll(USER_ID);
    expect(result).toHaveLength(2);
  });

  it('findAll excludes other users collections', async () => {
    await customCollectionRepo.create(makeCollection({ id: 'c1', userId: USER_ID }));
    await customCollectionRepo.create(makeCollection({ id: 'c2', userId: OTHER_USER }));
    const result = await customCollectionRepo.findAll(USER_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.userId).toBe(USER_ID);
  });

  // ---- findById ----

  it('findById returns null for non-existent id', async () => {
    expect(await customCollectionRepo.findById('missing')).toBeNull();
  });

  it('findById returns correct collection', async () => {
    await customCollectionRepo.create(makeCollection({ id: 'c-xyz' }));
    const result = await customCollectionRepo.findById('c-xyz');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('c-xyz');
  });

  // ---- findBySlug ----

  it('findBySlug returns null for unknown slug', async () => {
    expect(await customCollectionRepo.findBySlug(USER_ID, 'unknown')).toBeNull();
  });

  it('findBySlug returns matching collection', async () => {
    await customCollectionRepo.create(makeCollection({ slug: 'holos' }));
    const result = await customCollectionRepo.findBySlug(USER_ID, 'holos');
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('holos');
  });

  it('findBySlug is user-scoped (same slug different user)', async () => {
    await customCollectionRepo.create(makeCollection({ id: 'c1', userId: USER_ID, slug: 'holos' }));
    await customCollectionRepo.create(makeCollection({ id: 'c2', userId: OTHER_USER, slug: 'holos' }));
    const result = await customCollectionRepo.findBySlug(USER_ID, 'holos');
    expect(result!.userId).toBe(USER_ID);
  });

  // ---- create ----

  it('create returns the created collection', async () => {
    const result = await customCollectionRepo.create(makeCollection());
    expect(result.id).toBe('coll-001');
    expect(result.syncStatus).toBe('pending_create');
  });

  it('create persists description', async () => {
    const result = await customCollectionRepo.create(
      makeCollection({ description: 'My fire types' }),
    );
    expect(result.description).toBe('My fire types');
  });

  it('create emits a created event', async () => {
    const events: LocalWriteEvent<CustomCollection | CustomCollectionItem>[] = [];
    const unsub = customCollectionRepo.onLocalWrite((e) => events.push(e));
    await customCollectionRepo.create(makeCollection());
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('created');
    expect(events[0]!.table).toBe('custom_collection');
  });

  // ---- update ----

  it('update returns null for non-existent id', async () => {
    const result = await customCollectionRepo.update('missing', {
      name: 'New Name',
      updatedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it('update changes the name and sets pending_update', async () => {
    await customCollectionRepo.create(makeCollection({ syncStatus: 'synced' }));
    const result = await customCollectionRepo.update('coll-001', {
      name: 'Renamed',
      updatedAt: new Date().toISOString(),
    });
    expect(result!.name).toBe('Renamed');
    expect(result!.syncStatus).toBe('pending_update');
  });

  it('update emits an updated event', async () => {
    await customCollectionRepo.create(makeCollection({ syncStatus: 'synced' }));
    const events: LocalWriteEvent<CustomCollection | CustomCollectionItem>[] = [];
    const unsub = customCollectionRepo.onLocalWrite((e) => events.push(e));
    await customCollectionRepo.update('coll-001', {
      name: 'Updated',
      updatedAt: new Date().toISOString(),
    });
    unsub();
    expect(events[0]!.type).toBe('updated');
  });

  // ---- remove ----

  it('remove is a no-op for a non-existent id', async () => {
    await expect(customCollectionRepo.remove('missing')).resolves.not.toThrow();
  });

  it('remove pending_create collection deletes it immediately', async () => {
    await customCollectionRepo.create(makeCollection({ syncStatus: 'pending_create' }));
    await customCollectionRepo.remove('coll-001');
    expect(await customCollectionRepo.findById('coll-001')).toBeNull();
  });

  it('remove synced collection marks it pending_delete', async () => {
    await customCollectionRepo.create(makeCollection({ syncStatus: 'synced' }));
    await customCollectionRepo.remove('coll-001');
    const result = await customCollectionRepo.findById('coll-001');
    expect(result!.syncStatus).toBe('pending_delete');
  });

  it('remove emits a deleted event', async () => {
    await customCollectionRepo.create(makeCollection());
    const events: LocalWriteEvent<CustomCollection | CustomCollectionItem>[] = [];
    const unsub = customCollectionRepo.onLocalWrite((e) => events.push(e));
    await customCollectionRepo.remove('coll-001');
    unsub();
    expect(events[0]!.type).toBe('deleted');
  });

  // ---- markSynced ----

  it('markSynced sets sync_status and synced_at', async () => {
    await customCollectionRepo.create(makeCollection());
    const syncedAt = new Date().toISOString();
    await customCollectionRepo.markSynced('coll-001', syncedAt);
    const result = await customCollectionRepo.findById('coll-001');
    expect(result!.syncStatus).toBe('synced');
    expect(result!.syncedAt).toBe(syncedAt);
  });

  // ---- findPending ----

  it('findPending returns only non-synced collections', async () => {
    await customCollectionRepo.create(makeCollection({ id: 'c1', slug: 's1', syncStatus: 'synced' }));
    await customCollectionRepo.create(makeCollection({ id: 'c2', slug: 's2', syncStatus: 'pending_create' }));
    const pending = await customCollectionRepo.findPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('c2');
  });

  // ---- items ----

  it('getItems returns empty array for collection with no items', async () => {
    await customCollectionRepo.create(makeCollection());
    const items = await customCollectionRepo.getItems('coll-001');
    expect(items).toEqual([]);
  });

  it('addItem adds a printing to a collection', async () => {
    await customCollectionRepo.create(makeCollection());
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    const items = await customCollectionRepo.getItems('coll-001');
    expect(items).toHaveLength(1);
    expect(items[0]!.printingId).toBe('printing-aaa');
  });

  it('addItem is idempotent (INSERT OR IGNORE)', async () => {
    await customCollectionRepo.create(makeCollection());
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    const items = await customCollectionRepo.getItems('coll-001');
    expect(items).toHaveLength(1);
  });

  it('addItem emits a created event for the item', async () => {
    await customCollectionRepo.create(makeCollection());
    const events: LocalWriteEvent<CustomCollection | CustomCollectionItem>[] = [];
    const unsub = customCollectionRepo.onLocalWrite((e) => events.push(e));
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    unsub();
    const itemEvent = events.find((e) => e.table === 'custom_collection_item');
    expect(itemEvent).toBeDefined();
    expect(itemEvent!.type).toBe('created');
  });

  it('removeItem removes a printing from a collection', async () => {
    await customCollectionRepo.create(makeCollection());
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    await customCollectionRepo.removeItem('coll-001', 'printing-aaa');
    const items = await customCollectionRepo.getItems('coll-001');
    expect(items).toHaveLength(0);
  });

  it('removeItem is a no-op for a non-existent membership', async () => {
    await customCollectionRepo.create(makeCollection());
    await expect(
      customCollectionRepo.removeItem('coll-001', 'nonexistent-printing'),
    ).resolves.not.toThrow();
  });

  it('removeItem emits a deleted event for the item', async () => {
    await customCollectionRepo.create(makeCollection());
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    const events: LocalWriteEvent<CustomCollection | CustomCollectionItem>[] = [];
    const unsub = customCollectionRepo.onLocalWrite((e) => events.push(e));
    await customCollectionRepo.removeItem('coll-001', 'printing-aaa');
    unsub();
    const itemEvent = events.find((e) => e.table === 'custom_collection_item');
    expect(itemEvent!.type).toBe('deleted');
  });

  it('cascade: deleting a collection removes its items', async () => {
    await customCollectionRepo.create(makeCollection({ syncStatus: 'pending_create' }));
    await customCollectionRepo.addItem('coll-001', 'printing-aaa');
    await customCollectionRepo.addItem('coll-001', 'printing-bbb');
    await customCollectionRepo.remove('coll-001');
    // Collection was pending_create so it was hard-deleted
    expect(await customCollectionRepo.findById('coll-001')).toBeNull();
    // Items should also be gone (ON DELETE CASCADE)
    const items = await customCollectionRepo.getItems('coll-001');
    expect(items).toHaveLength(0);
  });
});
