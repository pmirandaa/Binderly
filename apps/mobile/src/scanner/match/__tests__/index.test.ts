// Smoke-tests the public barrel surface so a wayward edit can't
// silently drop an exported name that downstream consumers
// (T-SC-UX, debug overlay) depend on.

import { describe, expect, it } from 'vitest';

import * as matchExports from '../index.js';

describe('match barrel', () => {
  it('exports the primary public surfaces', () => {
    expect(typeof matchExports.useScanner).toBe('function');
    expect(typeof matchExports.createMatcher).toBe('function');
    expect(typeof matchExports.createMatchSink).toBe('function');
    expect(typeof matchExports.createMatchQueue).toBe('function');
    expect(typeof matchExports.classifyConfidence).toBe('function');
  });

  it('exports the stability helpers', () => {
    expect(typeof matchExports.createStabilityState).toBe('function');
    expect(typeof matchExports.advanceStability).toBe('function');
    expect(typeof matchExports.engageCooldown).toBe('function');
    expect(typeof matchExports.clearStability).toBe('function');
  });

  it('exports the live config defaults frozen object', () => {
    expect(matchExports.MATCH_DEFAULTS).toBeDefined();
    expect(matchExports.MATCH_DEFAULTS.autoAddScore).toBeGreaterThan(0);
    // Frozen so consumers can't mutate the shared defaults.
    expect(Object.isFrozen(matchExports.MATCH_DEFAULTS)).toBe(true);
  });

  it('exports the per-constant tunables', () => {
    expect(typeof matchExports.MATCH_AUTO_ADD_SCORE).toBe('number');
    expect(typeof matchExports.MATCH_DISAMBIG_SCORE).toBe('number');
    expect(typeof matchExports.MATCH_TOP_GAP_MIN).toBe('number');
    expect(typeof matchExports.MATCH_STABILITY_COUNT).toBe('number');
    expect(typeof matchExports.MATCH_STACK_RESET_MS).toBe('number');
    expect(typeof matchExports.MATCH_K).toBe('number');
    expect(typeof matchExports.MATCH_QUEUE_CAP).toBe('number');
  });
});
