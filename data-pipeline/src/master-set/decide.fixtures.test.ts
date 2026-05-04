// Round-trip fixture tests: feed each hand-curated TCG set through
// the engine with default (or set-specific) rules and assert the
// decision Map matches the hand-curated expected master-set list.
//
// These tests catch regressions where a refactor changes the engine's
// behavior on real-world data. The fixtures live under
// `./fixtures/`; expected master-set membership is documented inline
// in each fixture per § 2 / § 3 of `context/tcg-domain.md`.

import { describe, expect, it } from 'vitest';

import { decideMasterSetMembership } from './decide.js';
import {
  baseSetFixture,
  brilliantStarsFixture,
  swshPromosFixture,
  type MasterSetFixture,
} from './fixtures/index.js';

const FIXTURES: ReadonlyArray<MasterSetFixture> = [
  baseSetFixture,
  brilliantStarsFixture,
  swshPromosFixture,
];

describe('decideMasterSetMembership — fixture round-trips', () => {
  for (const fixture of FIXTURES) {
    it(fixture.label, () => {
      const result = decideMasterSetMembership({
        set: fixture.set,
        printings: fixture.printings,
      });

      // Decision Map size matches.
      expect(result.decisions.size).toBe(fixture.expected.size);

      // Every expected (variant_key, value) is present in decisions.
      for (const [variantKey, expected] of fixture.expected) {
        expect(
          result.decisions.get(variantKey),
          `${fixture.label}: ${variantKey} expected ${expected}`,
        ).toBe(expected);
      }
    });
  }

  it('Base Set master-set has 5 included printings (all but the ERROR variant)', () => {
    const result = decideMasterSetMembership({
      set: baseSetFixture.set,
      printings: baseSetFixture.printings,
    });
    const includedCount = [...result.decisions.values()].filter((v) => v === true).length;
    expect(includedCount).toBe(5);
  });

  it('SWSH promos: STAFF excluded; pattern + buildbattle + plain promo included', () => {
    const result = decideMasterSetMembership({
      set: swshPromosFixture.set,
      printings: swshPromosFixture.printings,
    });
    const includedCount = [...result.decisions.values()].filter((v) => v === true).length;
    expect(includedCount).toBe(4);
  });

  it('Brilliant Stars: every classifier-default-include printing flows through', () => {
    const result = decideMasterSetMembership({
      set: brilliantStarsFixture.set,
      printings: brilliantStarsFixture.printings,
    });
    const includedCount = [...result.decisions.values()].filter((v) => v === true).length;
    expect(includedCount).toBe(brilliantStarsFixture.printings.length);
    // No overrides fired since the fixture uses {} rules.
    expect(result.overridesApplied.size).toBe(0);
  });
});
