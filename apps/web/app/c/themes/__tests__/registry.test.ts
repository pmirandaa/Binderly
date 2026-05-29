import { describe, expect, it } from 'vitest';

import { SHAREABLE_THEMES } from '@binderly/api-contracts';

import {
  DEFAULT_THEME,
  THEME_LIST,
  THEMES,
  resolvePublicTheme,
  resolveTheme,
  type Theme,
} from '../registry';

const COLOR_KEYS: ReadonlyArray<keyof Theme> = [
  'background',
  'surface',
  'surfaceMuted',
  'border',
  'text',
  'textMuted',
  'accent',
];

describe('THEMES registry', () => {
  it('has an entry for every contract theme id', () => {
    for (const id of SHAREABLE_THEMES) {
      expect(THEMES[id]).toBeDefined();
      expect(THEMES[id].id).toBe(id);
    }
  });

  it('exposes exactly the contract themes (no extras)', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...SHAREABLE_THEMES].sort());
  });

  it('THEME_LIST lists default first', () => {
    expect(THEME_LIST[0]?.id).toBe('default');
    expect(THEME_LIST).toHaveLength(SHAREABLE_THEMES.length);
  });

  it('every theme defines all colour tokens as hex strings', () => {
    for (const theme of THEME_LIST) {
      for (const key of COLOR_KEYS) {
        const value = theme[key];
        expect(typeof value).toBe('string');
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('every theme defines a non-empty label, description, and fontFamily', () => {
    for (const theme of THEME_LIST) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.fontFamily.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveTheme', () => {
  it('resolves each known id to its theme', () => {
    for (const id of SHAREABLE_THEMES) {
      expect(resolveTheme(id).id).toBe(id);
    }
  });

  it('falls back to default for an unknown id', () => {
    expect(resolveTheme('chrome')).toBe(DEFAULT_THEME);
  });

  it('falls back to default for null', () => {
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
  });

  it('falls back to default for undefined', () => {
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('falls back to default for an empty string', () => {
    expect(resolveTheme('')).toBe(DEFAULT_THEME);
  });
});

describe('resolvePublicTheme (free-downgrade seam)', () => {
  it('force-defaults a provably non-pro owner', () => {
    expect(resolvePublicTheme('gold', false)).toBe(DEFAULT_THEME);
    expect(resolvePublicTheme('neon', false)).toBe(DEFAULT_THEME);
  });

  it('renders the stored theme for a pro owner', () => {
    expect(resolvePublicTheme('gold', true).id).toBe('gold');
  });

  it('renders the stored theme when owner tier is unknown (null)', () => {
    expect(resolvePublicTheme('gold', null).id).toBe('gold');
  });

  it('renders the stored theme when owner tier is unknown (undefined)', () => {
    expect(resolvePublicTheme('dark', undefined).id).toBe('dark');
  });

  it('still defaults an unknown id even for a pro owner', () => {
    expect(resolvePublicTheme('chrome', true)).toBe(DEFAULT_THEME);
  });

  it('a free owner on the default theme stays default', () => {
    expect(resolvePublicTheme('default', false)).toBe(DEFAULT_THEME);
  });
});
