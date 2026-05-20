// log-repository.test.ts — typed CRUD over the sync_conflict_log table.

import { describe, expect, it } from 'vitest';

import { syncConflictLogRepo } from '../log-repository.js';
import { NOW, installFreshDb } from './_helpers.js';

import type { ConflictLogEntry } from '../types.js';


installFreshDb();

function sample(overrides: Partial<ConflictLogEntry> = {}): ConflictLogEntry {
  return {
    id: 'cl-1',
    tableName: 'user_collection_item',
    entityId: 'uci-1',
    opType: 'updated',
    resolution: 'server_won',
    localPayloadJson: JSON.stringify({ id: 'uci-1', quantity: 1 }),
    serverPayloadJson: JSON.stringify({ id: 'uci-1', quantity: 5 }),
    localUpdatedAt: '2026-06-01T11:00:00.000Z',
    serverUpdatedAt: '2026-06-01T12:00:00.000Z',
    errorDetail: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('SyncConflictLogRepository.append', () => {
  it('persists a single row', async () => {
    await syncConflictLogRepo.append(sample());
    expect(await syncConflictLogRepo.count()).toBe(1);
  });

  it('persists rows with null server fields (e.g. transient_error)', async () => {
    await syncConflictLogRepo.append(
      sample({
        id: 'cl-tr',
        resolution: 'transient_error',
        serverPayloadJson: null,
        serverUpdatedAt: null,
        errorDetail: '503 service unavailable',
      }),
    );
    const found = await syncConflictLogRepo.findById('cl-tr');
    expect(found?.resolution).toBe('transient_error');
    expect(found?.serverPayloadJson).toBeNull();
    expect(found?.serverUpdatedAt).toBeNull();
    expect(found?.errorDetail).toBe('503 service unavailable');
  });

  it('persists rows for the server_won_deleted resolution', async () => {
    await syncConflictLogRepo.append(
      sample({
        id: 'cl-deleted',
        resolution: 'server_won_deleted',
        serverPayloadJson: null,
        serverUpdatedAt: null,
      }),
    );
    const found = await syncConflictLogRepo.findById('cl-deleted');
    expect(found?.resolution).toBe('server_won_deleted');
  });

  it('persists rows for the local_won resolution', async () => {
    await syncConflictLogRepo.append(sample({ id: 'cl-lw', resolution: 'local_won' }));
    const found = await syncConflictLogRepo.findById('cl-lw');
    expect(found?.resolution).toBe('local_won');
  });

  it('INSERT OR REPLACE: appending twice with same id overwrites', async () => {
    await syncConflictLogRepo.append(sample({ id: 'cl-dup', errorDetail: 'first' }));
    await syncConflictLogRepo.append(
      sample({ id: 'cl-dup', errorDetail: 'second', resolution: 'transient_error' }),
    );
    expect(await syncConflictLogRepo.count()).toBe(1);
    const found = await syncConflictLogRepo.findById('cl-dup');
    expect(found?.resolution).toBe('transient_error');
    expect(found?.errorDetail).toBe('second');
  });
});

describe('SyncConflictLogRepository.findAll', () => {
  it('returns an empty array when table is empty', async () => {
    expect(await syncConflictLogRepo.findAll()).toEqual([]);
  });

  it('orders by created_at ASC then id ASC', async () => {
    await syncConflictLogRepo.append(
      sample({ id: 'cl-a', createdAt: '2026-06-01T12:00:00.000Z' }),
    );
    await syncConflictLogRepo.append(
      sample({ id: 'cl-c', createdAt: '2026-06-01T13:00:00.000Z' }),
    );
    await syncConflictLogRepo.append(
      sample({ id: 'cl-b', createdAt: '2026-06-01T12:00:00.000Z' }),
    );
    const rows = await syncConflictLogRepo.findAll();
    expect(rows.map((r) => r.id)).toEqual(['cl-a', 'cl-b', 'cl-c']);
  });
});

describe('SyncConflictLogRepository.findByEntity', () => {
  it('returns entries for a specific table + entity_id', async () => {
    await syncConflictLogRepo.append(sample({ id: 'cl-1', entityId: 'uci-a' }));
    await syncConflictLogRepo.append(sample({ id: 'cl-2', entityId: 'uci-b' }));
    await syncConflictLogRepo.append(sample({ id: 'cl-3', entityId: 'uci-a' }));
    const found = await syncConflictLogRepo.findByEntity('user_collection_item', 'uci-a');
    expect(found.map((r) => r.id)).toEqual(['cl-1', 'cl-3']);
  });

  it('filters by table even when entity_id collides across tables', async () => {
    await syncConflictLogRepo.append(
      sample({ id: 'cl-x', tableName: 'user_collection_item', entityId: 'shared' }),
    );
    await syncConflictLogRepo.append(
      sample({ id: 'cl-y', tableName: 'custom_collection', entityId: 'shared' }),
    );
    const uci = await syncConflictLogRepo.findByEntity('user_collection_item', 'shared');
    const cc = await syncConflictLogRepo.findByEntity('custom_collection', 'shared');
    expect(uci.map((r) => r.id)).toEqual(['cl-x']);
    expect(cc.map((r) => r.id)).toEqual(['cl-y']);
  });

  it('returns empty array for unknown entity', async () => {
    expect(
      await syncConflictLogRepo.findByEntity('user_collection_item', 'nope'),
    ).toEqual([]);
  });
});

describe('SyncConflictLogRepository.findById', () => {
  it('returns null when not found', async () => {
    expect(await syncConflictLogRepo.findById('missing')).toBeNull();
  });

  it('round-trips the full entry shape', async () => {
    const entry = sample({ id: 'cl-rt' });
    await syncConflictLogRepo.append(entry);
    const found = await syncConflictLogRepo.findById('cl-rt');
    expect(found).toEqual(entry);
  });
});

describe('SyncConflictLogRepository.count', () => {
  it('reports zero when empty', async () => {
    expect(await syncConflictLogRepo.count()).toBe(0);
  });

  it('increments per append', async () => {
    await syncConflictLogRepo.append(sample({ id: 'cl-1' }));
    await syncConflictLogRepo.append(sample({ id: 'cl-2' }));
    await syncConflictLogRepo.append(sample({ id: 'cl-3' }));
    expect(await syncConflictLogRepo.count()).toBe(3);
  });
});
