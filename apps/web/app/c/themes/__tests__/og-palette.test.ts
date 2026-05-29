import { describe, expect, it } from 'vitest';

import { SHAREABLE_THEMES } from '@binderly/api-contracts';

import { ogPaletteForTheme } from '../og-palette';
import { THEMES } from '../registry';

describe('ogPaletteForTheme', () => {
  it('returns a palette for every theme id matching the registry colours', () => {
    for (const id of SHAREABLE_THEMES) {
      const palette = ogPaletteForTheme(id);
      const theme = THEMES[id];
      expect(palette.background).toBe(theme.background);
      expect(palette.surface).toBe(theme.surface);
      expect(palette.text).toBe(theme.text);
      expect(palette.textMuted).toBe(theme.textMuted);
      expect(palette.accent).toBe(theme.accent);
      expect(palette.border).toBe(theme.border);
    }
  });

  it('falls back to the default palette for an unknown id', () => {
    expect(ogPaletteForTheme('chrome')).toEqual(ogPaletteForTheme('default'));
  });

  it('falls back to the default palette for null', () => {
    expect(ogPaletteForTheme(null)).toEqual(ogPaletteForTheme('default'));
  });

  it('returns only colour primitives (no font, no react)', () => {
    const palette = ogPaletteForTheme('gold');
    expect(Object.keys(palette).sort()).toEqual(
      ['accent', 'background', 'border', 'surface', 'text', 'textMuted'].sort(),
    );
  });

  it('every palette value is a hex string', () => {
    for (const id of SHAREABLE_THEMES) {
      const palette = ogPaletteForTheme(id);
      for (const value of Object.values(palette)) {
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
