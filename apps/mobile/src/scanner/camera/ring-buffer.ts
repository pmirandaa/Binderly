// Generic typed ring buffer.
//
// Used by:
//   - `frame-telemetry.ts` to hold the most recent N frame
//     timestamps for the sliding-window FPS estimator.
//   - `stack-mode.ts` to hold the most recent N stack-mode samples
//     for the reset-window decision (T-SC-DETECT will swap the
//     stub algorithm in without changing this seam).
//
// The buffer is intentionally tiny — no dependencies, no lazy
// resizing, no allocations in the hot path beyond the backing
// array.

export interface RingBuffer<T> {
  /** Maximum number of entries retained. Immutable for the lifetime of the buffer. */
  readonly capacity: number;
  /** Current number of stored entries (0 to {@link capacity}). */
  readonly size: number;
  /** Push a new entry; evicts the oldest entry when full. */
  push(entry: T): void;
  /**
   * Snapshot the buffer in **insertion order** (oldest first,
   * newest last). Returns a fresh array each call so callers can
   * iterate without worrying about mid-iteration mutation from a
   * worklet-driven `push()`.
   */
  snapshot(): readonly T[];
  /** Most recently inserted entry, or `null` when empty. */
  last(): T | null;
  /** Drop all entries. */
  clear(): void;
}

/**
 * Build a new ring buffer with the given fixed capacity. Throws if
 * `capacity` is non-positive — a zero-capacity buffer is never the
 * intent and silently turning it into a noop would mask bugs.
 */
export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(
      `createRingBuffer: capacity must be a positive integer, received ${capacity}`,
    );
  }

  // Backing slots. We track `head` (next write index, modulo cap)
  // and `count` (how many of the `capacity` slots are populated)
  // separately so a full buffer is distinguishable from an empty
  // buffer (without the classic +1 trick).
  const slots: Array<T | undefined> = new Array<T | undefined>(capacity).fill(
    undefined,
  );
  let head = 0;
  let count = 0;

  return {
    capacity,
    get size(): number {
      return count;
    },
    push(entry: T): void {
      slots[head] = entry;
      head = (head + 1) % capacity;
      if (count < capacity) count += 1;
    },
    snapshot(): readonly T[] {
      const out: T[] = [];
      if (count === 0) return out;
      const start = (head - count + capacity) % capacity;
      for (let i = 0; i < count; i += 1) {
        const idx = (start + i) % capacity;
        const value = slots[idx];
        if (value !== undefined) out.push(value);
      }
      return out;
    },
    last(): T | null {
      if (count === 0) return null;
      const idx = (head - 1 + capacity) % capacity;
      const value = slots[idx];
      return value === undefined ? null : value;
    },
    clear(): void {
      for (let i = 0; i < capacity; i += 1) {
        slots[i] = undefined;
      }
      head = 0;
      count = 0;
    },
  };
}
