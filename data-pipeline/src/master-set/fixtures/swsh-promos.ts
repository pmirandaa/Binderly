// Hand-curated fixture: SWSH Black Star Promos (en-swshp).
//
// Purpose: prove the engine treats a promo "set" correctly per § 3 —
// each promo printing belongs to the promo set's master, not the
// main set's. Also exercises the pattern variant (Master Ball
// pattern Pikachu V) which is Pablo's explicit master-set inclusion
// per § 2, and a STAMPED_STAFF promo that the classifier defaults
// out and the engine keeps out (default `include_staff: undefined →
// classifier default = false).
//
// `master_set_rules: {}` (empty) — defaults are correct per Pablo's
// spec.

import type { MasterSetFixture } from './types.js';

const SET_KEY = 'en-swshp';

export const swshPromosFixture: MasterSetFixture = {
  label: 'SWSH Black Star Promos (en-swshp) — pattern + staff promos',
  set: {
    canonicalKey: SET_KEY,
    masterSetRules: {},
  },
  printings: [
    // Pikachu V Master Ball Pattern (SWSH284). Pablo's explicit
    // master-set inclusion. Class is NON_HOLO + MASTER_BALL_PATTERN
    // flag.
    {
      variantKey: `${SET_KEY}-SWSH284-nonholo-mb`,
      variantClass: 'NON_HOLO',
      variantFlags: ['MASTER_BALL_PATTERN'],
      includeInMasterSetDefault: true,
    },
    // Pikachu V Poké Ball Pattern (SWSH285).
    {
      variantKey: `${SET_KEY}-SWSH285-nonholo-pb`,
      variantClass: 'NON_HOLO',
      variantFlags: ['POKE_BALL_PATTERN'],
      includeInMasterSetDefault: true,
    },
    // Vanilla Black Star promo with the PROMO class.
    {
      variantKey: `${SET_KEY}-SWSH001-promo`,
      variantClass: 'PROMO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Staff-stamped promo — excluded by classifier default
    // (`STAMPED_STAFF` flag → false). § 2 "Always excluded by default".
    {
      variantKey: `${SET_KEY}-SWSH050-promo-staff`,
      variantClass: 'PROMO',
      variantFlags: ['STAMPED_STAFF'],
      includeInMasterSetDefault: false,
    },
    // Prerelease build-and-battle stamped promo — included by default
    // (no STAMPED_STAFF / ERROR; HOLO class default is true).
    {
      variantKey: `${SET_KEY}-SWSH060-holo-bb`,
      variantClass: 'HOLO',
      variantFlags: ['STAMPED_BUILDBATTLE'],
      includeInMasterSetDefault: true,
    },
  ],
  expected: new Map<string, boolean>([
    [`${SET_KEY}-SWSH284-nonholo-mb`, true],
    [`${SET_KEY}-SWSH285-nonholo-pb`, true],
    [`${SET_KEY}-SWSH001-promo`, true],
    [`${SET_KEY}-SWSH050-promo-staff`, false],
    [`${SET_KEY}-SWSH060-holo-bb`, true],
  ]),
};
