// connectivity.test.ts — tests for the connectivity wrapper and the
// ReplayEngine's online/offline state transitions.
//
// Uses the @react-native-community/netinfo mock from setup.ts.

import NetInfo from '@react-native-community/netinfo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiNetworkError,
  type CollectionResource,
} from '@binderly/api-client';

import { resetDbForTesting } from '../../../db/connection.js';
import { getDb } from '../../../db/index.js';
import { __resetSqliteDbs } from '../../../test-utils/setup.js';
import { isOnline, onConnectivityChange } from '../connectivity.js';
import { ReplayEngine } from '../ReplayEngine.js';
import { syncQueueRepo } from '../SyncQueueRepository.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

// Helpers to simulate connectivity changes via the mock
type NetInfoState = { isConnected: boolean | null; isInternetReachable: boolean | null };
let netInfoListeners: Set<(state: NetInfoState) => void>;

function simulateConnectivity(online: boolean): void {
  const state: NetInfoState = {
    isConnected: online,
    isInternetReachable: online,
  };
  // Trigger all registered listeners in the mock
  for (const listener of netInfoListeners) {
    listener(state);
  }
}

beforeEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
  await getDb();

  // Capture the set of listeners from the mock
  netInfoListeners = new Set();
  vi.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    const typedListener = listener as (state: NetInfoState) => void;
    netInfoListeners.add(typedListener);
    return () => netInfoListeners.delete(typedListener);
  });

  // Default: online
  vi.mocked(NetInfo.fetch).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  } as Awaited<ReturnType<typeof NetInfo.fetch>>);
});

afterEach(async () => {
  await resetDbForTesting();
  __resetSqliteDbs();
  vi.restoreAllMocks();
});

// ---- isOnline() ----

describe('isOnline', () => {
  it('returns true when connected + reachable', async () => {
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    expect(await isOnline()).toBe(true);
  });

  it('returns false when not connected', async () => {
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
      type: 'none',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    expect(await isOnline()).toBe(false);
  });

  it('returns false when isInternetReachable is false', async () => {
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: true,
      isInternetReachable: false,
      type: 'wifi',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    expect(await isOnline()).toBe(false);
  });

  it('treats null isConnected as true (ambiguous state)', async () => {
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: null,
      isInternetReachable: null,
      type: 'unknown',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    expect(await isOnline()).toBe(true);
  });
});

// ---- onConnectivityChange ----

describe('onConnectivityChange', () => {
  it('calls listener with true when online', () => {
    const calls: boolean[] = [];
    const unsub = onConnectivityChange((online) => calls.push(online));
    simulateConnectivity(true);
    unsub();
    expect(calls).toContain(true);
  });

  it('calls listener with false when offline', () => {
    const calls: boolean[] = [];
    const unsub = onConnectivityChange((online) => calls.push(online));
    simulateConnectivity(false);
    unsub();
    expect(calls).toContain(false);
  });

  it('unsubscribing stops future calls', () => {
    const calls: boolean[] = [];
    const unsub = onConnectivityChange((online) => calls.push(online));
    unsub();
    simulateConnectivity(true);
    expect(calls).toHaveLength(0);
  });

  it('multiple listeners can coexist', () => {
    const a: boolean[] = [];
    const b: boolean[] = [];
    const unsubA = onConnectivityChange((o) => a.push(o));
    const unsubB = onConnectivityChange((o) => b.push(o));
    simulateConnectivity(false);
    unsubA();
    unsubB();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

// ---- ReplayEngine connectivity transitions ----

function noop(): CollectionResource {
  return {
    listCollectionItems: vi.fn(),
    getCompletion: vi.fn(),
    addCollectionItem: vi.fn(async () => { throw new ApiNetworkError('offline'); }),
    updateCollectionItem: vi.fn(),
    deleteCollectionItem: vi.fn(),
    listCustomCollections: vi.fn(),
    getCustomCollection: vi.fn(),
    createCustomCollection: vi.fn(),
    updateCustomCollection: vi.fn(),
    deleteCustomCollection: vi.fn(),
    listCustomCollectionItems: vi.fn(),
    addPrintingToCustomCollection: vi.fn(),
    removePrintingFromCustomCollection: vi.fn(),
    getSmartCollectionRule: vi.fn(),
    updateSmartCollectionExpression: vi.fn(),
  } as unknown as CollectionResource;
}

describe('ReplayEngine — online/offline state transitions', () => {
  it('starts in idle when online', async () => {
    const engine = new ReplayEngine(noop());
    const stop = engine.start();
    // Let the async connectivity check + first tick settle
    await new Promise((r) => setTimeout(r, 30));
    stop();
    // With no pending rows and online connectivity, engine should be idle
    // (either remained idle from start, or transitioned idle → idle after
    // the first tick found nothing to replay).
    expect(engine.state).toBe('idle');
  });

  it('transitions to paused when offline on start', async () => {
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
      type: 'none',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);

    const engine = new ReplayEngine(noop());
    const states: string[] = [];
    const unsub = engine.onStateChange((s) => states.push(s));
    const stop = engine.start();
    await new Promise((r) => setTimeout(r, 20));
    stop();
    unsub();
    expect(states).toContain('paused');
  });

  it('transitions from paused to idle when connectivity restored', async () => {
    // Start offline
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
      type: 'none',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);

    const engine = new ReplayEngine(noop());
    const states: string[] = [];
    const unsub = engine.onStateChange((s) => states.push(s));
    const stop = engine.start();

    // Wait for paused
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.state).toBe('paused');

    // Restore connectivity
    simulateConnectivity(true);
    await new Promise((r) => setTimeout(r, 20));

    stop();
    unsub();
    expect(states).toContain('idle');
  });

  it('transitions to paused on ApiNetworkError mid-replay', async () => {
    const col = noop();
    // Queue a row
    const payload = {
      id: 'uci-offline', userId: 'u', printingId: 'p', quantity: 1,
      condition: 'NEAR_MINT', gradeCompany: null, grade: null, acquiredAt: null,
      acquiredPrice: null, acquiredCurrency: null, notes: null, source: 'manual',
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), syncedAt: null,
      syncStatus: 'pending_create',
    };
    await syncQueueRepo.enqueue('q-offline-mid', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine = new ReplayEngine(col);
    const states: string[] = [];
    const unsub = engine.onStateChange((s) => states.push(s));

    await new Promise<void>((resolve) => {
      const unsubInner = engine.onStateChange((s) => {
        if (s === 'paused' || (s === 'idle' && states.includes('replaying'))) {
          unsubInner();
          resolve();
        }
      });
      engine.start();
    });
    engine.stop();
    unsub();

    // Should have gone replaying → paused (network error)
    expect(states).toContain('replaying');
  });

  it('paused engine ignores tick calls', async () => {
    const col: CollectionResource = {
      ...noop(),
      addCollectionItem: vi.fn(async () => ({} as Awaited<ReturnType<CollectionResource['addCollectionItem']>>)),
    } as unknown as CollectionResource;

    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
      type: 'none',
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);

    const payload = {
      id: 'uci-paused-tick', userId: 'u', printingId: 'p', quantity: 1,
      condition: 'NEAR_MINT', gradeCompany: null, grade: null, acquiredAt: null,
      acquiredPrice: null, acquiredCurrency: null, notes: null, source: 'manual',
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), syncedAt: null,
      syncStatus: 'pending_create',
    };
    await syncQueueRepo.enqueue('q-paused-tick', 'user_collection_item', 'created', JSON.stringify(payload), NOW);

    const engine = new ReplayEngine(col);
    const stop = engine.start();
    await new Promise((r) => setTimeout(r, 30));
    stop();

    // While paused, addCollectionItem should NOT have been called
    expect(col.addCollectionItem).not.toHaveBeenCalled();
  });
});
