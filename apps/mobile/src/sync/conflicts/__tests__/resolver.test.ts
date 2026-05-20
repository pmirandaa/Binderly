// resolver.test.ts — the heart of T-OF-CONFLICTS. Covers every
// (op_type, server_state) cell of the resolution matrix plus
// idempotency + event emission.

import { describe, expect, it, vi } from 'vitest';

import { customCollectionRepo } from '../../../repositories/CustomCollectionRepository.js';
import { smartCollectionRepo } from '../../../repositories/SmartCollectionRepository.js';
import { userCollectionRepo } from '../../../repositories/UserCollectionRepository.js';
import { syncQueueRepo } from '../../queue/SyncQueueRepository.js';
import { createConflictEventEmitter } from '../event-emitter.js';
import { syncConflictLogRepo } from '../log-repository.js';
import { ConflictResolver } from '../resolver.js';
import {
  NOW,
  ccPayload,
  cciPayload,
  makeDeadLetterEvent,
  scPayload,
  serverCc,
  serverCci,
  serverSc,
  serverUci,
  uciPayload,
  installFreshDb,
} from './_helpers.js';

import type {
  ConflictLogEntry,
  ConflictResolvedEvent,
  ServerFetchResult,
  ServerFetcher,
} from '../types.js';


installFreshDb();

function fakeFetcher(result: ServerFetchResult): ServerFetcher {
  return { fetch: vi.fn(async () => result) };
}

function makeResolver(
  result: ServerFetchResult,
  options: {
    events?: ReturnType<typeof createConflictEventEmitter>;
    nowOverride?: Date;
  } = {},
): { resolver: ConflictResolver; events: ReturnType<typeof createConflictEventEmitter>; ids: string[] } {
  const events = options.events ?? createConflictEventEmitter();
  const ids: string[] = [];
  const resolver = new ConflictResolver({
    serverFetcher: fakeFetcher(result),
    events,
    now: () => options.nowOverride ?? new Date('2026-06-01T12:00:00.000Z'),
    idGenerator: () => {
      const id = `cl-${ids.length + 1}`;
      ids.push(id);
      return id;
    },
  });
  return { resolver, events, ids };
}

// =============================================================================
// LOCAL WINS (404 + create)
// =============================================================================

describe('resolve — server 404 + op=created → local_won (re-enqueue)', () => {
  it('records a local_won entry', async () => {
    const { resolver } = makeResolver({ kind: 'not_found' });
    const event = makeDeadLetterEvent({
      id: 'q-1',
      tableName: 'user_collection_item',
      opType: 'created',
      payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T11:00:00.000Z' })),
    });
    const entry = await resolver.resolve(event);
    expect(entry.resolution).toBe('local_won');
    expect(entry.tableName).toBe('user_collection_item');
    expect(entry.entityId).toBe('uci-1');
    expect(entry.opType).toBe('created');
    expect(entry.serverPayloadJson).toBeNull();
    expect(entry.localUpdatedAt).toBe('2026-06-01T11:00:00.000Z');
  });

  it('re-enqueues the original payload into sync_queue', async () => {
    // Seed the original failed row so markDone has something to delete.
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'created', JSON.stringify(uciPayload({ id: 'uci-1' })), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed', attempts=10 WHERE id='q-1'`);

    const { resolver } = makeResolver({ kind: 'not_found' });
    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        tableName: 'user_collection_item',
        opType: 'created',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    // The original 'failed' row should be gone, a new 'pending' row created.
    const all = await syncQueueRepo.findAll();
    expect(all.find((r) => r.id === 'q-1')).toBeUndefined();
    const pending = all.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.opType).toBe('created');
    expect(pending[0]?.tableName).toBe('user_collection_item');
  });

  it('appends a sync_conflict_log row', async () => {
    const { resolver } = makeResolver({ kind: 'not_found' });
    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'created',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    expect(await syncConflictLogRepo.count()).toBe(1);
  });

  it('emits a ConflictResolvedEvent with the new entry', async () => {
    const events = createConflictEventEmitter();
    const observer = vi.fn();
    events.onConflictResolved(observer);
    const { resolver } = makeResolver({ kind: 'not_found' }, { events });
    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-x',
        opType: 'created',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    expect(observer).toHaveBeenCalledTimes(1);
    const arg = observer.mock.calls[0]?.[0] as ConflictResolvedEvent;
    expect(arg.entry.resolution).toBe('local_won');
  });
});

// =============================================================================
// SERVER WON DELETED (404 + update/delete)
// =============================================================================

describe('resolve — server 404 + op=updated → server_won_deleted', () => {
  it('records a server_won_deleted entry', async () => {
    const { resolver } = makeResolver({ kind: 'not_found' });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T11:00:00.000Z' })),
      }),
    );
    expect(entry.resolution).toBe('server_won_deleted');
    expect(entry.serverPayloadJson).toBeNull();
  });

  it('purges the local row', async () => {
    await userCollectionRepo.upsert({
      id: 'uci-1',
      userId: 'user-1',
      printingId: 'p-1',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload({ id: 'uci-1' })), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);

    const { resolver } = makeResolver({ kind: 'not_found' });
    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    expect(await userCollectionRepo.findById('uci-1')).toBeNull();
  });

  it('deletes the dead-letter row from sync_queue', async () => {
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload()), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);

    const { resolver } = makeResolver({ kind: 'not_found' });
    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(await syncQueueRepo.findById('q-1')).toBeNull();
  });
});

describe('resolve — server 404 + op=deleted → server_won_deleted', () => {
  it('records a server_won_deleted entry (delete + server-already-gone is consistent)', async () => {
    const { resolver } = makeResolver({ kind: 'not_found' });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'deleted',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    expect(entry.resolution).toBe('server_won_deleted');
  });
});

// =============================================================================
// LWW: LOCAL NEWER
// =============================================================================

describe('resolve — server found + local newer → local_won', () => {
  it('updated op with local newer → local_won + re-enqueue', async () => {
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z' })), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);

    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z' })),
      }),
    );
    expect(entry.resolution).toBe('local_won');
    expect(entry.serverUpdatedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(entry.localUpdatedAt).toBe('2026-06-01T13:00:00.000Z');
    const pending = (await syncQueueRepo.findAll()).filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
  });

  it('local_won captures the server payload in serverPayloadJson for audit', async () => {
    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ updatedAt: '2026-06-01T13:00:00.000Z' })),
      }),
    );
    expect(entry.serverPayloadJson).not.toBeNull();
    expect(JSON.parse(entry.serverPayloadJson!)).toEqual(serverPayload);
  });
});

// =============================================================================
// LWW: SERVER NEWER OR TIED
// =============================================================================

describe('resolve — server found + server newer → server_won', () => {
  it('records a server_won entry', async () => {
    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z', quantity: 7 });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
      }),
    );
    expect(entry.resolution).toBe('server_won');
    expect(entry.serverUpdatedAt).toBe('2026-06-01T13:00:00.000Z');
  });

  it('overwrites the local row with server state', async () => {
    await userCollectionRepo.upsert({
      id: 'uci-1',
      userId: 'user-1',
      printingId: 'p-1',
      quantity: 1,
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      syncStatus: 'pending_update',
    });
    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z', quantity: 7 });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
      }),
    );
    const after = await userCollectionRepo.findById('uci-1');
    expect(after?.quantity).toBe(7);
    expect(after?.syncStatus).toBe('synced');
  });

  it('emits a ConflictResolvedEvent for the server_won outcome (UX trigger)', async () => {
    const events = createConflictEventEmitter();
    const observer = vi.fn();
    events.onConflictResolved(observer);
    const { resolver } = makeResolver(
      {
        kind: 'found',
        payload: serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z' }),
        updatedAt: '2026-06-01T13:00:00.000Z',
      },
      { events },
    );
    await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
      }),
    );
    expect(observer).toHaveBeenCalledTimes(1);
    const arg = observer.mock.calls[0]?.[0] as ConflictResolvedEvent;
    expect(arg.entry.resolution).toBe('server_won');
  });
});

describe('resolve — server found + exact tie → server_won', () => {
  it('ties go to the server (conservative)', async () => {
    const ts = '2026-06-01T12:00:00.000Z';
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverUci({ id: 'uci-1', updatedAt: ts }),
      updatedAt: ts,
    });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: ts })),
      }),
    );
    expect(entry.resolution).toBe('server_won');
  });
});

describe('resolve — custom_collection / smart_collection variants', () => {
  it('server_won on custom_collection overwrites the local row', async () => {
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'local',
      slug: 'local',
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    const serverPayload = serverCc({ id: 'cc-1', name: 'server', updatedAt: '2026-06-01T13:00:00.000Z' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    await resolver.resolve(
      makeDeadLetterEvent({
        tableName: 'custom_collection',
        opType: 'updated',
        payloadJson: JSON.stringify(ccPayload({ id: 'cc-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
      }),
    );
    const after = await customCollectionRepo.findById('cc-1');
    expect(after?.name).toBe('server');
  });

  it('local_won on smart_collection re-enqueues with same op_type', async () => {
    const serverPayload = serverSc({ id: 'sc-1', updatedAt: '2026-06-01T11:00:00.000Z' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    await syncQueueRepo.enqueue('q-1', 'smart_collection', 'updated', JSON.stringify(scPayload({ id: 'sc-1', updatedAt: '2026-06-01T13:00:00.000Z' })), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);

    await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        tableName: 'smart_collection',
        opType: 'updated',
        payloadJson: JSON.stringify(scPayload({ id: 'sc-1', updatedAt: '2026-06-01T13:00:00.000Z' })),
      }),
    );
    const pending = (await syncQueueRepo.findAll()).filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.opType).toBe('updated');
    expect(pending[0]?.tableName).toBe('smart_collection');
  });
});

describe('resolve — custom_collection_item (no updatedAt → server-wins)', () => {
  it('server-wins applies because both updatedAt are null', async () => {
    await customCollectionRepo.create({
      id: 'cc-1',
      userId: 'user-1',
      name: 'p',
      slug: 'p',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const serverPayload = serverCci({ customCollectionId: 'cc-1', printingId: 'p-1' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: null,
    });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        tableName: 'custom_collection_item',
        opType: 'created',
        payloadJson: JSON.stringify(cciPayload({ customCollectionId: 'cc-1', printingId: 'p-1' })),
      }),
    );
    expect(entry.resolution).toBe('server_won');
    expect(entry.localUpdatedAt).toBeNull();
    expect(entry.serverUpdatedAt).toBeNull();
  });
});

// =============================================================================
// TRANSIENT ERROR
// =============================================================================

describe('resolve — transient_error (5xx / network)', () => {
  it('records a transient_error entry and does NOT touch the queue', async () => {
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload()), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);

    const { resolver } = makeResolver({ kind: 'transient_error', error: '503 service unavailable' });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        id: 'q-1',
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(entry.resolution).toBe('transient_error');
    expect(entry.errorDetail).toBe('503 service unavailable');
    // Queue row should still be there
    const stillThere = await syncQueueRepo.findById('q-1');
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe('failed');
  });

  it('records a transient_error entry with null server fields', async () => {
    const { resolver } = makeResolver({ kind: 'transient_error', error: 'EPIPE' });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(entry.serverPayloadJson).toBeNull();
    expect(entry.serverUpdatedAt).toBeNull();
  });

  it('does NOT apply any local-state change on transient_error', async () => {
    await userCollectionRepo.upsert({
      id: 'uci-1',
      userId: 'user-1',
      printingId: 'p-1',
      quantity: 99,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      syncStatus: 'pending_update',
    });
    const { resolver } = makeResolver({ kind: 'transient_error', error: 'boom' });
    await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
      }),
    );
    const after = await userCollectionRepo.findById('uci-1');
    expect(after?.quantity).toBe(99);
    expect(after?.syncStatus).toBe('pending_update');
  });

  it('still emits a ConflictResolvedEvent for telemetry/debug', async () => {
    const events = createConflictEventEmitter();
    const observer = vi.fn();
    events.onConflictResolved(observer);
    const { resolver } = makeResolver({ kind: 'transient_error', error: 'boom' }, { events });
    await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload()),
      }),
    );
    expect(observer).toHaveBeenCalledTimes(1);
    const arg = observer.mock.calls[0]?.[0] as ConflictResolvedEvent;
    expect(arg.entry.resolution).toBe('transient_error');
  });
});

// =============================================================================
// IDEMPOTENCY
// =============================================================================

describe('resolve — idempotency (resolving the same event twice)', () => {
  it('twice-resolved server_won: only one local row + two log entries', async () => {
    await userCollectionRepo.upsert({
      id: 'uci-1',
      userId: 'user-1',
      printingId: 'p-1',
      quantity: 1,
      createdAt: '2026-06-01T11:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      syncStatus: 'pending_update',
    });
    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z', quantity: 7 });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    const event = makeDeadLetterEvent({
      id: 'q-1',
      opType: 'updated',
      payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
    });
    await resolver.resolve(event);
    await resolver.resolve(event);
    const local = await userCollectionRepo.findById('uci-1');
    expect(local?.quantity).toBe(7);
    expect(await syncConflictLogRepo.count()).toBe(2);
  });

  it('twice-resolved local_won re-enqueues twice (caller decides whether to dedupe)', async () => {
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'created', JSON.stringify(uciPayload({ id: 'uci-1' })), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);

    const { resolver } = makeResolver({ kind: 'not_found' });
    const event = makeDeadLetterEvent({
      id: 'q-1',
      opType: 'created',
      payloadJson: JSON.stringify(uciPayload({ id: 'uci-1' })),
    });
    await resolver.resolve(event);
    await resolver.resolve(event);
    const pending = (await syncQueueRepo.findAll()).filter((r) => r.status === 'pending');
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it('twice-resolved transient_error: queue row still present + two log entries', async () => {
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload()), NOW);
    const db = await import('../../../db/index.js').then((m) => m.getDb());
    await db.runAsync(`UPDATE sync_queue SET status='failed' WHERE id='q-1'`);
    const { resolver } = makeResolver({ kind: 'transient_error', error: 'boom' });
    const event = makeDeadLetterEvent({
      id: 'q-1',
      opType: 'updated',
      payloadJson: JSON.stringify(uciPayload()),
    });
    await resolver.resolve(event);
    await resolver.resolve(event);
    expect(await syncQueueRepo.findById('q-1')).not.toBeNull();
    expect(await syncConflictLogRepo.count()).toBe(2);
  });
});

// =============================================================================
// CRASH-SAFETY (transaction wrapping)
// =============================================================================

describe('resolve — transaction wrapping', () => {
  it('server_won outcome leaves the conflict log entry queryable by entity', async () => {
    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    const entry = await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'updated',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
      }),
    );
    const found = await syncConflictLogRepo.findByEntity('user_collection_item', 'uci-1');
    expect(found.map((r) => r.id)).toContain(entry.id);
  });
});

// =============================================================================
// Returned entry shape (sanity checks)
// =============================================================================

describe('resolve — returned ConflictLogEntry shape', () => {
  it('local_won entry exposes all expected fields', async () => {
    const { resolver } = makeResolver({ kind: 'not_found' });
    const entry: ConflictLogEntry = await resolver.resolve(
      makeDeadLetterEvent({
        opType: 'created',
        payloadJson: JSON.stringify(uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T11:00:00.000Z' })),
      }),
    );
    expect(entry.id).toMatch(/^cl-/);
    expect(entry.tableName).toBe('user_collection_item');
    expect(entry.entityId).toBe('uci-1');
    expect(entry.opType).toBe('created');
    expect(entry.resolution).toBe('local_won');
    expect(entry.localPayloadJson).toContain('uci-1');
    expect(entry.createdAt).toMatch(/2026/);
  });
});

// =============================================================================
// Smart collection: server payload missing expression preserves local
// =============================================================================

describe('resolve — smart_collection server_won preserves local expression when server omits it', () => {
  it('smart-collection server payload without expression keeps local DSL', async () => {
    await smartCollectionRepo.create({
      id: 'sc-1',
      userId: 'user-1',
      name: 'local',
      slug: 'local',
      expression: JSON.stringify({ type: 'fancy' }),
      createdAt: NOW.toISOString(),
      updatedAt: '2026-06-01T11:00:00.000Z',
    });
    const serverPayload = serverSc({ id: 'sc-1', updatedAt: '2026-06-01T13:00:00.000Z' });
    const { resolver } = makeResolver({
      kind: 'found',
      payload: serverPayload,
      updatedAt: '2026-06-01T13:00:00.000Z',
    });
    await resolver.resolve(
      makeDeadLetterEvent({
        tableName: 'smart_collection',
        opType: 'updated',
        payloadJson: JSON.stringify(scPayload({ id: 'sc-1', updatedAt: '2026-06-01T12:00:00.000Z' })),
      }),
    );
    const after = await smartCollectionRepo.findById('sc-1');
    expect(JSON.parse(after!.expression)).toEqual({ type: 'fancy' });
  });
});
