import { describe, expect, it } from 'vitest';

import { SHAREABLE_THEMES } from '@binderly/api-contracts';

import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  PRO_THEME_IDS,
  THEME_LIST,
  THEMES,
  isKnownThemeId,
  resolvePublicTheme,
  resolveTheme,
  type Theme,
} from './registry';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const PALETTE_KEYS: ReadonlyArray<keyof Theme['palette']> = [
  'background',
  'surface',
  'surfaceMuted',
  'border',
  'text',
  'textMuted',
  'accent',
  'onAccent',
];

describe('theme registry — shape', () => {
  it('registers exactly one theme per canonical SHAREABLE_THEMES id', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...SHAREABLE_THEMES].sort());
  });

  it('THEME_LIST lists every theme with `default` first', () => {
    expect(THEME_LIST).toHaveLength(SHAREABLE_THEMES.length);
    expect(THEME_LIST[0]?.id).toBe('default');
    expect(THEME_LIST.map((t) => t.id).sort()).toEqual([...SHAREABLE_THEMES].sort());
  });

  it('each registry entry id matches its key', () => {
    for (const id of SHAREABLE_THEMES) {
      expect(THEMES[id].id).toBe(id);
    }
  });

  it('default theme metadata is correct', () => {
    expect(DEFAULT_THEME_ID).toBe('default');
    expect(DEFAULT_THEME.id).toBe('default');
    expect(DEFAULT_THEME.pro).toBe(false);
    expect(THEMES.default).toBe(DEFAULT_THEME);
  });

  it('only the default theme is free; every other theme is Pro', () => {
    for (const theme of THEME_LIST) {
      expect(theme.pro).toBe(theme.id !== 'default');
    }
  });

  it('PRO_THEME_IDS is every non-default id and excludes default', () => {
    expect(PRO_THEME_IDS).not.toContain('default');
    expect([...PRO_THEME_IDS].sort()).toEqual(
      [...SHAREABLE_THEMES].filter((id) => id !== 'default').sort(),
    );
  });
});

describe('theme registry — tokens', () => {
  for (const theme of THEME_LIST) {
    describe(`theme: ${theme.id}`, () => {
      it('has a non-empty name + description', () => {
        expect(theme.name.length).toBeGreaterThan(0);
        expect(theme.description.length).toBeGreaterThan(0);
      });

      it('has valid 6-digit hex for every palette token', () => {
        for (const key of PALETTE_KEYS) {
          expect(theme.palette[key], `${theme.id}.${key}`).toMatch(HEX);
        }
      });

      it('has heading + body font stacks', () => {
        expect(theme.fonts.heading.length).toBeGreaterThan(0);
        expect(theme.fonts.body.length).toBeGreaterThan(0);
      });

      it('uses a known header treatment + card frame', () => {
        expect(['plain', 'band']).toContain(theme.header);
        expect(['outlined', 'flat', 'soft']).toContain(theme.cardFrame);
      });
    });
  }
});

describe('isKnownThemeId', () => {
  it('returns true for every registered id', () => {
    for (const id of SHAREABLE_THEMES) {
      expect(isKnownThemeId(id)).toBe(true);
    }
  });

  it('returns false for unknown / non-string ids', () => {
    expect(isKnownThemeId('holo')).toBe(false);
    expect(isKnownThemeId('Default')).toBe(false);
    expect(isKnownThemeId('')).toBe(false);
    expect(isKnownThemeId(null)).toBe(false);
    expect(isKnownThemeId(undefined)).toBe(false);
    expect(isKnownThemeId(42)).toBe(false);
    expect(isKnownThemeId({})).toBe(false);
  });

  it('is not fooled by inherited Object.prototype keys', () => {
    expect(isKnownThemeId('toString')).toBe(false);
    expect(isKnownThemeId('constructor')).toBe(false);
    expect(isKnownThemeId('hasOwnProperty')).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('returns the matching theme for every known id', () => {
    for (const id of SHAREABLE_THEMES) {
      expect(resolveTheme(id).id).toBe(id);
    }
  });

  it('falls back to default for an unknown id', () => {
    expect(resolveTheme('holo')).toBe(DEFAULT_THEME);
    expect(resolveTheme('midnight')).toBe(DEFAULT_THEME);
  });

  it('falls back to default for null / undefined / empty', () => {
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme('')).toBe(DEFAULT_THEME);
  });
});

describe('resolvePublicTheme — free-tier enforcement', () => {
  it('renders the stored theme for a pro owner', () => {
    expect(resolvePublicTheme('gold', true).id).toBe('gold');
    expect(resolvePublicTheme('neon', true).id).toBe('neon');
    expect(resolvePublicTheme('dark', true).id).toBe('dark');
  });

  it('forces default for a non-pro owner regardless of stored id', () => {
    expect(resolvePublicTheme('gold', false)).toBe(DEFAULT_THEME);
    expect(resolvePublicTheme('neon', false)).toBe(DEFAULT_THEME);
    expect(resolvePublicTheme('paper', false)).toBe(DEFAULT_THEME);
  });

  it('keeps default as default for a non-pro owner', () => {
    expect(resolvePublicTheme('default', false)).toBe(DEFAULT_THEME);
  });

  it('renders the stored theme when owner tier is unknown (interim)', () => {
    expect(resolvePublicTheme('gold', null).id).toBe('gold');
    expect(resolvePublicTheme('dark', null).id).toBe('dark');
  });

  it('still falls back to default for an unknown stored id', () => {
    expect(resolvePublicTheme('holo', true)).toBe(DEFAULT_THEME);
    expect(resolvePublicTheme('holo', null)).toBe(DEFAULT_THEME);
  });
});
