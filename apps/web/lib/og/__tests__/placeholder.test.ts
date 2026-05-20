import { describe, expect, it } from 'vitest';

import { BRAND } from '../brand';
import { PLACEHOLDER_DATA_URI, PLACEHOLDER_SVG } from '../placeholder';

describe('PLACEHOLDER_SVG', () => {
  it('declares the svg viewBox for the lower-third tile aspect ratio', () => {
    expect(PLACEHOLDER_SVG).toContain('viewBox="0 0 290 400"');
  });

  it('uses the brand surface + primary palette so it harmonises with the card background', () => {
    expect(PLACEHOLDER_SVG).toContain(BRAND.surface);
    expect(PLACEHOLDER_SVG).toContain(BRAND.primary);
    expect(PLACEHOLDER_SVG).toContain(BRAND.primaryDark);
  });
});

describe('PLACEHOLDER_DATA_URI', () => {
  it('is an svg+xml base64 data URI', () => {
    expect(PLACEHOLDER_DATA_URI.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('round-trips back to the source SVG when decoded', () => {
    const base64 = PLACEHOLDER_DATA_URI.replace('data:image/svg+xml;base64,', '');
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    expect(decoded).toBe(PLACEHOLDER_SVG);
  });

  it('is < 4 KB so it can be inlined in every render', () => {
    expect(PLACEHOLDER_DATA_URI.length).toBeLessThan(4_096);
  });
});
