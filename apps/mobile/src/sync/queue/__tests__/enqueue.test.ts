// enqueue.test.ts — verifies that onLocalWrite events from all 3
// repositories result in sync_queue rows being written.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTesting } from '../../../db/connection.js';
import { getDb } from '../../../db/index.js';
import { customCollectionRepo } from '../../../repositories/CustomCollectionRepository.js';
import { smartCollectionRepo } from '../../../repositories/SmartCollectionRepository.js';
import { userCollectionRepo } from '../../../repositories/UserCollectionRepository.js';
import { __resetSqliteDbs } from '../../../test-utils/setup.js';
import { subscribeAll } from '../enqueue.js';
import { syncQueueRepo } from '../SyncQueueRepository.js';

const NOW = '2026-01-01T00:00:00.000Z';

function makeUci(id = 'uci-1') {
  return {
    id,
    userId: 'user-1',
    printingId: 'print-1',
    quantity: 1,
    condition: 'NEAR_MINT' as const,
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    source: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeCustomCol(id = 'cc-1') {
  return {
    id,
    userId: 'user-1',
    name: 'My Collection',
    slug: 'my-collection',
    description: null,
    coverUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeSmartCol(id = 'sc-1') {
  return {
    id,
    userId: 'user-1',
    name: 'Smart Col',
    slug: 'smart-col',
    description: null,
    expression: JSON.stringify({ type: 'all' }),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

let stopSubscriptions: () => void;

beforeEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
  await getDb(); // run migrations
  stopSubscriptions = subscribeAll();
});

afterEach(async () => {
  stopSubscriptions();
  await resetDbForTesting();
  __resetSqliteDbs();
});

describe('enqueue — UserCollectionRepository', () => {
  it('enqueues a created event on upsert', async () => {
    await userCollectionRepo.upsert(makeUci());
    // Allow the async handler to complete
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.tableName === 'user_collection_item' && r.opType === 'created');
    expect(row).toBeDefined();
  });

  it('queue row has correct table_name and op_type', async () => {
    await userCollectionRepo.upsert(makeUci('uci-table-check'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'user_collection_item');
    expect(row?.tableName).toBe('user_collection_item');
    expect(row?.opType).toBe('created');
  });

  it('queue row payload_json contains the entity id', async () => {
    await userCollectionRepo.upsert(makeUci('uci-payload-check'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find(
      (r) => r.tableName === 'user_collection_item' && r.opType === 'created',
    );
    expect(row).toBeDefined();
    const payload = JSON.parse(row!.payloadJson) as { id: string };
    expect(payload.id).toBe('uci-payload-check');
  });

  it('enqueues an updated event on update', async () => {
    await userCollectionRepo.upsert(makeUci('uci-update'));
    await new Promise((r) => setTimeout(r, 10));
    await userCollectionRepo.update('uci-update', { quantity: 3, updatedAt: NOW });
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const updated = rows.filter(
      (r) => r.tableName === 'user_collection_item' && r.opType === 'updated',
    );
    expect(updated.length).toBeGreaterThanOrEqual(1);
  });

  it('enqueues a deleted event on remove (synced row)', async () => {
    // Upsert with syncStatus='synced' so remove marks for deletion
    await userCollectionRepo.upsert({ ...makeUci('uci-del'), syncStatus: 'synced' });
    await new Promise((r) => setTimeout(r, 10));
    await userCollectionRepo.remove('uci-del');
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const deleted = rows.filter(
      (r) => r.tableName === 'user_collection_item' && r.opType === 'deleted',
    );
    expect(deleted.length).toBeGreaterThanOrEqual(1);
  });

  it('queue row status is pending by default', async () => {
    await userCollectionRepo.upsert(makeUci('uci-pending'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'user_collection_item');
    expect(row?.status).toBe('pending');
  });

  it('queue row attempts is 0 on creation', async () => {
    await userCollectionRepo.upsert(makeUci('uci-attempts'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'user_collection_item');
    expect(row?.attempts).toBe(0);
  });
});

describe('enqueue — CustomCollectionRepository', () => {
  it('enqueues a created event for custom_collection', async () => {
    await customCollectionRepo.create(makeCustomCol());
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'custom_collection' && r.opType === 'created');
    expect(row).toBeDefined();
  });

  it('payload contains the custom_collection id', async () => {
    await customCollectionRepo.create(makeCustomCol('cc-payload'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'custom_collection');
    const payload = JSON.parse(row!.payloadJson) as { id: string };
    expect(payload.id).toBe('cc-payload');
  });

  it('enqueues an updated event on update', async () => {
    await customCollectionRepo.create(makeCustomCol('cc-update'));
    await new Promise((r) => setTimeout(r, 10));
    await customCollectionRepo.update('cc-update', { name: 'Updated', updatedAt: NOW });
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const updated = rows.filter(
      (r) => r.tableName === 'custom_collection' && r.opType === 'updated',
    );
    expect(updated.length).toBeGreaterThanOrEqual(1);
  });

  it('enqueues a deleted event on remove (synced row)', async () => {
    await customCollectionRepo.create({ ...makeCustomCol('cc-del'), syncStatus: 'synced' });
    await new Promise((r) => setTimeout(r, 10));
    await customCollectionRepo.remove('cc-del');
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const deleted = rows.filter(
      (r) => r.tableName === 'custom_collection' && r.opType === 'deleted',
    );
    expect(deleted.length).toBeGreaterThanOrEqual(1);
  });

  it('enqueues a custom_collection_item created event on addItem', async () => {
    await customCollectionRepo.create({ ...makeCustomCol('cc-items'), syncStatus: 'synced' });
    await new Promise((r) => setTimeout(r, 10));
    await customCollectionRepo.addItem('cc-items', 'print-abc');
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find(
      (r) => r.tableName === 'custom_collection_item' && r.opType === 'created',
    );
    expect(row).toBeDefined();
  });

  it('enqueues a custom_collection_item deleted event on removeItem', async () => {
    await customCollectionRepo.create({ ...makeCustomCol('cc-item-del'), syncStatus: 'synced' });
    await customCollectionRepo.addItem('cc-item-del', 'print-xyz');
    await new Promise((r) => setTimeout(r, 10));
    await customCollectionRepo.removeItem('cc-item-del', 'print-xyz');
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find(
      (r) => r.tableName === 'custom_collection_item' && r.opType === 'deleted',
    );
    expect(row).toBeDefined();
  });
});

describe('enqueue — SmartCollectionRepository', () => {
  it('enqueues a created event for smart_collection', async () => {
    await smartCollectionRepo.create(makeSmartCol());
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'smart_collection' && r.opType === 'created');
    expect(row).toBeDefined();
  });

  it('payload contains smart_collection id + expression', async () => {
    await smartCollectionRepo.create(makeSmartCol('sc-payload'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const row = rows.find((r) => r.tableName === 'smart_collection');
    const payload = JSON.parse(row!.payloadJson) as { id: string; expression: string };
    expect(payload.id).toBe('sc-payload');
    expect(payload.expression).toBeTruthy();
  });

  it('enqueues an updated event on update', async () => {
    await smartCollectionRepo.create(makeSmartCol('sc-update'));
    await new Promise((r) => setTimeout(r, 10));
    await smartCollectionRepo.update('sc-update', { name: 'Updated Smart', updatedAt: NOW });
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const updated = rows.filter(
      (r) => r.tableName === 'smart_collection' && r.opType === 'updated',
    );
    expect(updated.length).toBeGreaterThanOrEqual(1);
  });

  it('enqueues a deleted event on remove (synced smart collection)', async () => {
    await smartCollectionRepo.create({ ...makeSmartCol('sc-del'), syncStatus: 'synced' });
    await new Promise((r) => setTimeout(r, 10));
    await smartCollectionRepo.remove('sc-del');
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    const deleted = rows.filter(
      (r) => r.tableName === 'smart_collection' && r.opType === 'deleted',
    );
    expect(deleted.length).toBeGreaterThanOrEqual(1);
  });
});

describe('subscribeAll — cleanup', () => {
  it('unsubscribing stops future enqueues', async () => {
    stopSubscriptions(); // unsubscribe immediately
    await userCollectionRepo.upsert(makeUci('uci-after-unsub'));
    await new Promise((r) => setTimeout(r, 10));
    const rows = await syncQueueRepo.findAll();
    expect(rows.length).toBe(0);
  });
});
