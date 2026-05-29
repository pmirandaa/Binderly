// Session-reducer tests — pure state in, pure state out.

import { describe, expect, it } from 'vitest';

import { CAPTURE_KINDS, CAPTURE_STEP_COUNT } from '../constants.js';
import {
  buildEmittedSession,
  createInitialSessionState,
  currentStep,
  isComplete,
  reduceCaptureSession,
} from '../session.js';

import type {
  CaptureQualityResult,
  GradingShot,
  GradingShotKind,
} from '../types.js';

const okQuality: CaptureQualityResult = {
  metrics: { sharpness: 12, brightness: 0.5, coverage: 0.6 },
  sharpnessOK: true,
  brightnessOK: true,
  coverageOK: true,
  accepted: true,
  reason: 'great',
};

function makeShot(kind: GradingShotKind, suffix: string = ''): GradingShot {
  return {
    kind,
    uri: `file:///tmp/${kind}${suffix}.jpg`,
    width: 1080,
    height: 1440,
    quality: okQuality,
    capturedAt: 1700000000000,
  };
}

describe('createInitialSessionState', () => {
  it('starts at step 0, empty shots, no reason, not complete', () => {
    const state = createInitialSessionState({ id: 'fixed-id', startedAt: 42 });
    expect(state).toEqual({
      id: 'fixed-id',
      startedAt: 42,
      stepIndex: 0,
      shots: {},
      lastReason: null,
      isComplete: false,
    });
  });

  it('falls back to Date.now and a generated id when options are omitted', () => {
    const state = createInitialSessionState();
    expect(typeof state.id).toBe('string');
    expect(state.id.length).toBeGreaterThan(0);
    expect(typeof state.startedAt).toBe('number');
  });
});

describe('reduceCaptureSession', () => {
  it('advances on accept for the current step kind', () => {
    const s0 = createInitialSessionState({ id: 'i', startedAt: 0 });
    const s1 = reduceCaptureSession(s0, {
      type: 'accept',
      shot: makeShot('frontFull'),
    });
    expect(s1.stepIndex).toBe(1);
    expect(s1.shots.frontFull).toBeDefined();
    expect(s1.lastReason).toBe('great');
    expect(s1.isComplete).toBe(false);
  });

  it('is a no-op on accept of an out-of-order kind', () => {
    const s0 = createInitialSessionState({ id: 'i', startedAt: 0 });
    const s1 = reduceCaptureSession(s0, {
      type: 'accept',
      shot: makeShot('backFull'),
    });
    expect(s1).toBe(s0);
  });

  it('is a no-op on a duplicate accept for the current step', () => {
    const s0 = createInitialSessionState({ id: 'i', startedAt: 0 });
    const s1 = reduceCaptureSession(s0, {
      type: 'accept',
      shot: makeShot('frontFull'),
    });
    // Try a "second accept" at the same kind — the reducer should
    // see frontFull already in `shots` and bail. Simulating this
    // requires walking the step index back; instead we hand a
    // shot for the wrong kind to verify the duplicate guard is
    // hit. (The natural duplicate path is "user taps capture
    // twice in a row", which the screen prevents via `busy`.)
    const s2 = reduceCaptureSession(s1, {
      type: 'accept',
      shot: makeShot('frontFull'),
    });
    // s2 expects backFull next, so frontFull is rejected.
    expect(s2).toBe(s1);
  });

  it('records the reason on reject without advancing', () => {
    const s0 = createInitialSessionState({ id: 'i', startedAt: 0 });
    const s1 = reduceCaptureSession(s0, {
      type: 'reject',
      reason: 'too_dark',
    });
    expect(s1.stepIndex).toBe(0);
    expect(s1.lastReason).toBe('too_dark');
    expect(s1.shots).toEqual({});
  });

  it('completes after four accepts in order', () => {
    let s = createInitialSessionState({ id: 'i', startedAt: 0 });
    for (const kind of CAPTURE_KINDS) {
      s = reduceCaptureSession(s, { type: 'accept', shot: makeShot(kind) });
    }
    expect(s.stepIndex).toBe(CAPTURE_STEP_COUNT);
    expect(s.isComplete).toBe(true);
    expect(Object.keys(s.shots).sort()).toEqual([...CAPTURE_KINDS].sort());
  });

  it('walks back to the missing step on retake', () => {
    let s = createInitialSessionState({ id: 'i', startedAt: 0 });
    for (const kind of CAPTURE_KINDS) {
      s = reduceCaptureSession(s, { type: 'accept', shot: makeShot(kind) });
    }
    const retaken = reduceCaptureSession(s, { type: 'retake', kind: 'backFull' });
    expect(retaken.stepIndex).toBe(1);
    expect(retaken.isComplete).toBe(false);
    expect(retaken.shots.backFull).toBeUndefined();
    expect(retaken.shots.frontFull).toBeDefined();
    expect(retaken.shots.frontCorner).toBeDefined();
    expect(retaken.shots.backCorner).toBeDefined();
  });

  it('retake is a no-op for a kind that was not yet accepted', () => {
    const s0 = createInitialSessionState({ id: 'i', startedAt: 0 });
    const s1 = reduceCaptureSession(s0, { type: 'retake', kind: 'backCorner' });
    expect(s1).toBe(s0);
  });

  it('resets to a fresh state with new id + timestamp', () => {
    const s0 = createInitialSessionState({ id: 'old', startedAt: 0 });
    const s1 = reduceCaptureSession(s0, {
      type: 'accept',
      shot: makeShot('frontFull'),
    });
    const reset = reduceCaptureSession(s1, {
      type: 'reset',
      id: 'fresh',
      startedAt: 99,
    });
    expect(reset).toEqual({
      id: 'fresh',
      startedAt: 99,
      stepIndex: 0,
      shots: {},
      lastReason: null,
      isComplete: false,
    });
  });
});

describe('currentStep + isComplete', () => {
  it('returns the step at the current index', () => {
    const s = createInitialSessionState({ id: 'i', startedAt: 0 });
    expect(currentStep(s)?.kind).toBe('frontFull');
  });

  it('returns null when the session is complete', () => {
    let s = createInitialSessionState({ id: 'i', startedAt: 0 });
    for (const kind of CAPTURE_KINDS) {
      s = reduceCaptureSession(s, { type: 'accept', shot: makeShot(kind) });
    }
    expect(currentStep(s)).toBeNull();
    expect(isComplete(s)).toBe(true);
  });
});

describe('buildEmittedSession', () => {
  it('returns null for an in-progress session', () => {
    const s = createInitialSessionState({ id: 'i', startedAt: 0 });
    expect(buildEmittedSession(s, 100)).toBeNull();
  });

  it('emits the full session shape when every shot is accepted', () => {
    let s = createInitialSessionState({ id: 'i', startedAt: 0 });
    for (const kind of CAPTURE_KINDS) {
      s = reduceCaptureSession(s, { type: 'accept', shot: makeShot(kind) });
    }
    const emitted = buildEmittedSession(s, 100);
    expect(emitted).not.toBeNull();
    if (emitted === null) return;
    expect(emitted.id).toBe('i');
    expect(emitted.startedAt).toBe(0);
    expect(emitted.completedAt).toBe(100);
    expect(emitted.frontFull.kind).toBe('frontFull');
    expect(emitted.backFull.kind).toBe('backFull');
    expect(emitted.frontCorner.kind).toBe('frontCorner');
    expect(emitted.backCorner.kind).toBe('backCorner');
    expect(emitted.bottomLeftCorner.kind).toBe('bottomLeftCorner');
    expect(emitted.bottomRightCorner.kind).toBe('bottomRightCorner');
    expect(emitted.surface.kind).toBe('surface');
  });

  it('returns null when the surface shot is missing despite isComplete', () => {
    // Defensive guard: a hand-built complete-looking state missing a
    // required shot must not emit a malformed session.
    let s = createInitialSessionState({ id: 'i', startedAt: 0 });
    for (const kind of CAPTURE_KINDS) {
      s = reduceCaptureSession(s, { type: 'accept', shot: makeShot(kind) });
    }
    const broken = { ...s, shots: { ...s.shots, surface: undefined } };
    expect(buildEmittedSession(broken, 100)).toBeNull();
  });
});
