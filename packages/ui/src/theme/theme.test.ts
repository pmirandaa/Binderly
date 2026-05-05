import { describe, expect, it } from 'vitest';

import { darkTheme } from './dark.js';
import { THEME_NAMES, themes } from './index.js';
import { lightTheme } from './light.js';
import { flatColorTokens, tamaguiTokens, typographyTokens } from './tokens.js';
import { SEMANTIC_COLOR_SLOTS } from '../tokens/colors.js';

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('theme — slot coverage', () => {
  it.each(SEMANTIC_COLOR_SLOTS)('light theme declares slot "%s"', (slot) => {
    expect((lightTheme as Record<string, string>)[slot]).toMatch(HEX);
  });

  it.each(SEMANTIC_COLOR_SLOTS)('dark theme declares slot "%s"', (slot) => {
    expect((darkTheme as Record<string, string>)[slot]).toMatch(HEX);
  });

  it('light + dark expose the same set of slot keys', () => {
    expect(Object.keys(lightTheme).sort()).toEqual(Object.keys(darkTheme).sort());
  });

  it('every slot in the inventory is present in both themes', () => {
    for (const slot of SEMANTIC_COLOR_SLOTS) {
      expect(slot in lightTheme).toBe(true);
      expect(slot in darkTheme).toBe(true);
    }
  });
});

describe('theme — light vs dark distinctness', () => {
  it.each([
    'background',
    'surface',
    'text',
    'textInverse',
    'border',
    'primary',
    'success',
    'error',
  ] as const)('"%s" differs between light and dark', (slot) => {
    const l = (lightTheme as Record<string, string>)[slot];
    const d = (darkTheme as Record<string, string>)[slot];
    expect(l).not.toBe(d);
  });

  it('inverse text in light theme is a bright value (legible on dark surface)', () => {
    // Light theme's textInverse is the colour that lands on dark
    // surfaces (e.g. a primary button). It should not equal the
    // light theme's foreground text.
    expect(lightTheme.textInverse).not.toBe(lightTheme.text);
  });

  it('background gets darker between light and dark', () => {
    expect(lightTheme.background).not.toBe(darkTheme.background);
  });
});

describe('theme — name registry', () => {
  it('THEME_NAMES is exactly ["light", "dark"]', () => {
    expect([...THEME_NAMES]).toEqual(['light', 'dark']);
  });

  it('themes map keys match THEME_NAMES', () => {
    expect(Object.keys(themes).sort()).toEqual([...THEME_NAMES].sort());
  });
});

describe('Tamagui tokens (createTokens output)', () => {
  it('has a non-empty color bag', () => {
    expect(tamaguiTokens.color).toBeDefined();
    expect(Object.keys(tamaguiTokens.color).length).toBeGreaterThan(20);
  });

  it('includes white and black colour tokens', () => {
    expect(flatColorTokens.white).toBe('#FFFFFF');
    expect(flatColorTokens.black).toBe('#000000');
  });

  it('flattens every ramp + stop into a single keyspace', () => {
    expect(flatColorTokens.teal500).toBeDefined();
    expect(flatColorTokens.neutral900).toBeDefined();
    expect(flatColorTokens.red600).toBeDefined();
  });

  it('has a non-empty space bag', () => {
    expect(tamaguiTokens.space).toBeDefined();
    expect(Object.keys(tamaguiTokens.space).length).toBeGreaterThan(5);
  });

  it('has a non-empty radius bag', () => {
    expect(tamaguiTokens.radius).toBeDefined();
    expect(Object.keys(tamaguiTokens.radius).length).toBeGreaterThan(3);
  });

  it('has a non-empty zIndex bag', () => {
    expect(tamaguiTokens.zIndex).toBeDefined();
    expect(Object.keys(tamaguiTokens.zIndex).length).toBeGreaterThan(3);
  });
});

describe('typography token bag', () => {
  it('exposes fontSizes, fontWeights, lineHeights, letterSpacings', () => {
    expect(typographyTokens.fontSizes.$5).toBeDefined();
    expect(typographyTokens.fontWeights.regular).toBeDefined();
    expect(typographyTokens.lineHeights.$5).toBeDefined();
    expect(typographyTokens.letterSpacings.normal).toBe(0);
  });
});
