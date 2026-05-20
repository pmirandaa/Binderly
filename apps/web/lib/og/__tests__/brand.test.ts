import { describe, expect, it } from 'vitest';

import { BRAND, BRAND_BACKGROUND_GRADIENT } from '../brand';

describe('BRAND tokens', () => {
  // Cross-checked against `packages/ui/src/tokens/colors.ts`. If
  // the design system swaps the brand teal / violet, both files
  // must be updated together.
  it('primary === teal.500 (#0FA3A3)', () => {
    expect(BRAND.primary).toBe('#0FA3A3');
  });
  it('primaryDark === teal.700 (#106A6A)', () => {
    expect(BRAND.primaryDark).toBe('#106A6A');
  });
  it('secondary === violet.500 (#7B5DFF)', () => {
    expect(BRAND.secondary).toBe('#7B5DFF');
  });
  it('background === neutral.950 (#020617)', () => {
    expect(BRAND.background).toBe('#020617');
  });
  it('surface === neutral.900 (#0F172A)', () => {
    expect(BRAND.surface).toBe('#0F172A');
  });
  it('text === neutral.50 (#F8FAFC)', () => {
    expect(BRAND.text).toBe('#F8FAFC');
  });
  it('every brand value is a valid 6-digit hex literal', () => {
    const hexRegex = /^#[0-9A-F]{6}$/i;
    for (const value of Object.values(BRAND)) {
      expect(value).toMatch(hexRegex);
    }
  });
});

describe('BRAND_BACKGROUND_GRADIENT', () => {
  it('uses the documented 3-stop linear gradient', () => {
    expect(BRAND_BACKGROUND_GRADIENT).toContain('linear-gradient(135deg');
    expect(BRAND_BACKGROUND_GRADIENT).toContain(BRAND.background);
    expect(BRAND_BACKGROUND_GRADIENT).toContain(BRAND.primaryDark);
    expect(BRAND_BACKGROUND_GRADIENT).toContain(BRAND.secondary);
  });
  it('background stop comes first, secondary last (135deg → corner)', () => {
    const bgIdx = BRAND_BACKGROUND_GRADIENT.indexOf(BRAND.background);
    const secondaryIdx = BRAND_BACKGROUND_GRADIENT.indexOf(BRAND.secondary);
    expect(bgIdx).toBeGreaterThanOrEqual(0);
    expect(secondaryIdx).toBeGreaterThan(bgIdx);
  });
});
