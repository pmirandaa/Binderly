// Module-level warm cache for the embedding model + ANN index (FU-35).
//
// Problem: `useModelLoader` re-runs the full load (TFLite model + ANN
// index decode + GPU-delegate probe) on every `ScanScreen` mount. A
// tab switch or back-navigate therefore pays ~200–400 ms of warmup
// again even though the bundled assets never change within a session.
//
// Fix: a process-scoped singleton cache keyed on the asset identity.
// The first loader for a given key wins; every subsequent mount that
// asks for the same key gets the already-resolved (or in-flight)
// handles synchronously-ish via the shared promise. Both handles stay
// warm across remounts.
//
// Lifetime / eviction decision (v1): **indefinite**. The embedding
// model + flat ANN index are both small and shipped in-bundle, so the
// memory cost is fixed and bounded; there's nothing to evict and no
// cheaper state to fall back to. We deliberately do *not* dispose on
// app-background or low-memory for v1 — re-warming is exactly the cost
// we're trying to avoid, and the OS will reclaim the whole JS heap if
// it kills the app. If a future release ships larger / swappable
// assets, revisit with an LRU keyed on the same asset identity.
//
// This module holds the *only* long-lived reference to the handles, so
// callers that opt into the cache (pass a `warmCacheKey` to
// `useModelLoader`) must NOT dispose the handles on unmount — the cache
// owns their lifetime. Tests call `resetModelWarmCache()` in `afterEach`
// to keep the singleton from leaking warm handles across files.

import type { AnnIndexHandle } from './ann/types.js';
import type { EmbeddingModelHandle } from './embed/types.js';

/** The pair of handles the scanner screen needs to run a match. */
export interface WarmModelHandles {
  readonly embedModel: EmbeddingModelHandle;
  readonly annIndex: AnnIndexHandle;
}

export type WarmModelLoader = () => Promise<WarmModelHandles>;

// key (asset identity) → in-flight or resolved load promise.
const warmCache = new Map<string, Promise<WarmModelHandles>>();

/**
 * Return the cached load for `key`, starting it with `load()` on the
 * first call. Concurrent callers and later remounts share the same
 * promise, so the underlying assets load exactly once per key.
 *
 * A rejected load is evicted so a later mount (or the hook's `retry()`)
 * can re-attempt rather than being stuck with a permanently-failed
 * cache entry.
 */
export function getOrLoadWarmModels(
  key: string,
  load: WarmModelLoader,
): Promise<WarmModelHandles> {
  const existing = warmCache.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const pending = load().catch((error: unknown) => {
    // Only evict if we're still the current entry for this key — a
    // reset + re-load could have replaced us in the meantime.
    if (warmCache.get(key) === pending) {
      warmCache.delete(key);
    }
    throw error;
  });

  warmCache.set(key, pending);
  return pending;
}

/** True when a (resolved or in-flight) entry exists for `key`. */
export function isModelWarm(key: string): boolean {
  return warmCache.has(key);
}

/** Number of distinct keys currently held warm. */
export function modelWarmCacheSize(): number {
  return warmCache.size;
}

export interface ResetModelWarmCacheOptions {
  /**
   * When `true`, dispose each cached handle (after it resolves) before
   * dropping it. Defaults to `false` — a plain reference drop, which is
   * all tests need to avoid cross-file leakage. Production never calls
   * this (the cache is indefinite by design).
   */
  readonly dispose?: boolean;
}

/**
 * Drop every cached entry. Primarily a test hook so the module-scope
 * singleton doesn't leak warm handles across test files; production
 * relies on the indefinite-lifetime policy and never resets.
 */
export function resetModelWarmCache(options?: ResetModelWarmCacheOptions): void {
  if (options?.dispose === true) {
    for (const pending of warmCache.values()) {
      void pending
        .then((handles) => {
          handles.embedModel.dispose();
          handles.annIndex.dispose();
        })
        .catch(() => {
          // The load failed (and was already evicted) — nothing to
          // dispose. Swallow so the reset is always synchronous + total.
        });
    }
  }
  warmCache.clear();
}
