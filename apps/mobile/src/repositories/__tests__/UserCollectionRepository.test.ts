// UserCollectionRepository tests.
//
// All tests run against the sql.js in-memory SQLite fake (wired in
// `test-utils/setup.ts`). `resetDbForTesting()` is called in
// `beforeEach` so each test starts from a clean schema.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTesting } from '../../db/index.js';
import { userCollectionRepo } from '../UserCollectionRepository.js';

import type { LocalWriteEvent, UserCollectionItem } from '../types.js';

const USER_ID = 'user-001';
const PRINTING_ID_A = 'printing-aaa';
const PRINTING_ID_B = 'printing-bbb';

function makeItem(overrides: Partial<{
  id: string;
  userId: string;
  printingId: string;
  quantity: number;
  condition: string;
  syncStatus: UserCollectionItem['syncStatus'];
}> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'item-001',
    userId: overrides.userId ?? USER_ID,
    printingId: overrides.printingId ?? PRINTING_ID_A,
    quantity: overrides.quantity ?? 1,
    condition: overrides.condition ?? 'NEAR_MINT',
    createdAt: now,
    updatedAt: now,
    syncStatus: overrides.syncStatus ?? 'pending_create' as const,
  };
}

describe('UserCollectionRepository', () => {
  beforeEach(async () => {
    await resetDbForTesting();
  });

  afterEach(async () => {
    await resetDbForTesting();
  });

  // ---- findAll ----

  it('findAll returns empty array for a user with no items', async () => {
    const items = await userCollectionRepo.findAll(USER_ID);
    expect(items).toEqual([]);
  });

  it('findAll returns all items for a user', async () => {
    await userCollectionRepo.upsert(makeItem({ id: 'item-001', printingId: PRINTING_ID_A }));
    await userCollectionRepo.upsert(makeItem({ id: 'item-002', printingId: PRINTING_ID_B }));
    const items = await userCollectionRepo.findAll(USER_ID);
    expect(items).toHaveLength(2);
  });

  it('findAll returns only items for the specified user', async () => {
    await userCollectionRepo.upsert(makeItem({ id: 'item-001', userId: USER_ID }));
    await userCollectionRepo.upsert(makeItem({ id: 'item-002', userId: 'other-user' }));
    const items = await userCollectionRepo.findAll(USER_ID);
    expect(items).toHaveLength(1);
    expect(items[0]!.userId).toBe(USER_ID);
  });

  // ---- findById ----

  it('findById returns null for a non-existent id', async () => {
    const item = await userCollectionRepo.findById('nonexistent');
    expect(item).toBeNull();
  });

  it('findById returns the correct item', async () => {
    await userCollectionRepo.upsert(makeItem({ id: 'item-xyz' }));
    const item = await userCollectionRepo.findById('item-xyz');
    expect(item).not.toBeNull();
    expect(item!.id).toBe('item-xyz');
    expect(item!.userId).toBe(USER_ID);
  });

  // ---- findByPrintingId ----

  it('findByPrintingId returns empty for unknown printing', async () => {
    const items = await userCollectionRepo.findByPrintingId(USER_ID, 'unknown-printing');
    expect(items).toEqual([]);
  });

  it('findByPrintingId returns matching items', async () => {
    await userCollectionRepo.upsert(makeItem({ id: 'item-001', printingId: PRINTING_ID_A }));
    await userCollectionRepo.upsert(makeItem({ id: 'item-002', printingId: PRINTING_ID_A, condition: 'LIGHTLY_PLAYED' }));
    await userCollectionRepo.upsert(makeItem({ id: 'item-003', printingId: PRINTING_ID_B }));
    const items = await userCollectionRepo.findByPrintingId(USER_ID, PRINTING_ID_A);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.printingId === PRINTING_ID_A)).toBe(true);
  });

  // ---- upsert ----

  it('upsert creates a new item with pending_create status', async () => {
    const item = await userCollectionRepo.upsert(makeItem());
    expect(item.syncStatus).toBe('pending_create');
    expect(item.quantity).toBe(1);
  });

  it('upsert replaces an existing item', async () => {
    const now = new Date().toISOString();
    await userCollectionRepo.upsert({ ...makeItem({ id: 'item-001' }), quantity: 1 });
    const updated = await userCollectionRepo.upsert({
      ...makeItem({ id: 'item-001' }),
      quantity: 5,
      updatedAt: now,
    });
    expect(updated.quantity).toBe(5);
  });

  it('upsert respects custom syncStatus when provided', async () => {
    const item = await userCollectionRepo.upsert(makeItem({ syncStatus: 'synced' }));
    expect(item.syncStatus).toBe('synced');
  });

  it('upsert populates optional fields', async () => {
    const now = new Date().toISOString();
    const item = await userCollectionRepo.upsert({
      id: 'item-full',
      userId: USER_ID,
      printingId: PRINTING_ID_A,
      quantity: 3,
      condition: 'LIGHTLY_PLAYED',
      gradeCompany: 'PSA',
      grade: '9.5',
      acquiredAt: '2024-01-15',
      acquiredPrice: '150.00',
      acquiredCurrency: 'USD',
      notes: 'My gem',
      source: 'scan',
      createdAt: now,
      updatedAt: now,
    });
    expect(item.gradeCompany).toBe('PSA');
    expect(item.grade).toBe('9.5');
    expect(item.acquiredAt).toBe('2024-01-15');
    expect(item.quantity).toBe(3);
    expect(item.notes).toBe('My gem');
  });

  it('upsert emits a created event', async () => {
    const events: LocalWriteEvent<UserCollectionItem>[] = [];
    const unsub = userCollectionRepo.onLocalWrite((e) => events.push(e));
    await userCollectionRepo.upsert(makeItem());
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('created');
    expect(events[0]!.table).toBe('user_collection_item');
  });

  it('upsert with printingLite caches the printing', async () => {
    const now = new Date().toISOString();
    await userCollectionRepo.upsert(makeItem(), {
      id: PRINTING_ID_A,
      variantKey: 'en-base1-004-1e',
      cardName: 'Charizard',
      setName: 'Base Set',
      setCode: 'base1',
      imageSmallUrl: 'https://example.com/sm.jpg',
      lastSeenAt: now,
    });
    const lites = await userCollectionRepo.findAllPrintingLite();
    expect(lites).toHaveLength(1);
    expect(lites[0]!.cardName).toBe('Charizard');
  });

  // ---- update ----

  it('update returns null for a non-existent id', async () => {
    const result = await userCollectionRepo.update('nonexistent', {
      quantity: 5,
      updatedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it('update modifies quantity and sets pending_update', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'synced' }));
    const result = await userCollectionRepo.update('item-001', {
      quantity: 10,
      updatedAt: new Date().toISOString(),
    });
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(10);
    expect(result!.syncStatus).toBe('pending_update');
  });

  it('update emits an updated event', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'synced' }));
    const events: LocalWriteEvent<UserCollectionItem>[] = [];
    const unsub = userCollectionRepo.onLocalWrite((e) => events.push(e));
    await userCollectionRepo.update('item-001', {
      quantity: 2,
      updatedAt: new Date().toISOString(),
    });
    unsub();
    expect(events[0]!.type).toBe('updated');
  });

  it('update can null-out nullable fields', async () => {
    const now = new Date().toISOString();
    await userCollectionRepo.upsert({
      ...makeItem(),
      notes: 'Original note',
    });
    const result = await userCollectionRepo.update('item-001', {
      notes: null,
      updatedAt: now,
    });
    expect(result!.notes).toBeNull();
  });

  // ---- remove ----

  it('remove is a no-op for a non-existent id', async () => {
    await expect(userCollectionRepo.remove('nonexistent')).resolves.not.toThrow();
  });

  it('remove a pending_create row deletes it immediately', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'pending_create' }));
    await userCollectionRepo.remove('item-001');
    const item = await userCollectionRepo.findById('item-001');
    expect(item).toBeNull();
  });

  it('remove a synced row marks it pending_delete', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'synced' }));
    await userCollectionRepo.remove('item-001');
    const item = await userCollectionRepo.findById('item-001');
    expect(item).not.toBeNull();
    expect(item!.syncStatus).toBe('pending_delete');
  });

  it('remove emits a deleted event', async () => {
    await userCollectionRepo.upsert(makeItem());
    const events: LocalWriteEvent<UserCollectionItem>[] = [];
    const unsub = userCollectionRepo.onLocalWrite((e) => events.push(e));
    await userCollectionRepo.remove('item-001');
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('deleted');
  });

  // ---- findPending ----

  it('findPending returns empty when all items are synced', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'synced' }));
    const pending = await userCollectionRepo.findPending();
    expect(pending).toHaveLength(0);
  });

  it('findPending returns pending_create items', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'pending_create' }));
    const pending = await userCollectionRepo.findPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.syncStatus).toBe('pending_create');
  });

  it('findPending returns pending_update items', async () => {
    await userCollectionRepo.upsert(makeItem({ syncStatus: 'synced' }));
    await userCollectionRepo.update('item-001', { quantity: 9, updatedAt: new Date().toISOString() });
    const pending = await userCollectionRepo.findPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.syncStatus).toBe('pending_update');
  });

  // ---- markSynced ----

  it('markSynced flips sync_status to synced and stores synced_at', async () => {
    await userCollectionRepo.upsert(makeItem());
    const syncedAt = new Date().toISOString();
    await userCollectionRepo.markSynced('item-001', syncedAt);
    const item = await userCollectionRepo.findById('item-001');
    expect(item!.syncStatus).toBe('synced');
    expect(item!.syncedAt).toBe(syncedAt);
  });

  // ---- onLocalWrite ----

  it('onLocalWrite unsubscribe removes the observer', async () => {
    const events: LocalWriteEvent<UserCollectionItem>[] = [];
    const unsub = userCollectionRepo.onLocalWrite((e) => events.push(e));
    unsub();
    await userCollectionRepo.upsert(makeItem());
    expect(events).toHaveLength(0);
  });

  it('multiple observers all receive events', async () => {
    const events1: LocalWriteEvent<UserCollectionItem>[] = [];
    const events2: LocalWriteEvent<UserCollectionItem>[] = [];
    const unsub1 = userCollectionRepo.onLocalWrite((e) => events1.push(e));
    const unsub2 = userCollectionRepo.onLocalWrite((e) => events2.push(e));
    await userCollectionRepo.upsert(makeItem());
    unsub1();
    unsub2();
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });

  // ---- large dataset ----

  it('handles inserting 100 items without error', async () => {
    const now = new Date().toISOString();
    const promises = Array.from({ length: 100 }, (_, i) =>
      userCollectionRepo.upsert({
        id: `item-${i}`,
        userId: USER_ID,
        printingId: `printing-${i}`,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await Promise.all(promises);
    const items = await userCollectionRepo.findAll(USER_ID);
    expect(items).toHaveLength(100);
  });
});
