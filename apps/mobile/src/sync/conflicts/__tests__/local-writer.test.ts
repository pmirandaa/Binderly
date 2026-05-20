// local-writer.test.ts — direct-to-SQLite overwrites bypass repo events.

import { describe, expect, it, vi } from 'vitest';

import { getDb } from '../../../db/index.js';
import { customCollectionRepo } from '../../../repositories/CustomCollectionRepository.js';
import { smartCollectionRepo } from '../../../repositories/SmartCollectionRepository.js';
import { userCollectionRepo } from '../../../repositories/UserCollectionRepository.js';
import {
  applyServerWins,
  applyServerWonDeleted,
} from '../local-writer.js';
import { serverCc, serverCci, serverSc, serverUci, installFreshDb } from './_helpers.js';

installFreshDb();

describe('applyServerWins — user_collection_item', () => {
  it('inserts a server row when local is absent', async () => {
    await applyServerWins(
      'user_collection_item',
      serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z' }),
    );
    const found = await userCollectionRepo.findById('uci-1');
    expect(found?.id).toBe('uci-1');
    expect(found?.syncStatus).toBe('synced');
    expect(found?.updatedAt).toBe('2026-06-01T13:00:00.000Z');
  });

  it('overwrites a pending local row with server state', async () => {
    await userCollectionRepo.upsert({
      id: 'uci-1',
      userId: 'user-1',
      printingId: 'print-1',
      quantity: 1,
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
      syncStatus: 'pending_update',
    });
    await applyServerWins(
      'user_collection_item',
      serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z', quantity: 5 }),
    );
    const found = await userCollectionRepo.findById('uci-1');
    expect(found?.quantity).toBe(5);
    expect(found?.syncStatus).toBe('synced');
  });

  it('does NOT emit a LocalWriteEvent (the repo channel stays silent)', async () => {
    const observer = vi.fn();
    const unsub = userCollectionRepo.onLocalWrite(observer);
    await applyServerWins('user_collection_item', serverUci({ id: 'uci-quiet' }));
    unsub();
    expect(observer).not.toHaveBeenCalled();
  });
});

describe('applyServerWins — custom_collection', () => {
  it('inserts a fresh server row', async () => {
    await applyServerWins('custom_collection', serverCc({ id: 'cc-1', name: 'From Server' }));
    const found = await customCollectionRepo.findById('cc-1');
    expect(found?.name).toBe('From Server');
    expect(found?.syncStatus).toBe('synced');
  });

  it('overwrites a pending local row', async () => {
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'Local Name',
      slug: 'local-name',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWins(
      'custom_collection',
      serverCc({ id: 'cc-1', name: 'Server Name', updatedAt: '2026-06-01T13:00:00.000Z' }),
    );
    const found = await customCollectionRepo.findById('cc-1');
    expect(found?.name).toBe('Server Name');
    expect(found?.syncStatus).toBe('synced');
    expect(found?.updatedAt).toBe('2026-06-01T13:00:00.000Z');
  });

  it('does NOT emit a LocalWriteEvent', async () => {
    const observer = vi.fn();
    const unsub = customCollectionRepo.onLocalWrite(observer);
    await applyServerWins('custom_collection', serverCc({ id: 'cc-quiet' }));
    unsub();
    expect(observer).not.toHaveBeenCalled();
  });
});

describe('applyServerWins — smart_collection', () => {
  it('inserts a fresh smart collection with default expression placeholder', async () => {
    await applyServerWins('smart_collection', serverSc({ id: 'sc-1' }));
    const found = await smartCollectionRepo.findById('sc-1');
    expect(found?.id).toBe('sc-1');
    expect(found?.syncStatus).toBe('synced');
    expect(JSON.parse(found!.expression)).toEqual({ type: 'all' });
  });

  it('preserves a locally-cached expression when server payload omits it', async () => {
    await smartCollectionRepo.create({
      id: 'sc-1',
      userId: 'user-1',
      name: 'local',
      slug: 'local',
      expression: JSON.stringify({ type: 'fancy', n: 7 }),
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWins('smart_collection', serverSc({ id: 'sc-1', name: 'server' }));
    const found = await smartCollectionRepo.findById('sc-1');
    expect(found?.name).toBe('server');
    expect(JSON.parse(found!.expression)).toEqual({ type: 'fancy', n: 7 });
  });

  it('uses server expression when present', async () => {
    await applyServerWins('smart_collection', {
      ...serverSc({ id: 'sc-1' }),
      expression: { type: 'override', n: 99 },
    });
    const found = await smartCollectionRepo.findById('sc-1');
    expect(JSON.parse(found!.expression)).toEqual({ type: 'override', n: 99 });
  });
});

describe('applyServerWins — custom_collection_item', () => {
  it('inserts a membership row', async () => {
    // The schema's FK requires the parent custom_collection to exist.
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'parent',
      slug: 'parent',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWins(
      'custom_collection_item',
      serverCci({ customCollectionId: 'cc-1', printingId: 'p-1' }),
    );
    const db = await getDb();
    const rows = await db.getAllAsync<{ printing_id: string }>(
      `SELECT printing_id FROM custom_collection_item WHERE custom_collection_id = ?`,
      ['cc-1'],
    );
    expect(rows.map((r) => r.printing_id)).toContain('p-1');
  });

  it('INSERT OR REPLACE: same composite key twice is a no-op', async () => {
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'parent',
      slug: 'parent',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWins('custom_collection_item', serverCci({ customCollectionId: 'cc-1', printingId: 'p-dup' }));
    await applyServerWins('custom_collection_item', serverCci({ customCollectionId: 'cc-1', printingId: 'p-dup' }));
    const db = await getDb();
    const rows = await db.getAllAsync<{ printing_id: string }>(
      `SELECT printing_id FROM custom_collection_item WHERE custom_collection_id = 'cc-1' AND printing_id = 'p-dup'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('applyServerWonDeleted', () => {
  it('deletes a user_collection_item row', async () => {
    await userCollectionRepo.upsert({
      id: 'uci-1',
      userId: 'user-1',
      printingId: 'p-1',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWonDeleted('user_collection_item', 'uci-1');
    expect(await userCollectionRepo.findById('uci-1')).toBeNull();
  });

  it('deletes a custom_collection row', async () => {
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'x',
      slug: 'x',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWonDeleted('custom_collection', 'cc-1');
    expect(await customCollectionRepo.findById('cc-1')).toBeNull();
  });

  it('deletes a smart_collection row', async () => {
    await smartCollectionRepo.create({
      id: 'sc-1',
      userId: 'user-1',
      name: 'x',
      slug: 'x',
      expression: JSON.stringify({ type: 'all' }),
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await applyServerWonDeleted('smart_collection', 'sc-1');
    expect(await smartCollectionRepo.findById('sc-1')).toBeNull();
  });

  it('deletes a custom_collection_item composite-keyed row when printingId provided', async () => {
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'p',
      slug: 'p',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await customCollectionRepo.addItem('cc-1', 'p-1');
    await applyServerWonDeleted('custom_collection_item', 'cc-1', 'p-1');
    const items = await customCollectionRepo.getItems('cc-1');
    expect(items).toHaveLength(0);
  });

  it('no-op for missing rows (idempotent)', async () => {
    await expect(applyServerWonDeleted('user_collection_item', 'never')).resolves.toBeUndefined();
  });
});
