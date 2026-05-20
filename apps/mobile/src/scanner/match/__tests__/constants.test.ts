// Smoke tests for the match-layer constants.
//
// The constants are read by the matcher's hot path and surfaced
// through the public barrel for the (future) scanner-settings UI;
// these tests pin the ranges so a wayward edit can't ship a value
// that breaks an invariant downstream.

import { describe, expect, it } from 'vitest';

import {
  MATCH_AUTO_ADD_SCORE,
  MATCH_DISAMBIG_SCORE,
  MATCH_K,
  MATCH_QUEUE_CAP,
  MATCH_STABILITY_COUNT,
  MATCH_STACK_RESET_MS,
  MATCH_TOP_GAP_MIN,
} from '../constants.js';

describe('match constants', () => {
  it('keeps auto-add strictly above the disambig threshold', () => {
    expect(MATCH_AUTO_ADD_SCORE).toBeGreaterThan(MATCH_DISAMBIG_SCORE);
  });

  it('keeps both scores inside the cosine [-1, 1] range', () => {
    expect(MATCH_AUTO_ADD_SCORE).toBeLessThanOrEqual(1);
    expect(MATCH_DISAMBIG_SCORE).toBeGreaterThanOrEqual(-1);
    expect(MATCH_AUTO_ADD_SCORE).toBeGreaterThan(0);
    expect(MATCH_DISAMBIG_SCORE).toBeGreaterThan(0);
  });

  it('keeps the top-gap minimum strictly positive but tiny', () => {
    expect(MATCH_TOP_GAP_MIN).toBeGreaterThan(0);
    expect(MATCH_TOP_GAP_MIN).toBeLessThan(0.2);
  });

  it('requires at least 2 consecutive frames for stability', () => {
    expect(MATCH_STABILITY_COUNT).toBeGreaterThanOrEqual(2);
  });

  it('keeps the stack-reset window above the 10-FPS sampling interval', () => {
    expect(MATCH_STACK_RESET_MS).toBeGreaterThan(100);
  });

  it('asks the ANN for enough candidates to fill a disambig picker', () => {
    expect(MATCH_K).toBeGreaterThanOrEqual(3);
  });

  it('keeps the queue cap finite and at least a small batch', () => {
    expect(MATCH_QUEUE_CAP).toBeGreaterThanOrEqual(8);
    expect(Number.isFinite(MATCH_QUEUE_CAP)).toBe(true);
  });
});
