// Hand-curated fixture: Base Set (en-base1, 1999).
//
// Purpose: prove the engine handles a vintage set with three distinct
// printings of every holo (1st-Edition Shadowless, Shadowless,
// Unlimited) and an ERROR-flagged variant. § 3 of tcg-domain.md
// explicitly enumerates Base Set as the canonical "three printings"
// case; "Errors and misprints" rule excludes the Pikachu Red Cheeks
// printing from the master.
//
// The fixture deliberately uses representative — not exhaustive —
// printings: enough variant types to exercise every default code
// path, not the full 102-card set. Real ingestion will produce the
// full set; this fixture proves the engine's behavior is correct
// where it matters.
//
// Expected master-set membership comes from running the variant
// classifier defaults (`include_in_master_set_default`) PLUS
// applying Base Set's `master_set_rules: {}` (no overrides — defaults
// hold). Documented inline.

import type { MasterSetFixture } from './types.js';

const SET_KEY = 'en-base1';

export const baseSetFixture: MasterSetFixture = {
  label: 'Base Set (en-base1) — three printings of Charizard + an ERROR variant',
  set: {
    canonicalKey: SET_KEY,
    // Empty rules — defaults are correct for Base Set per § 2 / § 3.
    masterSetRules: {},
  },
  printings: [
    // Charizard #4 — three distinct printings, all master-included.
    {
      variantKey: `${SET_KEY}-004-holo-fe-sl`,
      variantClass: 'HOLO',
      variantFlags: ['FIRST_EDITION', 'SHADOWLESS'],
      includeInMasterSetDefault: true,
    },
    {
      variantKey: `${SET_KEY}-004-holo-sl`,
      variantClass: 'HOLO',
      variantFlags: ['SHADOWLESS'],
      includeInMasterSetDefault: true,
    },
    {
      variantKey: `${SET_KEY}-004-holo`,
      variantClass: 'HOLO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Pikachu #58 — common non-holo card.
    {
      variantKey: `${SET_KEY}-058-nonholo`,
      variantClass: 'NON_HOLO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
    // Pikachu Red Cheeks — known printing error, EXCLUDED from master.
    // § 3 "Errors and misprints" rule.
    {
      variantKey: `${SET_KEY}-058-nonholo-err`,
      variantClass: 'NON_HOLO',
      variantFlags: ['ERROR'],
      includeInMasterSetDefault: false,
    },
    // Lightning Energy #100 — basic energy, master-included.
    {
      variantKey: `${SET_KEY}-100-nonholo`,
      variantClass: 'NON_HOLO',
      variantFlags: [],
      includeInMasterSetDefault: true,
    },
  ],
  expected: new Map<string, boolean>([
    [`${SET_KEY}-004-holo-fe-sl`, true],
    [`${SET_KEY}-004-holo-sl`, true],
    [`${SET_KEY}-004-holo`, true],
    [`${SET_KEY}-058-nonholo`, true],
    [`${SET_KEY}-058-nonholo-err`, false],
    [`${SET_KEY}-100-nonholo`, true],
  ]),
};
