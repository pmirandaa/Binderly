// Stability + cooldown state-machine tests.

import { describe, expect, it } from 'vitest';

import {
  advanceStability,
  clearStability,
  createStabilityState,
  engageCooldown,
} from '../stability.js';

const COUNT = 3;
const RESET_MS = 350;

describe('stability state machine', () => {
  it('starts with empty state', () => {
    const s = createStabilityState();
    expect(s.currentPrintingId).toBe('');
    expect(s.count).toBe(0);
    expect(s.lastAcceptedAtMs).toBe(Number.NEGATIVE_INFINITY);
    expect(s.cooldownPrintingId).toBe('');
  });

  it('counts consecutive frames at the same printingId up to the target', () => {
    const s = createStabilityState();
    expect(advanceStability(s, 'A', 100, COUNT, RESET_MS).shouldFire).toBe(false);
    expect(advanceStability(s, 'A', 200, COUNT, RESET_MS).shouldFire).toBe(false);
    const fire = advanceStability(s, 'A', 300, COUNT, RESET_MS);
    expect(fire.shouldFire).toBe(true);
    expect(fire.count).toBe(COUNT);
  });

  it('resets the counter on jitter (different printing frame-to-frame)', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'B', 200, COUNT, RESET_MS);
    advanceStability(s, 'A', 300, COUNT, RESET_MS);
    // Only the final 'A' frame is on the chain → count = 1 → no fire.
    expect(s.count).toBe(1);
  });

  it('treats a gap > stackResetMs as a card-removed event', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'A', 200, COUNT, RESET_MS);
    // Gap > RESET_MS resets even though the printingId matches.
    const after = advanceStability(s, 'A', 600, COUNT, RESET_MS);
    expect(after.shouldFire).toBe(false);
    expect(after.count).toBe(1);
  });

  it('engages cooldown for the fired printingId', () => {
    const s = createStabilityState();
    engageCooldown(s, 'A');
    expect(s.cooldownPrintingId).toBe('A');
    expect(s.count).toBe(0);
  });

  it('refuses to re-fire the same printingId while in cooldown', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'A', 200, COUNT, RESET_MS);
    const fire = advanceStability(s, 'A', 300, COUNT, RESET_MS);
    expect(fire.shouldFire).toBe(true);
    engageCooldown(s, 'A');
    // Same id, same cadence → cooldown blocks the second fire.
    advanceStability(s, 'A', 400, COUNT, RESET_MS);
    advanceStability(s, 'A', 500, COUNT, RESET_MS);
    const second = advanceStability(s, 'A', 600, COUNT, RESET_MS);
    expect(second.shouldFire).toBe(false);
  });

  it('releases cooldown after a card-removed gap', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 0, COUNT, RESET_MS);
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'A', 200, COUNT, RESET_MS);
    engageCooldown(s, 'A');
    // 1s of nothing then a fresh stable run → fires again.
    advanceStability(s, 'A', 1300, COUNT, RESET_MS);
    advanceStability(s, 'A', 1400, COUNT, RESET_MS);
    const fire = advanceStability(s, 'A', 1500, COUNT, RESET_MS);
    expect(fire.shouldFire).toBe(true);
  });

  it('a different printingId fires through the cooldown (stack-mode flip)', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'A', 200, COUNT, RESET_MS);
    advanceStability(s, 'A', 300, COUNT, RESET_MS);
    engageCooldown(s, 'A');
    // User flips to card B; tight cadence, no card-removed gap.
    advanceStability(s, 'B', 400, COUNT, RESET_MS);
    advanceStability(s, 'B', 500, COUNT, RESET_MS);
    const fireB = advanceStability(s, 'B', 600, COUNT, RESET_MS);
    expect(fireB.shouldFire).toBe(true);
  });

  it('clearStability resets the in-flight counter without releasing cooldown', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'A', 200, COUNT, RESET_MS);
    advanceStability(s, 'A', 300, COUNT, RESET_MS);
    engageCooldown(s, 'A');
    clearStability(s);
    expect(s.count).toBe(0);
    expect(s.currentPrintingId).toBe('');
    expect(s.cooldownPrintingId).toBe('A');
  });

  it('counter caps at the stability target across long static holds', () => {
    const s = createStabilityState();
    advanceStability(s, 'A', 100, COUNT, RESET_MS);
    advanceStability(s, 'A', 200, COUNT, RESET_MS);
    advanceStability(s, 'A', 300, COUNT, RESET_MS);
    for (let i = 1; i < 50; i += 1) {
      advanceStability(s, 'A', 300 + i * 100, COUNT, RESET_MS);
    }
    expect(s.count).toBe(COUNT);
  });
});
