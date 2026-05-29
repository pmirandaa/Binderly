// Session-store CRUD tests.

import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetSessionStore,
  clearSession,
  getSession,
  sessionStoreSize,
  storeSession,
} from '../session-store.js';

import type { GradingCaptureSession } from '../../capture/types.js';

const okQuality = {
  metrics: { sharpness: 12, brightness: 0.5, coverage: 0.6 },
  sharpnessOK: true,
  brightnessOK: true,
  coverageOK: true,
  accepted: true,
  reason: 'great' as const,
};

function makeShot(kind: GradingCaptureSession['frontFull']['kind']) {
  return {
    kind,
    uri: `file:///tmp/${kind}.jpg`,
    width: 1080,
    height: 1440,
    quality: okQuality,
    capturedAt: 1_700_000_000_000,
  };
}

function makeSession(id = 'gcs-test-1'): GradingCaptureSession {
  return {
    id,
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_000,
    frontFull: makeShot('frontFull'),
    backFull: makeShot('backFull'),
    frontCorner: makeShot('frontCorner'),
    backCorner: makeShot('backCorner'),
    bottomLeftCorner: makeShot('bottomLeftCorner'),
    bottomRightCorner: makeShot('bottomRightCorner'),
    surface: makeShot('surface'),
  };
}

afterEach((): void => {
  __resetSessionStore();
});

describe('storeSession + getSession', () => {
  it('stores and retrieves the same session by id', () => {
    const session = makeSession('gcs-abc');
    storeSession(session);
    expect(getSession('gcs-abc')).toBe(session);
  });

  it('returns undefined for an unknown session id', () => {
    expect(getSession('does-not-exist')).toBeUndefined();
  });

  it('returns undefined before anything is stored', () => {
    expect(getSession('gcs-x')).toBeUndefined();
  });

  it('overwrites a previous session with the same id', () => {
    const s1 = makeSession('gcs-same');
    const s2: GradingCaptureSession = { ...s1, completedAt: 9_999_999 };
    storeSession(s1);
    storeSession(s2);
    expect(getSession('gcs-same')?.completedAt).toBe(9_999_999);
  });

  it('stores multiple sessions independently', () => {
    const a = makeSession('gcs-a');
    const b = makeSession('gcs-b');
    storeSession(a);
    storeSession(b);
    expect(getSession('gcs-a')).toBe(a);
    expect(getSession('gcs-b')).toBe(b);
  });
});

describe('clearSession', () => {
  it('removes a stored session', () => {
    const session = makeSession('gcs-clear');
    storeSession(session);
    clearSession('gcs-clear');
    expect(getSession('gcs-clear')).toBeUndefined();
  });

  it('is a no-op for an unknown id', () => {
    expect((): void => { clearSession('gcs-missing'); }).not.toThrow();
  });

  it('only removes the specified session', () => {
    storeSession(makeSession('gcs-keep'));
    storeSession(makeSession('gcs-remove'));
    clearSession('gcs-remove');
    expect(getSession('gcs-keep')).toBeDefined();
    expect(getSession('gcs-remove')).toBeUndefined();
  });
});

describe('sessionStoreSize', () => {
  it('is 0 initially', () => {
    expect(sessionStoreSize()).toBe(0);
  });

  it('increments on store', () => {
    storeSession(makeSession('gcs-1'));
    expect(sessionStoreSize()).toBe(1);
    storeSession(makeSession('gcs-2'));
    expect(sessionStoreSize()).toBe(2);
  });

  it('decrements on clear', () => {
    storeSession(makeSession('gcs-x'));
    clearSession('gcs-x');
    expect(sessionStoreSize()).toBe(0);
  });

  it('does not change on overwrite (same id)', () => {
    storeSession(makeSession('gcs-dup'));
    storeSession(makeSession('gcs-dup'));
    expect(sessionStoreSize()).toBe(1);
  });
});

describe('moduleSessionStore interface', () => {
  it('exposes all expected methods', async () => {
    const { moduleSessionStore } = await import('../session-store.js');
    expect(typeof moduleSessionStore.store).toBe('function');
    expect(typeof moduleSessionStore.get).toBe('function');
    expect(typeof moduleSessionStore.clear).toBe('function');
    expect(typeof moduleSessionStore.size).toBe('function');
  });

  it('delegates to the module-scoped map', async () => {
    const { moduleSessionStore } = await import('../session-store.js');
    const s = makeSession('gcs-delegate');
    moduleSessionStore.store(s);
    expect(moduleSessionStore.get('gcs-delegate')).toBe(s);
    expect(moduleSessionStore.size()).toBeGreaterThanOrEqual(1);
    moduleSessionStore.clear('gcs-delegate');
    expect(moduleSessionStore.get('gcs-delegate')).toBeUndefined();
  });
});
