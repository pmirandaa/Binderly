// Internal helpers shared across the per-metric modules.
//
// Kept private (NOT re-exported from `index.ts`) so the public
// surface stays minimal — the only two things callers need are the
// `compute*` functions and the result types in `types.ts`.

/**
 * Compute a percentage in the 0..100 range with the
 * "empty-denominator returns 0" semantics documented in the README.
 *
 * Why not propagate NaN: the materialized views the recompute job
 * writes use `numeric(5,2)` columns; `INSERT ... NaN` would fail. The
 * UI also has nothing useful to render for "0/0 = ???". Pinning to 0
 * makes the boundary safe in both directions and is the contract the
 * acceptance criteria pin.
 */
export function safePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

/**
 * Build a `Set<string>` from a possibly-duplicate iterable of ids.
 * Centralized so the dedup posture is consistent across modules
 * (collection items can have duplicate `printingId`s in the wire
 * shape — different conditions / grades / quantities collapse to the
 * same printing for completion math).
 *
 * `Set` constructor handles dedup natively in O(n).
 */
export function uniqueIds(ids: Iterable<string>): Set<string> {
  return new Set(ids);
}
