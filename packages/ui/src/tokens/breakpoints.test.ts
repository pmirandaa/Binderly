import { describe, expect, it } from 'vitest';

import { BREAKPOINT_ORDER, breakpoints, media } from './breakpoints.js';

describe('breakpoint tokens', () => {
  it('declares every standard breakpoint', () => {
    expect(breakpoints.xs).toBe(0);
    expect(breakpoints.sm).toBe(640);
    expect(breakpoints.md).toBe(768);
    expect(breakpoints.lg).toBe(1024);
    expect(breakpoints.xl).toBe(1280);
    expect(breakpoints['2xl']).toBe(1536);
  });

  it('BREAKPOINT_ORDER is strictly monotone increasing', () => {
    let prev = -1;
    for (const key of BREAKPOINT_ORDER) {
      const v = breakpoints[key];
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('every breakpoint is non-negative', () => {
    for (const v of Object.values(breakpoints)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  describe('media query map', () => {
    it('exposes a min-width entry for every breakpoint above xs', () => {
      expect(media.sm.minWidth).toBe(breakpoints.sm);
      expect(media.md.minWidth).toBe(breakpoints.md);
      expect(media.lg.minWidth).toBe(breakpoints.lg);
      expect(media.xl.minWidth).toBe(breakpoints.xl);
      expect(media['2xl'].minWidth).toBe(breakpoints['2xl']);
    });

    it('does NOT expose an xs entry (xs === 0 → noop media query)', () => {
      expect((media as Record<string, unknown>).xs).toBeUndefined();
    });
  });
});
