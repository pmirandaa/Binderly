// Hand-curated fixture: Brilliant Stars (en-swsh9, 2022).
//
// Purpose: prove the engine handles a modern set with the full
// variant zoo — REVERSE_HOLO, RAINBOW (numbered above printed_total
// but classified as RAINBOW per § 8 of tcg-domain.md), SECRET_RARE,
// ALT_ART, TRAINER_GALLERY, plus a TG REVERSE_HOLO. printed_total is
// 172 / total is 186 (14 cards above the printed total).
//
// Brilliant Stars uses default rules — `master_set_rules: {}` — so
// every default-include class flips to true and the engine is mostly
// a passthrough. The interest is the variety of classes proving the
// engine doesn't accidentally exclude any.

import type { MasterSetFixture } from './types.js';

const SET_KEY = 'en-swsh9';

export const brilliantStarsFixture: MasterSetFixture = {
  label: 'Brilliant Stars (en-swsh9) — modern variant zoo with TG sub-set',
  set: {
    canonicalKey: SET_KEY,
    masterSetRules: {},
  },
  printings: [
    // Charizard VSTAR #018 — regular HOLO.
    {
      variantKey: `${SET_KEY}-018-holo`,
      variantClass: 'HOLO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Charizard VSTAR #018 — REVERSE_HOLO.
    {
      variantKey: `${SET_KEY}-018-revholo`,
      variantClass: 'REVERSE_HOLO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Charizard VSTAR #154 — Full Art.
    {
      variantKey: `${SET_KEY}-154-fullart`,
      variantClass: 'FULL_ART',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Charizard VSTAR #174 — Rainbow Rare. Numbered above
    // printed_total (172), but classified RAINBOW (not SECRET_RARE)
    // per § 8 step ordering — explicit visual class wins.
    {
      variantKey: `${SET_KEY}-174-rainbow`,
      variantClass: 'RAINBOW',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Sylveon VSTAR #185 — Alt Art / Special Illustration Rare.
    {
      variantKey: `${SET_KEY}-185-altart`,
      variantClass: 'ALT_ART',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Arceus #186 — Gold (Hyper Rare).
    {
      variantKey: `${SET_KEY}-186-gold`,
      variantClass: 'GOLD',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // A regular common to round out the set %.
    {
      variantKey: `${SET_KEY}-001-nonholo`,
      variantClass: 'NON_HOLO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Trainer Gallery: Charizard #TG03 (HOLO sub-set).
    {
      variantKey: `${SET_KEY}-TG03-tg`,
      variantClass: 'TRAINER_GALLERY',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Trainer Gallery REVERSE_HOLO printing of the same card.
    {
      variantKey: `${SET_KEY}-TG03-tg-revholo`,
      variantClass: 'TRAINER_GALLERY',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // A SECRET_RARE numbered above printed_total with no other class
    // signal — survives § 8's secret-rare numerical rule.
    {
      variantKey: `${SET_KEY}-180-secret`,
      variantClass: 'SECRET_RARE',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
  ],
  expected: new Map<string, boolean>([
    [`${SET_KEY}-018-holo`, true],
    [`${SET_KEY}-018-revholo`, true],
    [`${SET_KEY}-154-fullart`, true],
    [`${SET_KEY}-174-rainbow`, true],
    [`${SET_KEY}-185-altart`, true],
    [`${SET_KEY}-186-gold`, true],
    [`${SET_KEY}-001-nonholo`, true],
    [`${SET_KEY}-TG03-tg`, true],
    [`${SET_KEY}-TG03-tg-revholo`, true],
    [`${SET_KEY}-180-secret`, true],
  ]),
};
