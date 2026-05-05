import { describe, expect, it } from 'vitest';

import {
  COLOR_STOPS,
  SEMANTIC_COLOR_SLOTS,
  amber,
  blue,
  green,
  neutral,
  palette,
  red,
  teal,
  violet,
} from './colors.js';

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('color tokens', () => {
  it('exposes 11 stops in the canonical Tailwind/Radix order', () => {
    expect(COLOR_STOPS).toEqual([
      '50',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
      '950',
    ]);
  });

  describe.each([
    ['neutral', neutral],
    ['teal', teal],
    ['violet', violet],
    ['green', green],
    ['amber', amber],
    ['red', red],
    ['blue', blue],
  ])('%s ramp', (_name, ramp) => {
    it('declares every stop', () => {
      for (const stop of COLOR_STOPS) {
        expect(ramp[stop]).toMatch(HEX);
      }
    });

    it('has no duplicates within the ramp', () => {
      const values = COLOR_STOPS.map((stop) => ramp[stop]);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  it('declares only ramp + black/white at the top of `palette`', () => {
    expect(Object.keys(palette).sort()).toEqual(
      ['amber', 'black', 'blue', 'green', 'neutral', 'red', 'teal', 'violet', 'white'].sort(),
    );
    expect(palette.white).toBe('#FFFFFF');
    expect(palette.black).toBe('#000000');
  });

  it('lists the full set of semantic slots in a stable order', () => {
    expect(SEMANTIC_COLOR_SLOTS).toContain('background');
    expect(SEMANTIC_COLOR_SLOTS).toContain('surface');
    expect(SEMANTIC_COLOR_SLOTS).toContain('text');
    expect(SEMANTIC_COLOR_SLOTS).toContain('primary');
    expect(SEMANTIC_COLOR_SLOTS).toContain('focusRing');
    expect(SEMANTIC_COLOR_SLOTS).toContain('errorSurface');
  });

  it('the semantic slot list is duplicate-free', () => {
    expect(new Set(SEMANTIC_COLOR_SLOTS).size).toBe(SEMANTIC_COLOR_SLOTS.length);
  });
});
