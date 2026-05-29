import { describe, expect, it } from 'vitest';

import { SHAREABLE_THEMES } from '@binderly/api-contracts';

import { ogPaletteForTheme, ogPaletteFromTheme } from './og-palette';
import { DEFAULT_THEME, THEMES } from './registry';

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('ogPaletteFromTheme', () => {
  it('projects the flat OG-friendly subset from a theme', () => {
    const palette = ogPaletteFromTheme(THEMES.gold);
    expect(palette).toEqual({
      background: THEMES.gold.palette.background,
      surface: THEMES.gold.palette.surface,
      text: THEMES.gold.palette.text,
      textMuted: THEMES.gold.palette.textMuted,
      accent: THEMES.gold.palette.accent,
      onAccent: THEMES.gold.palette.onAccent,
    });
  });
});

describe('ogPaletteForTheme', () => {
  it('returns a valid hex palette for every known theme', () => {
    for (const id of SHAREABLE_THEMES) {
      const palette = ogPaletteForTheme(id);
      expect(palette.background).toMatch(HEX);
      expect(palette.accent).toMatch(HEX);
      expect(palette.text).toMatch(HEX);
      expect(palette.onAccent).toMatch(HEX);
    }
  });

  it('maps each known id to that theme palette', () => {
    expect(ogPaletteForTheme('neon').accent).toBe(THEMES.neon.palette.accent);
    expect(ogPaletteForTheme('dark').background).toBe(THEMES.dark.palette.background);
  });

  it('falls back to the default palette for unknown / null ids', () => {
    expect(ogPaletteForTheme('holo')).toEqual(ogPaletteFromTheme(DEFAULT_THEME));
    expect(ogPaletteForTheme(null)).toEqual(ogPaletteFromTheme(DEFAULT_THEME));
    expect(ogPaletteForTheme(undefined)).toEqual(ogPaletteFromTheme(DEFAULT_THEME));
  });
});
