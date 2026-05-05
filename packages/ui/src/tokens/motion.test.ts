import { describe, expect, it } from 'vitest';

import { DURATION_ORDER, durations, easings } from './motion.js';

describe('motion tokens', () => {
  describe('durations', () => {
    it('declares every key in DURATION_ORDER', () => {
      for (const key of DURATION_ORDER) {
        expect(typeof durations[key]).toBe('number');
      }
    });

    it('starts at instant = 0ms', () => {
      expect(durations.instant).toBe(0);
    });

    it('is monotone non-decreasing', () => {
      let prev = -1;
      for (const key of DURATION_ORDER) {
        const v = durations[key];
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });

    it('is strictly monotone (no duplicate durations)', () => {
      const values = DURATION_ORDER.map((k) => durations[k]);
      expect(new Set(values).size).toBe(values.length);
    });

    it('keeps values <= 500ms (no glacial defaults)', () => {
      for (const v of Object.values(durations)) {
        expect(v).toBeLessThanOrEqual(500);
      }
    });
  });

  describe('easings', () => {
    it('exposes named easings', () => {
      expect(easings.standard).toContain('cubic-bezier');
      expect(easings.emphasized).toContain('cubic-bezier');
      expect(easings.decelerate).toContain('cubic-bezier');
      expect(easings.accelerate).toContain('cubic-bezier');
      expect(easings.linear).toBe('linear');
    });

    it('every cubic-bezier is well-formed (4 numeric coefficients)', () => {
      const cubic = /^cubic-bezier\(([^)]+)\)$/;
      for (const value of Object.values(easings)) {
        if (value === 'linear') continue;
        const match = cubic.exec(value);
        expect(match).not.toBeNull();
        const coeffs = match![1].split(',').map((s) => Number(s.trim()));
        expect(coeffs).toHaveLength(4);
        for (const c of coeffs) {
          expect(Number.isFinite(c)).toBe(true);
        }
      }
    });
  });
});
