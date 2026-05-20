// replay.test.ts — replay engine tests.
//
// Covers:
//  - SyncQueueRepository CRUD (enqueue, popNext, markDone, markAttempted, markFailed)
//  - Exponential backoff computation
//  - Dead-letter after MAX_ATTEMPTS
//  - ReplayEngine: success, 4xx, 5xx, network-error, idempotency
//  - Translator: correct api-client call per (table, op_type)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiNetworkError,
  ApiRateLimitError,
  ApiServerError,
  ApiValidationError,
  type CollectionResource,
} from '@binderly/api-client';

import { resetDbForTesting } from '../../../db/connection.js';
import { getDb } from '../../../db/index.js';
import { userCollectionRepo } from '../../../repositories/UserCollectionRepository.js';
import { __resetSqliteDbs } from '../../../test-utils/setup.js';
import { ReplayEngine } from '../ReplayEngine.js';
import { syncQueueRepo } from '../SyncQueueRepository.js';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  MAX_ATTEMPTS,
  computeNextAttemptAt,
} from '../types.js';

// ---- Helpers ----

const NOW = new Date('2026-01-01T00:00:00.000Z');

function mockCollection(overrides: Partial<CollectionResource> = {}): CollectionResource {
  return {
    listCollectionItems: vi.fn(),
    getCompletion: vi.fn(),
    addCollectionItem: vi.fn(async () => ({
      id: 'server-id',
      printingId: 'print-1',
      userId: 'user-1',
      quantity: 1,
      condition: 'NEAR_MINT',
      gradeCompany: null,
      grade: null,
      acquiredAt: null,
      acquiredPrice: null,
      acquiredCurrency: null,
      notes: null,
      source: 'manual',
      syncStatus: 'synced',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    updateCollectionItem: vi.fn(async () => ({
      id: 'server-id',
      printingId: 'print-1',
      userId: 'user-1',
      quantity: 2,
      condition: 'NEAR_MINT',
      gradeCompany: null,
      grade: null,
      acquiredAt: null,
      acquiredPrice: null,
      acquiredCurrency: null,
      notes: null,
      source: 'manual',
      syncStatus: 'synced',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    deleteCollectionItem: vi.fn(async () => undefined),
    listCustomCollections: vi.fn(),
    getCustomCollection: vi.fn(),
    createCustomCollection: vi.fn(async () => ({
      id: 'cc-server-id',
      userId: 'user-1',
      kind: 'manual',
      name: 'Test',
      slug: 'test',
      description: null,
      coverUrl: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    updateCustomCollection: vi.fn(async () => ({
      id: 'cc-server-id',
      userId: 'user-1',
      kind: 'manual',
      name: 'Updated',
      slug: 'updated',
      description: null,
      coverUrl: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    deleteCustomCollection: vi.fn(async () => undefined),
    listCustomCollectionItems: vi.fn(),
    addPrintingToCustomCollection: vi.fn(async () => ({
      customCollectionId: 'cc-1',
      printingId: 'print-1',
      addedAt: NOW.toISOString(),
    })),
    removePrintingFromCustomCollection: vi.fn(async () => undefined),
    getSmartCollectionRule: vi.fn(),
    updateSmartCollectionExpression: vi.fn(async () => ({
      customCollectionId: 'sc-1',
      expression: { type: 'all' },
    })),
    ...overrides,
  } as unknown as CollectionResource;
}

function uciPayload(id = 'uci-1') {
  return {
    id,
    userId: 'user-1',
    printingId: 'print-1',
    quantity: 1,
    condition: 'NEAR_MINT',
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    source: 'manual',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncedAt: null,
    syncStatus: 'pending_create',
  };
}

beforeEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
  await getDb();
});

afterEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
});

// ---- SyncQueueRepository CRUD ----

describe('SyncQueueRepository.enqueue', () => {
  it('creates a pending row', async () => {
    const row = await syncQueueRepo.enqueue(
      'q-1',
      'user_collection_item',
      'created',
      JSON.stringify(uciPayload()),
      NOW,
    );
    expect(row.id).toBe('q-1');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.tableName).toBe('user_collection_item');
    expect(row.opType).toBe('created');
  });

  it('INSERT OR IGNORE is idempotent (same id twice)', async () => {
    await syncQueueRepo.enqueue('q-dupe', 'user_collection_item', 'created', '{}', NOW);
    await syncQueueRepo.enqueue('q-dupe', 'user_collection_item', 'created', '{}', NOW);
    const all = await syncQueueRepo.findAll();
    expect(all.filter((r) => r.id === 'q-dupe')).toHaveLength(1);
  });

  it('next_attempt_at equals created_at on first enqueue (immediate replay)', async () => {
    const row = await syncQueueRepo.enqueue('q-immediate', 'custom_collection', 'created', '{}', NOW);
    expect(row.nextAttemptAt).toBe(row.createdAt);
  });
});

describe('SyncQueueRepository.popNext', () => {
  it('returns null when queue is empty', async () => {
    expect(await syncQueueRepo.popNext(NOW)).toBeNull();
  });

  it('returns the oldest ready row', async () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-01-01T01:00:00.000Z');
    await syncQueueRepo.enqueue('q-later', 'custom_collection', 'created', '{}', later);
    await syncQueueRepo.enqueue('q-earlier', 'user_collection_item', 'created', '{}', earlier);
    const row = await syncQueueRepo.popNext(new Date('2026-01-01T02:00:00.000Z'));
    expect(row?.id).toBe('q-earlier');
  });

  it('does not return rows whose next_attempt_at is in the future', async () => {
    const future = new Date(NOW.getTime() + 60_000);
    const rowData = await syncQueueRepo.enqueue('q-future', 'custom_collection', 'created', '{}', NOW);
    // Manually push next_attempt_at into the future
    const db = await getDb();
     
    await (db as any).runAsync(
      `UPDATE sync_queue SET next_attempt_at = ? WHERE id = ?`,
      [future.toISOString(), rowData.id],
    );
    const result = await syncQueueRepo.popNext(NOW);
    expect(result).toBeNull();
  });

  it('does not return failed rows', async () => {
    await syncQueueRepo.enqueue('q-fail', 'custom_collection', 'created', '{}', NOW);
    await syncQueueRepo.markFailed('q-fail', 'hard error');
    const result = await syncQueueRepo.popNext(NOW);
    expect(result).toBeNull();
  });
});

describe('SyncQueueRepository.markDone', () => {
  it('deletes the row', async () => {
    await syncQueueRepo.enqueue('q-done', 'custom_collection', 'created', '{}', NOW);
    await syncQueueRepo.markDone('q-done');
    expect(await syncQueueRepo.findById('q-done')).toBeNull();
  });

  it('is a no-op when row does not exist', async () => {
    await expect(syncQueueRepo.markDone('nonexistent')).resolves.toBeUndefined();
  });
});

describe('SyncQueueRepository.markAttempted', () => {
  it('increments attempts and updates last_error', async () => {
    await syncQueueRepo.enqueue('q-att', 'custom_collection', 'created', '{}', NOW);
    await syncQueueRepo.markAttempted('q-att', 'server error', NOW);
    const row = await syncQueueRepo.findById('q-att');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('server error');
  });

  it('next_attempt_at is in the future after markAttempted', async () => {
    await syncQueueRepo.enqueue('q-backoff', 'custom_collection', 'created', '{}', NOW);
    await syncQueueRepo.markAttempted('q-backoff', 'error', NOW);
    const row = await syncQueueRepo.findById('q-backoff');
    expect(row).not.toBeNull();
    expect(new Date(row!.nextAttemptAt).getTime() > NOW.getTime()).toBe(true);
  });

  it('truncates long error messages to 500 chars', async () => {
    await syncQueueRepo.enqueue('q-long-err', 'custom_collection', 'created', '{}', NOW);
    const longError = 'x'.repeat(600);
    await syncQueueRepo.markAttempted('q-long-err', longError, NOW);
    const row = await syncQueueRepo.findById('q-long-err');
    expect(row?.lastError?.length).toBe(500);
  });

  it('promotes to failed when attempts reaches MAX_ATTEMPTS', async () => {
    await syncQueueRepo.enqueue('q-max', 'custom_collection', 'created', '{}', NOW);
    // Fast-forward to attempt 9
    const db = await getDb();
    await db.runAsync(`UPDATE sync_queue SET attempts = ${MAX_ATTEMPTS - 1} WHERE id = 'q-max'`);
    await syncQueueRepo.markAttempted('q-max', 'final error', NOW);
    const row = await syncQueueRepo.findById('q-max');
    expect(row?.status).toBe('failed');
  });
});

describe('SyncQueueRepository.markFailed', () => {
  it('sets status to failed', async () => {
    await syncQueueRepo.enqueue('q-f', 'custom_collection', 'created', '{}', NOW);
    await syncQueueRepo.markFailed('q-f', 'hard fail');
    const row = await syncQueueRepo.findById('q-f');
    expect(row?.status).toBe('failed');
  });

  it('emits dead-letter event', async () => {
    await syncQueueRepo.enqueue('q-dl', 'custom_collection', 'created', '{}', NOW);
    const events: unknown[] = [];
    const unsub = syncQueueRepo.onDeadLetter((e) => events.push(e));
    await syncQueueRepo.markFailed('q-dl', 'dead!');
    unsub();
    expect(events).toHaveLength(1);
  });

  it('dead-letter event contains the row and error', async () => {
    await syncQueueRepo.enqueue('q-dl2', 'user_collection_item', 'created', '{"id":"uci-1"}', NOW);
     
    let captured: any = null;
    const unsub = syncQueueRepo.onDeadLetter((e) => {
      captured = e;
    });
    await syncQueueRepo.markFailed('q-dl2', 'boom');
    unsub();
     
    expect(captured?.row?.id).toBe('q-dl2');
     
    expect(captured?.finalError).toBe('boom');
  });
});

// ---- Backoff computation ----

describe('computeNextAttemptAt', () => {
  it('attempt 1 → 30 s', () => {
    const next = computeNextAttemptAt(1, NOW);
    const diff = new Date(next).getTime() - NOW.getTime();
    expect(diff).toBe(BACKOFF_BASE_MS * 2);
  });

  it('attempt 0 → 30 s (first backoff)', () => {
    const next = computeNextAttemptAt(0, NOW);
    const diff = new Date(next).getTime() - NOW.getTime();
    expect(diff).toBe(BACKOFF_BASE_MS);
  });

  it('high attempt → capped at 1 h', () => {
    const next = computeNextAttemptAt(20, NOW);
    const diff = new Date(next).getTime() - NOW.getTime();
    expect(diff).toBe(BACKOFF_CAP_MS);
  });

  it('backoff grows exponentially up to cap', () => {
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const next = computeNextAttemptAt(i, NOW);
      delays.push(new Date(next).getTime() - NOW.getTime());
    }
    // Each delay should be >= the previous (monotone up to cap)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
    // None exceeds cap
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(BACKOFF_CAP_MS);
    }
  });
});

// ---- ReplayEngine: success paths ----

describe('ReplayEngine — success', () => {
  it('replays a user_collection_item created row and marks synced', async () => {
    const payload = uciPayload('uci-success');
    // Pre-insert a UCI row as synced so markSynced finds it
    await userCollectionRepo.upsert({ ...payload, syncStatus: 'pending_create' });
    const col = mockCollection();

    await syncQueueRepo.enqueue('q-success', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine = new ReplayEngine(col);
    // Run one tick manually using internal method
    const row = await syncQueueRepo.popNext(NOW);
    expect(row).not.toBeNull();

    // Simulate the engine's replayRow logic via the ReplayEngine start/stop cycle
    // with a very short poll interval — use the public API
    await new Promise<void>((resolve) => {
      const unsub = engine.onStateChange((state) => {
        if (state === 'idle') {
          unsub();
          resolve();
        }
      });
      engine.start();
    });
    engine.stop();

    // Queue row deleted
    expect(await syncQueueRepo.findById('q-success')).toBeNull();
    // addCollectionItem was called
    expect(col.addCollectionItem).toHaveBeenCalledOnce();
  });

  it('replays a custom_collection created row', async () => {
    const payload = {
      id: 'cc-1',
      userId: 'user-1',
      name: 'Faves',
      slug: 'faves',
      description: null,
      coverUrl: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      syncedAt: null,
      syncStatus: 'pending_create',
    };
    const col = mockCollection();
    await syncQueueRepo.enqueue('q-cc-create', 'custom_collection', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub2 = engine2.onStateChange((state) => {
        if (state === 'idle') { unsub2(); resolve(); }
      });
      engine2.start();
    });
    engine2.stop();

    expect(col.createCustomCollection).toHaveBeenCalledOnce();
    expect(await syncQueueRepo.findById('q-cc-create')).toBeNull();
  });

  it('replays a custom_collection_item created row', async () => {
    const payload = { customCollectionId: 'cc-1', printingId: 'print-1', addedAt: NOW.toISOString() };
    const col = mockCollection();
    await syncQueueRepo.enqueue('q-cci', 'custom_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();

    expect(col.addPrintingToCustomCollection).toHaveBeenCalledOnce();
  });

  it('replays a user_collection_item deleted row (calls deleteCollectionItem)', async () => {
    const payload = uciPayload('uci-del');
    const col = mockCollection();
    await syncQueueRepo.enqueue('q-uci-del', 'user_collection_item', 'deleted', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();

    expect(col.deleteCollectionItem).toHaveBeenCalledWith({ id: 'uci-del' });
    expect(await syncQueueRepo.findById('q-uci-del')).toBeNull();
  });
});

// ---- ReplayEngine: error paths ----

describe('ReplayEngine — 4xx non-retryable', () => {
  it('marks row as failed on ApiValidationError (422)', async () => {
    const col = mockCollection({
      addCollectionItem: vi.fn().mockRejectedValue(new ApiValidationError('bad input', { status: 422 })),
    });
    const payload = uciPayload('uci-4xx');
    await syncQueueRepo.enqueue('q-4xx', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();

    const row = await syncQueueRepo.findById('q-4xx');
    expect(row?.status).toBe('failed');
  });

  it('dead-letter fires for 4xx errors', async () => {
    const col = mockCollection({
      addCollectionItem: vi.fn().mockRejectedValue(new ApiValidationError('bad', { status: 422 })),
    });
    const payload = uciPayload('uci-dl');
    await syncQueueRepo.enqueue('q-dl-4xx', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const events: unknown[] = [];
    const unsubDL = syncQueueRepo.onDeadLetter((e) => events.push(e));

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();
    unsubDL();

    expect(events).toHaveLength(1);
  });
});

describe('ReplayEngine — 5xx retryable', () => {
  it('increments attempts on ApiServerError (5xx)', async () => {
    const col = mockCollection({
      addCollectionItem: vi.fn().mockRejectedValue(new ApiServerError('internal', { status: 500 })),
    });
    const payload = uciPayload('uci-5xx');
    await syncQueueRepo.enqueue('q-5xx', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();

    const row = await syncQueueRepo.findById('q-5xx');
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(new Date(row!.nextAttemptAt) > NOW).toBe(true);
  });

  it('increments attempts on ApiRateLimitError (429)', async () => {
    const col = mockCollection({
      addCollectionItem: vi.fn().mockRejectedValue(new ApiRateLimitError('rate limit', { status: 429 })),
    });
    const payload = uciPayload('uci-429');
    await syncQueueRepo.enqueue('q-429', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();

    const row = await syncQueueRepo.findById('q-429');
    expect(row?.attempts).toBe(1);
  });
});

describe('ReplayEngine — network error', () => {
  it('increments attempts on ApiNetworkError', async () => {
    const col = mockCollection({
      addCollectionItem: vi.fn().mockRejectedValue(new ApiNetworkError('offline')),
    });
    const payload = uciPayload('uci-net');
    await syncQueueRepo.enqueue('q-net', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => {
        if (s === 'paused' || s === 'idle') { unsub(); resolve(); }
      });
      engine2.start();
    });
    engine2.stop();

    const row = await syncQueueRepo.findById('q-net');
    expect(row?.attempts).toBe(1);
  });
});

describe('ReplayEngine — idempotency', () => {
  it('after success, queue row is deleted (cannot be replayed again)', async () => {
    const payload = uciPayload('uci-idem');
    await userCollectionRepo.upsert({ ...payload, syncStatus: 'pending_create' as const });
    const col = mockCollection();
    await syncQueueRepo.enqueue('q-idem', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();

    // Row is gone
    expect(await syncQueueRepo.findById('q-idem')).toBeNull();

    // Start engine again with same queue (empty now) — no additional calls.
    // We don't wait for a state transition here because the engine starts
    // already in 'idle' state (no pending rows) so setState('idle') is a
    // no-op. Instead we wait a short time for any async work to settle.
    const engine3 = new ReplayEngine(col);
    const stop3 = engine3.start();
    await new Promise((r) => setTimeout(r, 50));
    stop3();

    // addCollectionItem was only called once total
    expect(col.addCollectionItem).toHaveBeenCalledTimes(1);
  });
});

describe('ReplayEngine — dead-letter after MAX_ATTEMPTS', () => {
  it('marks failed and emits dead-letter after exhausting retries', async () => {
    const col = mockCollection({
      addCollectionItem: vi.fn().mockRejectedValue(new ApiServerError('still down', { status: 503 })),
    });
    const payload = uciPayload('uci-exhausted');
    await syncQueueRepo.enqueue('q-exhausted', 'user_collection_item', 'created', JSON.stringify(payload), NOW);
    // Pre-set attempts to MAX_ATTEMPTS - 1 using parameterized SQL
    const db = await getDb();
     
    await (db as any).runAsync(
      `UPDATE sync_queue SET attempts = ? WHERE id = ?`,
      [MAX_ATTEMPTS - 1, 'q-exhausted'],
    );

    const deadLetters: unknown[] = [];
    const unsubDL = syncQueueRepo.onDeadLetter((e) => deadLetters.push(e));

    const engine2 = new ReplayEngine(col);
    await new Promise<void>((resolve) => {
      const unsub = engine2.onStateChange((s) => { if (s === 'idle') { unsub(); resolve(); } });
      engine2.start();
    });
    engine2.stop();
    unsubDL();

    const row = await syncQueueRepo.findById('q-exhausted');
    expect(row?.status).toBe('failed');
    expect(deadLetters).toHaveLength(1);
  });
});

// ---- Translator tests ----

describe('translate — coverage', () => {
  it('returns null for unknown table', async () => {
    const { translate } = await import('../translator.js');
    const row = await syncQueueRepo.enqueue('q-unknown', 'user_collection_item', 'created', '{}', NOW);
    const badRow = { ...row, tableName: 'unknown_table' as 'user_collection_item' };
    expect(translate(badRow)).toBeNull();
  });

  it('user_collection_item deleted → deleteCollectionItem', async () => {
    const { translate } = await import('../translator.js');
    const payload = uciPayload('uci-translate-del');
    const row = {
      id: 'q-t-del',
      tableName: 'user_collection_item' as const,
      opType: 'deleted' as const,
      payloadJson: JSON.stringify(payload),
      createdAt: NOW.toISOString(),
      attempts: 0,
      lastError: null,
      nextAttemptAt: NOW.toISOString(),
      status: 'pending' as const,
    };
    const result = translate(row);
    expect(result).not.toBeNull();
    expect(result?.entityId).toBeNull(); // deletes don't mark synced
    const col = mockCollection();
    await result!.execute(col);
    expect(col.deleteCollectionItem).toHaveBeenCalledWith({ id: 'uci-translate-del' });
  });

  it('smart_collection created → createCustomCollection with kind=smart', async () => {
    const { translate } = await import('../translator.js');
    const sc = {
      id: 'sc-translate',
      userId: 'user-1',
      name: 'Smart',
      slug: 'smart',
      description: null,
      coverUrl: null,
      expression: JSON.stringify({ type: 'all' }),
      lastEvaluatedAt: null,
      cachedCount: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      syncedAt: null,
      syncStatus: 'pending_create',
    };
    const row = {
      id: 'q-sc-create',
      tableName: 'smart_collection' as const,
      opType: 'created' as const,
      payloadJson: JSON.stringify(sc),
      createdAt: NOW.toISOString(),
      attempts: 0,
      lastError: null,
      nextAttemptAt: NOW.toISOString(),
      status: 'pending' as const,
    };
    const result = translate(row);
    expect(result).not.toBeNull();
    const col = mockCollection();
    await result!.execute(col);
    expect(col.createCustomCollection).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'smart' }),
    );
  });
});

