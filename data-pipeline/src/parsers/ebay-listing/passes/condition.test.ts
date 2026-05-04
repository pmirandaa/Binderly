import { describe, expect, it } from 'vitest';

import { detectCondition } from './condition.js';

describe('detectCondition', () => {
  it.each([
    ['charizard near mint', 'NEAR_MINT'],
    ['charizard near-mint', 'NEAR_MINT'],
    ['charizard nm', 'NEAR_MINT'],
    ['charizard lightly played', 'LIGHTLY_PLAYED'],
    ['charizard lp', 'LIGHTLY_PLAYED'],
    ['charizard moderately played', 'MODERATELY_PLAYED'],
    ['charizard mp', 'MODERATELY_PLAYED'],
    ['charizard heavily played', 'HEAVILY_PLAYED'],
    ['charizard hp', 'HEAVILY_PLAYED'],
    ['charizard damaged', 'DAMAGED'],
    ['charizard dmg', 'DAMAGED'],
    ['charizard poor', 'DAMAGED'],
    ['charizard mint', 'MINT'],
    ['charizard played', 'MODERATELY_PLAYED'],
  ])('%s → %s', (input, expected) => {
    expect(detectCondition(input).condition).toBe(expected);
  });

  it('"near mint" wins over "mint"', () => {
    expect(detectCondition('charizard near mint').condition).toBe('NEAR_MINT');
  });

  it('returns null when no condition fires', () => {
    expect(detectCondition('charizard 4/102 base set').condition).toBeNull();
  });

  it('redacts the matched span', () => {
    const r = detectCondition('charizard near mint');
    expect(r.remaining).not.toContain('near mint');
    expect(r.remaining).toContain('charizard');
  });
});
