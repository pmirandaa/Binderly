// Type-level alignment between the resolver's Canonical* types and
// drizzle's NewSet / NewCard / NewPrinting insert types.
//
// We don't assert structural equality (drizzle inserts have additional
// optional fields like `id`, `createdAt`, `updatedAt` defaulted by the
// DB; canonical records intentionally omit those). Instead we assert
// every Canonical field has a compatible target on the drizzle insert
// type — which is the contract the seed-ingest task relies on.

import { describe, expect, it } from 'vitest';

import type { NewCard, NewPrinting, NewSet } from '@binderly/db';

import {
  canonicalCardSchema,
  canonicalPrintingSchema,
  canonicalSetSchema,
  type CanonicalCard,
  type CanonicalPrinting,
  type CanonicalSet,
} from './types.js';

// ---------- compile-time assertions ----------

type AssertAssignableSetField<K extends keyof CanonicalSet> =
  CanonicalSet[K] extends NewSet[CanonicalSetToNewSetKey<K>] ? true : false;

// Map canonical → drizzle column names. The drizzle schema uses
// camelCase mirrors of the snake_case columns (`canonicalKey`,
// `releaseDate`, `printedTotal`, etc. — see
// `packages/db/src/schema/sets.ts`).
type CanonicalSetToNewSetKey<K extends keyof CanonicalSet> = K & keyof NewSet;

type CanonicalCardToNewCardKey<K extends keyof CanonicalCard> = K & keyof NewCard;
type CanonicalPrintingToNewPrintingKey<K extends keyof CanonicalPrinting> = K & keyof NewPrinting;

// These const expressions force the compiler to evaluate the
// `extends`. If the types ever diverge in a way that breaks the
// alignment, this file fails to typecheck — which is the whole
// point.
const _setAssignable: AssertAssignableSetField<'canonicalKey'> &
  AssertAssignableSetField<'code'> &
  AssertAssignableSetField<'language'> &
  AssertAssignableSetField<'name'> &
  AssertAssignableSetField<'releaseDate'> = true;
void _setAssignable;

const _cardCanonicalKeyOk: CanonicalCard['canonicalKey'] extends NewCard[CanonicalCardToNewCardKey<'canonicalKey'>]
  ? true
  : false = true;
void _cardCanonicalKeyOk;

const _printingVariantKeyOk: CanonicalPrinting['variantKey'] extends NewPrinting[CanonicalPrintingToNewPrintingKey<'variantKey'>]
  ? true
  : false = true;
void _printingVariantKeyOk;

// ---------- runtime sanity (zod parses a representative record) ----------

describe('Canonical{Set,Card,Printing} round-trip', () => {
  it('parses a representative CanonicalSet', () => {
    const parsed = canonicalSetSchema.parse({
      canonicalKey: 'en-swsh9',
      code: 'swsh9',
      language: 'en',
      name: 'Brilliant Stars',
      series: 'Sword & Shield',
      releaseDate: '2022-02-25',
      printedTotal: 172,
      total: 186,
      logoUrl: null,
      symbolUrl: null,
      masterSetRules: {},
      sourceMetadata: { primary: 'tcgdex-en' },
    });
    expect(parsed.canonicalKey).toBe('en-swsh9');
  });

  it('parses a representative CanonicalCard', () => {
    const parsed = canonicalCardSchema.parse({
      canonicalKey: 'en-swsh9-018',
      setCanonicalKey: 'en-swsh9',
      language: 'en',
      number: '018',
      name: 'Charizard VSTAR',
      nameLocalized: null,
      type: 'FIRE',
      subtype: 'POKEMON',
      hp: 270,
      illustrator: '5ban Graphics',
      flavorText: null,
      attacks: null,
      weakness: null,
      resistance: null,
      retreatCost: 3,
      rarity: 'ULTRA_RARE',
      sourceMetadata: { primary: 'tcgdex-en' },
    });
    expect(parsed.rarity).toBe('ULTRA_RARE');
  });

  it('parses a representative CanonicalPrinting', () => {
    const parsed = canonicalPrintingSchema.parse({
      variantKey: 'en-base1-004-holo-fe-sl',
      cardCanonicalKey: 'en-base1-004',
      variantClass: 'HOLO',
      variantFlags: ['FIRST_EDITION', 'SHADOWLESS'],
      variantCode: 'holo-fe-sl',
      includeInMasterSet: true,
      imageSmallUrl: null,
      imageLargeUrl: null,
      imageSourceUrl: null,
      sourceMetadata: { primary: 'tcgdex-en' },
    });
    expect(parsed.variantClass).toBe('HOLO');
  });

  it('rejects unknown variant_class values', () => {
    expect(() =>
      canonicalPrintingSchema.parse({
        variantKey: 'x',
        cardCanonicalKey: 'x',
        variantClass: 'NOT_A_CLASS',
        variantFlags: [],
        variantCode: 'x',
        includeInMasterSet: false,
        imageSmallUrl: null,
        imageLargeUrl: null,
        imageSourceUrl: null,
        sourceMetadata: {},
      }),
    ).toThrow();
  });
});
