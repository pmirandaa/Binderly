import { describe, expect, it } from 'vitest';

import {
  FONT_SIZE_ORDER,
  TEXT_VARIANTS,
  fonts,
  fontSizes,
  fontWeights,
  letterSpacings,
  lineHeights,
} from './typography.js';

describe('typography tokens', () => {
  describe('font stacks', () => {
    it('exposes body / heading / mono', () => {
      expect(fonts.body).toContain('system-ui');
      expect(fonts.heading).toContain('system-ui');
      expect(fonts.mono).toContain('ui-monospace');
    });

    it('lists multiple system fallbacks (defensive against missing UA fonts)', () => {
      expect(fonts.body.split(',').length).toBeGreaterThanOrEqual(3);
      expect(fonts.mono.split(',').length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('font size scale', () => {
    it('declares every key in FONT_SIZE_ORDER', () => {
      for (const key of FONT_SIZE_ORDER) {
        expect(typeof fontSizes[key]).toBe('number');
      }
    });

    it('is strictly monotone increasing', () => {
      let prev = -1;
      for (const key of FONT_SIZE_ORDER) {
        const v = fontSizes[key];
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
    });

    it('starts at $1 = 11 (caption-tier minimum)', () => {
      expect(fontSizes.$1).toBe(11);
    });

    it('reaches $12 = 48 (display-tier maximum)', () => {
      expect(fontSizes.$12).toBe(48);
    });

    it('every line-height is at least the matching font-size', () => {
      for (const key of FONT_SIZE_ORDER) {
        expect(lineHeights[key]).toBeGreaterThanOrEqual(fontSizes[key]);
      }
    });
  });

  describe('font weights', () => {
    it('exposes regular, medium, semibold, bold as numeric strings', () => {
      expect(fontWeights.regular).toBe('400');
      expect(fontWeights.medium).toBe('500');
      expect(fontWeights.semibold).toBe('600');
      expect(fontWeights.bold).toBe('700');
    });

    it('values are strictly monotone', () => {
      const values = [
        fontWeights.regular,
        fontWeights.medium,
        fontWeights.semibold,
        fontWeights.bold,
      ].map(Number);
      let prev = -1;
      for (const v of values) {
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
    });
  });

  describe('letter spacings', () => {
    it('tight is negative, normal is zero, wide is positive', () => {
      expect(letterSpacings.tight).toBeLessThan(0);
      expect(letterSpacings.normal).toBe(0);
      expect(letterSpacings.wide).toBeGreaterThan(0);
    });
  });

  describe('text variant inventory', () => {
    it('contract: includes every variant the inventory advertises', () => {
      expect([...TEXT_VARIANTS].sort()).toEqual(
        [
          'display',
          'title',
          'subtitle',
          'body',
          'bodySmall',
          'caption',
          'label',
          'monospace',
        ].sort(),
      );
    });

    it('is duplicate-free', () => {
      expect(new Set(TEXT_VARIANTS).size).toBe(TEXT_VARIANTS.length);
    });
  });
});
