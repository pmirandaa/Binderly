// start.test.ts — end-to-end wiring of `startConflictResolver` against
// the live `syncQueueRepo.onDeadLetter` channel + sql.js-backed repos.

import { describe, expect, it, vi } from 'vitest';

import {
  ApiNotFoundError,
  type CollectionResource,
} from '@binderly/api-client';

import { syncQueueRepo } from '../../queue/SyncQueueRepository.js';
import { syncConflictLogRepo } from '../log-repository.js';
import {
  drainPendingDeadLetters,
  startConflictResolver,
} from '../start.js';
import {
  NOW,
  serverUci,
  uciPayload,
  installFreshDb,
} from './_helpers.js';

import type { ServerFetchResult, ServerFetcher } from '../types.js';


installFreshDb();

function stubCollection(overrides: Record<string, unknown> = {}): CollectionResource {
  const base: Record<string, unknown> = {
    listCollectionItems: vi.fn(async () => ({ items: [], nextCursor: null })),
    getCompletion: vi.fn(),
    addCollectionItem: vi.fn(),
    updateCollectionItem: vi.fn(),
    deleteCollectionItem: vi.fn(),
    listCustomCollections: vi.fn(),
    getCustomCollection: vi.fn(),
    createCustomCollection: vi.fn(),
    updateCustomCollection: vi.fn(),
    deleteCustomCollection: vi.fn(),
    listCustomCollectionItems: vi.fn(async () => []),
    addPrintingToCustomCollection: vi.fn(),
    removePrintingFromCustomCollection: vi.fn(),
    getSmartCollectionRule: vi.fn(),
    updateSmartCollectionExpression: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as CollectionResource;
}

function fakeFetcher(result: ServerFetchResult): ServerFetcher {
  return { fetch: vi.fn(async () => result) };
}

/** Wait one microtask tick so the dead-letter observer's async
 *  resolver call has a chance to settle in tests. The resolver itself
 *  awaits everything internally; this gives the test the same window. */
async function nextTick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('startConflictResolver — dead-letter subscription', () => {
  it('returns a stop function', () => {
    const stop = startConflictResolver({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'not_found' }),
    });
    expect(typeof stop).toBe('function');
    stop();
  });

  it('resolves a dead-letter event end-to-end (server_won_deleted)', async () => {
    const stop = startConflictResolver({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'not_found' }),
    });
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload({ id: 'uci-1' })), NOW);
    await syncQueueRepo.markFailed('q-1', 'final');
    await nextTick();
    const all = await syncConflictLogRepo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
    stop();
  });

  it('fires the onResolved observer when configured', async () => {
    const observer = vi.fn();
    const stop = startConflictResolver({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'not_found' }),
      onResolved: observer,
    });
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'created', JSON.stringify(uciPayload()), NOW);
    await syncQueueRepo.markFailed('q-1', 'final');
    await nextTick();
    expect(observer).toHaveBeenCalled();
    stop();
  });

  it('after stop(), new dead-letter events do not fire the observer', async () => {
    const observer = vi.fn();
    const stop = startConflictResolver({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'not_found' }),
      onResolved: observer,
    });
    stop();
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'created', JSON.stringify(uciPayload()), NOW);
    await syncQueueRepo.markFailed('q-1', 'final');
    await nextTick();
    expect(observer).not.toHaveBeenCalled();
  });

  it('uses the default fetcher (api-client) when serverFetcher is not provided', async () => {
    // Wire a real default fetcher backed by a stubbed CollectionResource
    // that returns 404 (ApiNotFoundError) — should resolve as
    // server_won_deleted for an `updated` op.
    const stop = startConflictResolver({
      apiClient: stubCollection({
        listCollectionItems: vi.fn(async () => {
          throw new ApiNotFoundError('not found');
        }),
      }),
    });
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload()), NOW);
    await syncQueueRepo.markFailed('q-1', 'final');
    await nextTick();
    const all = await syncConflictLogRepo.findAll();
    expect(all.find((r) => r.resolution === 'transient_error' || r.resolution === 'server_won_deleted')).toBeDefined();
    stop();
  });

  it('onError fires when resolve throws', async () => {
    const onError = vi.fn();
    const explodingFetcher: ServerFetcher = {
      fetch: vi.fn(async () => {
        throw new Error('synchronous-fetcher-bug');
      }),
    };
    const stop = startConflictResolver({
      apiClient: stubCollection(),
      serverFetcher: explodingFetcher,
      onError,
    });
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(uciPayload()), NOW);
    await syncQueueRepo.markFailed('q-1', 'final');
    await nextTick();
    expect(onError).toHaveBeenCalled();
    stop();
  });
});

describe('drainPendingDeadLetters', () => {
  it('returns an empty array when no failed rows exist', async () => {
    const entries = await drainPendingDeadLetters({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'not_found' }),
    });
    expect(entries).toEqual([]);
  });

  it('resolves every previously-failed row', async () => {
    // Seed two failed rows
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'created', JSON.stringify(uciPayload({ id: 'uci-1' })), NOW);
    await syncQueueRepo.enqueue('q-2', 'user_collection_item', 'created', JSON.stringify(uciPayload({ id: 'uci-2' })), NOW);
    await syncQueueRepo.markFailed('q-1', 'f1');
    await syncQueueRepo.markFailed('q-2', 'f2');
    // Restart with no live observer (simulating an app that just booted)
    const entries = await drainPendingDeadLetters({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'not_found' }),
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.resolution === 'local_won')).toBe(true);
  });

  it('a server_won resolution overwrites local state during drain', async () => {
    const payload = uciPayload({ id: 'uci-1', updatedAt: '2026-06-01T11:00:00.000Z' });
    await syncQueueRepo.enqueue('q-1', 'user_collection_item', 'updated', JSON.stringify(payload), NOW);
    await syncQueueRepo.markFailed('q-1', 'f');
    const serverPayload = serverUci({ id: 'uci-1', updatedAt: '2026-06-01T13:00:00.000Z', quantity: 99 });
    const entries = await drainPendingDeadLetters({
      apiClient: stubCollection(),
      serverFetcher: fakeFetcher({ kind: 'found', payload: serverPayload, updatedAt: '2026-06-01T13:00:00.000Z' }),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.resolution).toBe('server_won');
  });
});
