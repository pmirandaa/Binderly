// Shared types for the on-device ANN module.
//
// The downstream `T-SC-MATCH` task consumes `AnnIndexHandle.searchKNN`
// to turn a query embedding into a ranked list of catalog printings.
// The handle is owned by the scanner screen; `dispose()` releases the
// large in-memory embedding buffer when the screen unmounts.

import type { EmbeddingManifest } from '@/scanner/embed';

export type AnnDtype = 'float32' | 'float16';
export type AnnFormat = 'flat' | 'hnsw' | 'pq';
export type AnnMetric = 'cosine';

/** One row of a top-K search result, ordered by descending `score`. */
export interface AnnSearchResult {
  /** Catalog `printing.id` (UUID by default). */
  readonly printingId: string;
  /** Cosine similarity in `[-1, 1]`. Larger = more similar. */
  readonly score: number;
  /** `1 - score`, kept here so consumers don't have to derive it. */
  readonly distance: number;
}

/**
 * Options accepted by `loadAnnIndex`.
 *
 * The screen layer is expected to:
 *
 *   1. `require('./index.bin')` to obtain the asset module ID, and
 *      pass the resolved `ArrayBuffer` (e.g. via
 *      `expo-asset`'s `Asset.fromModule(...).localUri`) — or directly
 *      ship the buffer for tests.
 *   2. `require('./index.manifest.json')` and pass the parsed object
 *      verbatim — the loader validates the schema.
 *   3. Optionally pass the loaded `EmbeddingManifest` so the loader
 *      can refuse to pair this index with a mismatched embedding
 *      model.
 */
export interface AnnLoadOptions {
  /** Raw bytes of `index.bin`. */
  readonly indexBuffer: ArrayBuffer;
  /** Parsed contents of `index.manifest.json`. */
  readonly manifest: unknown;
  /**
   * Optional embedding manifest. If provided, the loader refuses to
   * pair this ANN index with a non-matching embedding model
   * (`name` / `version` / `modelHash` must agree).
   */
  readonly embeddingManifest?: EmbeddingManifest | undefined;
  /**
   * Override the default tie-break ordering. The default mirrors the
   * Python reference: descending by score, ties broken by `printingId`
   * ascending. Tests pass their own to exercise the alternative.
   */
  readonly compareTies?: (a: string, b: string) => number;
}

/**
 * Handle returned by `loadAnnIndex`. Owned by the scanner screen;
 * freed via `dispose()` on unmount.
 */
export interface AnnIndexHandle {
  /** Embedding dimensionality the catalog was built against. */
  readonly dim: number;
  /** Number of catalog printings indexed. */
  readonly count: number;
  /** Index format — `'flat'` for v1. */
  readonly format: AnnFormat;
  /** Distance metric — `'cosine'` for v1. */
  readonly metric: AnnMetric;
  /** Storage dtype that was used in the binary file. */
  readonly dtype: AnnDtype;
  /** Index identity (mirrors the manifest). */
  readonly name: string;
  readonly version: string;
  /**
   * Embedding model identity, copied from the index manifest. The
   * downstream `T-SC-MATCH` task cross-checks against the live
   * embedding model handle.
   */
  readonly embeddingModelName: string;
  readonly embeddingModelVersion: string;
  readonly embeddingModelHash: string;

  /**
   * Brute-force cosine top-K. `queryVec` must be L2-normalised and
   * have length `dim`; the loader rejects on mismatch.
   *
   * Returns an array of length `min(k, count)` ordered by
   * descending score. Ties broken by `printingId` ascending
   * (deterministic across runs).
   */
  searchKNN(queryVec: Float32Array, k: number): AnnSearchResult[];

  /** Release the in-memory embedding buffer. Idempotent. */
  dispose(): void;
}
