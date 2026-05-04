// Pokémon type and card subtype normalization tests.

import { describe, expect, it } from 'vitest';

import { normalizeCardSubtype, normalizePokemonType } from './type.js';

describe('normalizePokemonType', () => {
  it('maps the canonical names directly', () => {
    expect(normalizePokemonType('GRASS')).toBe('GRASS');
    expect(normalizePokemonType('FIRE')).toBe('FIRE');
    expect(normalizePokemonType('LIGHTNING')).toBe('LIGHTNING');
    expect(normalizePokemonType('PSYCHIC')).toBe('PSYCHIC');
  });

  it('maps Lightning ↔ Electric synonyms', () => {
    expect(normalizePokemonType('Electric')).toBe('LIGHTNING');
    expect(normalizePokemonType('ELECTRIC')).toBe('LIGHTNING');
  });

  it('maps Steel → METAL', () => {
    expect(normalizePokemonType('Steel')).toBe('METAL');
  });

  it('maps Dark → DARKNESS', () => {
    expect(normalizePokemonType('Dark')).toBe('DARKNESS');
  });

  it('maps Normal → COLORLESS (vintage Bulbapedia variant)', () => {
    expect(normalizePokemonType('Normal')).toBe('COLORLESS');
  });

  it('returns null for empty / nullish input', () => {
    expect(normalizePokemonType(null)).toBeNull();
    expect(normalizePokemonType(undefined)).toBeNull();
    expect(normalizePokemonType('')).toBeNull();
    expect(normalizePokemonType('   ')).toBeNull();
  });

  it('throws on unknown type — caller surfaces as conflict', () => {
    expect(() => normalizePokemonType('Bug')).toThrow(/unknown pokemon type/);
  });
});

describe('normalizeCardSubtype', () => {
  it('maps Pokémon variants', () => {
    expect(normalizeCardSubtype('Pokemon')).toBe('POKEMON');
    expect(normalizeCardSubtype('Pokémon')).toBe('POKEMON');
    expect(normalizeCardSubtype('POKEMON')).toBe('POKEMON');
  });

  it('maps trainer subtypes', () => {
    expect(normalizeCardSubtype('Item')).toBe('TRAINER_ITEM');
    expect(normalizeCardSubtype('Supporter')).toBe('TRAINER_SUPPORTER');
    expect(normalizeCardSubtype('Stadium')).toBe('TRAINER_STADIUM');
    expect(normalizeCardSubtype('Tool')).toBe('TRAINER_TOOL');
    expect(normalizeCardSubtype('Pokémon Tool')).toBe('TRAINER_POKEMON_TOOL');
  });

  it('maps energy subtypes', () => {
    expect(normalizeCardSubtype('Basic Energy')).toBe('ENERGY_BASIC');
    expect(normalizeCardSubtype('Special Energy')).toBe('ENERGY_SPECIAL');
  });

  it('returns null for missing input', () => {
    expect(normalizeCardSubtype(null)).toBeNull();
    expect(normalizeCardSubtype(undefined)).toBeNull();
    expect(normalizeCardSubtype('')).toBeNull();
  });

  it('throws on unknown subtype', () => {
    expect(() => normalizeCardSubtype('Mystery')).toThrow(/unknown card subtype/);
  });
});
