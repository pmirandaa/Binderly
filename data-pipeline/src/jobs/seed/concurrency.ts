// Tiny concurrency-pool helper — kept inline so we don't add a
// runtime dep (`p-limit` is not in `data-pipeline/package.json`; the
// image-pipeline elaboration mentioned it but the implementation
// ended up not needing it). The contract mirrors `p-limit`'s
// scheduling: each call returns a function that resolves the
// caller's task once a slot is free.
//
// Worth ~30 lines, fully typed, with sequential and parallel paths
// distinguished. The pool is FIFO: tasks are dispatched in the order
// they are submitted.

export interface ConcurrencyPool {
  /** Run `task` when a slot is available; resolve with its result. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Active task count (in-flight + waiting). For tests. */
  readonly pending: number;
  /** Limit (informational; same as the `limit` argument). */
  readonly limit: number;
}

/**
 * Build a FIFO concurrency pool with the given concurrency `limit`.
 *
 * Throws on `limit < 1`. `limit === 1` is a sequential queue; pass it
 * for the DB-write path where order matters and there's no win from
 * parallelism.
 */
export function concurrencyPool(limit: number): ConcurrencyPool {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`concurrencyPool: limit must be a positive integer (got ${limit})`);
  }

  let active = 0;
  const queue: Array<() => void> = [];
  let pending = 0;

  const next = (): void => {
    if (active >= limit) return;
    const resume = queue.shift();
    if (!resume) return;
    active += 1;
    resume();
  };

  return {
    get pending() {
      return pending;
    },
    get limit() {
      return limit;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      pending += 1;
      return new Promise<T>((resolve, reject) => {
        const start = (): void => {
          task()
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              pending -= 1;
              next();
            });
        };
        queue.push(start);
        next();
      });
    },
  };
}
