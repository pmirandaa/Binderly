// event-emitter.test.ts — UX seam behaviour.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  conflictEvents,
  createConflictEventEmitter,
} from '../event-emitter.js';

import type { ConflictResolvedEvent } from '../types.js';

const SAMPLE: ConflictResolvedEvent = {
  entry: {
    id: 'cl-1',
    tableName: 'user_collection_item',
    entityId: 'uci-1',
    opType: 'updated',
    resolution: 'server_won',
    localPayloadJson: '{}',
    serverPayloadJson: '{}',
    localUpdatedAt: '2026-06-01T12:00:00.000Z',
    serverUpdatedAt: '2026-06-01T12:00:01.000Z',
    errorDetail: null,
    createdAt: '2026-06-01T12:00:02.000Z',
  },
};

afterEach(() => {
  conflictEvents.reset();
});

describe('conflictEvents (singleton)', () => {
  it('fires subscribed observer on emit', () => {
    const observer = vi.fn();
    conflictEvents.onConflictResolved(observer);
    conflictEvents.emit(SAMPLE);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(SAMPLE);
  });

  it('fires all observers in subscription order', () => {
    const calls: string[] = [];
    conflictEvents.onConflictResolved(() => calls.push('a'));
    conflictEvents.onConflictResolved(() => calls.push('b'));
    conflictEvents.onConflictResolved(() => calls.push('c'));
    conflictEvents.emit(SAMPLE);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('unsubscribe handle removes observer', () => {
    const observer = vi.fn();
    const unsub = conflictEvents.onConflictResolved(observer);
    unsub();
    conflictEvents.emit(SAMPLE);
    expect(observer).not.toHaveBeenCalled();
  });

  it('duplicate subscriptions are deduped (Set semantics)', () => {
    const observer = vi.fn();
    conflictEvents.onConflictResolved(observer);
    conflictEvents.onConflictResolved(observer);
    conflictEvents.emit(SAMPLE);
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('observerCount reflects current subscriptions', () => {
    expect(conflictEvents.observerCount()).toBe(0);
    const unsub = conflictEvents.onConflictResolved(vi.fn());
    expect(conflictEvents.observerCount()).toBe(1);
    unsub();
    expect(conflictEvents.observerCount()).toBe(0);
  });

  it('observer that unsubscribes itself mid-emit does not perturb iteration', () => {
    const order: string[] = [];
    let unsubB: () => void = () => undefined;
    conflictEvents.onConflictResolved(() => order.push('a'));
    unsubB = conflictEvents.onConflictResolved(() => {
      order.push('b');
      unsubB();
    });
    conflictEvents.onConflictResolved(() => order.push('c'));
    conflictEvents.emit(SAMPLE);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(conflictEvents.observerCount()).toBe(2);
  });
});

describe('createConflictEventEmitter (isolated)', () => {
  it('returns an instance independent from the singleton', () => {
    const isolated = createConflictEventEmitter();
    const localObserver = vi.fn();
    const singletonObserver = vi.fn();
    isolated.onConflictResolved(localObserver);
    conflictEvents.onConflictResolved(singletonObserver);
    isolated.emit(SAMPLE);
    expect(localObserver).toHaveBeenCalledTimes(1);
    expect(singletonObserver).not.toHaveBeenCalled();
  });

  it('reset clears all observers on the isolated instance', () => {
    const isolated = createConflictEventEmitter();
    isolated.onConflictResolved(vi.fn());
    isolated.onConflictResolved(vi.fn());
    expect(isolated.observerCount()).toBe(2);
    isolated.reset();
    expect(isolated.observerCount()).toBe(0);
  });
});
