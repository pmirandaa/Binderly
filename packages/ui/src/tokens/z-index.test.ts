import { describe, expect, it } from 'vitest';

import { Z_INDEX_ORDER, zIndex } from './z-index.js';

describe('z-index tokens', () => {
  it('declares every layer in the canonical inventory', () => {
    expect(zIndex.hide).toBe(-1);
    expect(zIndex.base).toBe(0);
    expect(zIndex.raised).toBeGreaterThan(0);
    expect(zIndex.tooltip).toBeGreaterThan(zIndex.toast);
  });

  it('Z_INDEX_ORDER is strictly monotone increasing', () => {
    let prev = -Infinity;
    for (const key of Z_INDEX_ORDER) {
      const v = zIndex[key];
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('tooltip sits above toast above popover above modal above overlay', () => {
    expect(zIndex.tooltip).toBeGreaterThan(zIndex.toast);
    expect(zIndex.toast).toBeGreaterThan(zIndex.popover);
    expect(zIndex.popover).toBeGreaterThan(zIndex.modal);
    expect(zIndex.modal).toBeGreaterThan(zIndex.overlay);
  });

  it('every layer name appears once in Z_INDEX_ORDER', () => {
    expect(new Set(Z_INDEX_ORDER).size).toBe(Z_INDEX_ORDER.length);
  });
});
