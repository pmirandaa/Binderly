import { describe, expect, it } from 'vitest';

import { createRingBuffer } from './ring-buffer.js';

describe('createRingBuffer', () => {
  it('rejects non-positive capacities', () => {
    expect(() => createRingBuffer(0)).toThrow(/positive integer/);
    expect(() => createRingBuffer(-3)).toThrow(/positive integer/);
    expect(() => createRingBuffer(1.5)).toThrow(/positive integer/);
  });

  it('reports zero size and a null `last()` on an empty buffer', () => {
    const buf = createRingBuffer<number>(4);

    expect(buf.size).toBe(0);
    expect(buf.last()).toBeNull();
    expect(buf.snapshot()).toEqual([]);
  });

  it('snapshots in insertion order while under capacity', () => {
    const buf = createRingBuffer<number>(4);

    buf.push(1);
    buf.push(2);
    buf.push(3);

    expect(buf.size).toBe(3);
    expect(buf.snapshot()).toEqual([1, 2, 3]);
    expect(buf.last()).toBe(3);
  });

  it('evicts the oldest entry once capacity is full', () => {
    const buf = createRingBuffer<number>(3);

    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);

    expect(buf.size).toBe(3);
    expect(buf.snapshot()).toEqual([3, 4, 5]);
    expect(buf.last()).toBe(5);
  });

  it('returns a fresh array from `snapshot()` each call', () => {
    const buf = createRingBuffer<number>(2);
    buf.push(1);
    buf.push(2);

    const first = buf.snapshot();
    const second = buf.snapshot();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('drops all entries on `clear()`', () => {
    const buf = createRingBuffer<number>(2);
    buf.push(1);
    buf.push(2);

    buf.clear();

    expect(buf.size).toBe(0);
    expect(buf.last()).toBeNull();
    expect(buf.snapshot()).toEqual([]);
  });

  it('exposes a stable `capacity` getter', () => {
    const buf = createRingBuffer<number>(5);
    expect(buf.capacity).toBe(5);
    buf.push(1);
    expect(buf.capacity).toBe(5);
  });
});
