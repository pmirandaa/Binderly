// Brute-force top-K cosine search.
//
// The catalog embeddings are stored as a single contiguous
// `Float32Array` of length `count * dim`; we scan row-major. We
// maintain a small fixed-size top-K buffer rather than allocating a
// `count`-length score array — that's a measurable win at v1 scale
// and avoids any pressure on the JS GC during continuous scanning.
//
// Catalog rows are L2-normalised (the Python builder enforces this);
// queries are L2-normalised by the embed module before they reach
// us. So cosine ≡ dot product.

import type { AnnSearchResult } from './types';

export class AnnSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnSearchError';
  }
}

/**
 * Top-K cosine search over a flat catalog.
 *
 * @param query     L2-normalised query vector, length `dim`.
 * @param catalog   `count * dim` row-major float32 buffer.
 * @param ids       List of `count` printing ids.
 * @param dim       Embedding dimensionality.
 * @param k         Number of nearest neighbours to return.
 * @param compareTies  Optional id tie-breaker — defaults to ascending.
 */
export function searchKnnFlat(
  query: Float32Array,
  catalog: Float32Array,
  ids: readonly string[],
  dim: number,
  k: number,
  compareTies: (a: string, b: string) => number = defaultIdCompare,
): AnnSearchResult[] {
  if (k <= 0) return [];
  if (query.length !== dim) {
    throw new AnnSearchError(
      `query length ${query.length} disagrees with catalog dim ${dim}`,
    );
  }
  const count = ids.length;
  if (count === 0) return [];
  if (catalog.length !== count * dim) {
    throw new AnnSearchError(
      `catalog buffer length ${catalog.length} disagrees with count*dim = ${count * dim}`,
    );
  }

  const effectiveK = Math.min(k, count);
  // Top-K min-heap-by-score implemented as a sorted-on-insert array.
  // At v1 catalog sizes (~30 k) and k ≤ ~20, the per-step O(k)
  // insertion is cheaper than full heap bookkeeping and is what
  // every other JS top-K library settles on at this scale.
  const top: { id: string; score: number }[] = [];

  for (let row = 0; row < count; row += 1) {
    let score = 0;
    const base = row * dim;
    for (let d = 0; d < dim; d += 1) {
      score += (catalog[base + d] ?? 0) * (query[d] ?? 0);
    }
    const id = ids[row] ?? '';
    if (top.length < effectiveK) {
      insertSorted(top, id, score, compareTies);
    } else if (
      top[top.length - 1] !== undefined &&
      (score > (top[top.length - 1]?.score ?? -Infinity) ||
        (score === (top[top.length - 1]?.score ?? -Infinity) &&
          compareTies(id, top[top.length - 1]?.id ?? '') < 0))
    ) {
      // Better than the current worst — drop tail, insert.
      top.pop();
      insertSorted(top, id, score, compareTies);
    }
  }

  return top.map((entry) => ({
    printingId: entry.id,
    score: entry.score,
    distance: 1 - entry.score,
  }));
}

function defaultIdCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function insertSorted(
  top: { id: string; score: number }[],
  id: string,
  score: number,
  compareTies: (a: string, b: string) => number,
): void {
  // Binary search for the insertion point (descending by score,
  // ascending by tie-break id).
  let lo = 0;
  let hi = top.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const probe = top[mid];
    if (probe === undefined) break;
    // We want the first index where (score, id) would sort *after*
    // the probe — i.e. probe is "better" than us.
    const probeIsBetter =
      probe.score > score ||
      (probe.score === score && compareTies(probe.id, id) < 0);
    if (probeIsBetter) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  top.splice(lo, 0, { id, score });
}
