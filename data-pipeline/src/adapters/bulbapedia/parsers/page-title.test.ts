import { describe, expect, it } from 'vitest';

import { parseCardPageTitle, parseSetPageTitle } from './page-title.js';

describe('parseCardPageTitle', () => {
  it('parses a vintage card', () => {
    expect(parseCardPageTitle('Charizard (Base Set 4)')).toEqual({
      name: 'Charizard',
      setName: 'Base Set',
      number: '4',
    });
  });

  it('parses a multi-word card name + multi-word set', () => {
    expect(parseCardPageTitle('Charizard VSTAR (Brilliant Stars 174)')).toEqual({
      name: 'Charizard VSTAR',
      setName: 'Brilliant Stars',
      number: '174',
    });
  });

  it('parses a Trainer Gallery numbered card', () => {
    expect(parseCardPageTitle('Charizard VSTAR (Brilliant Stars TG10)')).toEqual({
      name: 'Charizard VSTAR',
      setName: 'Brilliant Stars',
      number: 'TG10',
    });
  });

  it('parses a SWSH-lettered promo card', () => {
    expect(parseCardPageTitle('Lugia V (SWSH Black Star Promos SWSH285)')).toEqual({
      name: 'Lugia V',
      setName: 'SWSH Black Star Promos',
      number: 'SWSH285',
    });
  });

  it('preserves unicode in the card name', () => {
    expect(parseCardPageTitle('Charizard δ (EX Holon Phantoms 100)')).toEqual({
      name: 'Charizard δ',
      setName: 'EX Holon Phantoms',
      number: '100',
    });
  });

  it('returns null for non-matching titles', () => {
    expect(parseCardPageTitle('No parens')).toBeNull();
    expect(parseCardPageTitle('Foo (NoNumber)')).toBeNull();
    expect(parseCardPageTitle('(Just parens 1)')).toBeNull();
    expect(parseCardPageTitle('')).toBeNull();
  });
});

describe('parseSetPageTitle', () => {
  it('parses a TCG set page title', () => {
    expect(parseSetPageTitle('Brilliant Stars (TCG)')).toEqual({ name: 'Brilliant Stars' });
    expect(parseSetPageTitle('Base Set (TCG)')).toEqual({ name: 'Base Set' });
  });

  it('returns null for non-TCG titles', () => {
    expect(parseSetPageTitle('Brilliant Stars')).toBeNull();
    expect(parseSetPageTitle('Charizard (Base Set 4)')).toBeNull();
  });
});
