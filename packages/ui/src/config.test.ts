import { describe, expect, it } from 'vitest';

import defaultExport, { tamaguiConfig } from './config.js';

describe('createTamagui config', () => {
  it('exports the same config as both default and named export', () => {
    expect(defaultExport).toBe(tamaguiConfig);
  });

  it('declares both light and dark themes', () => {
    expect(tamaguiConfig.themes).toBeDefined();
    expect(Object.keys(tamaguiConfig.themes)).toContain('light');
    expect(Object.keys(tamaguiConfig.themes)).toContain('dark');
  });

  it('declares the body / heading / mono fonts', () => {
    expect(tamaguiConfig.fonts).toBeDefined();
    expect(tamaguiConfig.fonts.body).toBeDefined();
    expect(tamaguiConfig.fonts.heading).toBeDefined();
    expect(tamaguiConfig.fonts.mono).toBeDefined();
  });

  it('declares media queries for sm/md/lg/xl/2xl', () => {
    expect(tamaguiConfig.media).toBeDefined();
    const keys = Object.keys(tamaguiConfig.media);
    expect(keys).toContain('sm');
    expect(keys).toContain('md');
    expect(keys).toContain('lg');
    expect(keys).toContain('xl');
    expect(keys).toContain('2xl');
  });

  it('declares a default font', () => {
    expect(tamaguiConfig.defaultFont).toBe('body');
  });
});
