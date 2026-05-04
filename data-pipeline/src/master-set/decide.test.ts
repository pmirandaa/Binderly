// Engine tests for `decideMasterSetMembership`.
//
// Coverage:
//   - Empty rules → classifier defaults flow through.
//   - Each set-level toggle (pattern, staff, prerelease, league,
//     buildbattle, championship, textured, trainer_gallery, error)
//     flips the matching printings and ONLY those printings.
//   - Per-printing exclude / include precedence over toggles and
//     defaults.
//   - Per-printing inclusion wins on collision with per-printing
//     exclusion.
//   - Toggle precedence order (textured/TG class < pattern/stamps <
//     staff < error) when a printing matches multiple toggles.
//   - Idempotency (deep-equal Maps across two calls).
//   - Trace correctness (only printings whose final differs from
//     default appear in `overridesApplied`, with the right reason).
//   - Malformed `set.masterSetRules` throws ZodError.

import { describe, expect, it } from 'vitest';

import {
  decideMasterSetMembership,
  type DecideMasterSetMembershipInput,
  type MasterSetDecisionInput,
} from './decide.js';

import type { VariantClass, VariantFlag } from '../types.js';
import type { MasterSetRulesOverrides } from './types.js';

function p(
  variantKey: string,
  variantClass: VariantClass,
  variantFlags: VariantFlag[] = [],
  includeInMasterSetDefault = true,
): MasterSetDecisionInput {
  return { variantKey, variantClass, variantFlags, includeInMasterSetDefault };
}

function input(
  printings: ReadonlyArray<MasterSetDecisionInput>,
  masterSetRules: Record<string, unknown> = {},
): DecideMasterSetMembershipInput {
  return {
    set: { canonicalKey: 'en-test', masterSetRules },
    printings,
  };
}

describe('decideMasterSetMembership — defaults', () => {
  it('empty rules → every printing gets its classifier default', () => {
    const printings = [
      p('a-holo', 'HOLO', [], true),
      p('b-nonholo-err', 'NON_HOLO', ['ERROR'], false),
      p('c-secret', 'SECRET_RARE', [], true),
      p('d-promo-staff', 'PROMO', ['STAMPED_STAFF'], false),
    ];
    const result = decideMasterSetMembership(input(printings));
    expect(result.decisions.get('a-holo')).toBe(true);
    expect(result.decisions.get('b-nonholo-err')).toBe(false);
    expect(result.decisions.get('c-secret')).toBe(true);
    expect(result.decisions.get('d-promo-staff')).toBe(false);
    // No overrides applied — every printing matched its default.
    expect(result.overridesApplied.size).toBe(0);
  });

  it('returns one decision per input printing, preserving variant_key', () => {
    const printings = [p('x', 'HOLO'), p('y', 'NON_HOLO')];
    const result = decideMasterSetMembership(input(printings));
    expect(result.decisions.size).toBe(2);
    expect([...result.decisions.keys()].sort()).toEqual(['x', 'y']);
  });
});

describe('decideMasterSetMembership — set-level toggles', () => {
  it('include_pattern_variants: false flips POKE_BALL_PATTERN to false', () => {
    const printings = [
      p('pb', 'NON_HOLO', ['POKE_BALL_PATTERN'], true),
      p('mb', 'NON_HOLO', ['MASTER_BALL_PATTERN'], true),
      p('plain', 'NON_HOLO', [], true),
    ];
    const result = decideMasterSetMembership(input(printings, { include_pattern_variants: false }));
    expect(result.decisions.get('pb')).toBe(false);
    expect(result.decisions.get('mb')).toBe(false);
    expect(result.decisions.get('plain')).toBe(true);
    expect(result.overridesApplied.get('pb')?.toggle).toBe('include_pattern_variants');
  });

  it('include_staff: true flips STAMPED_STAFF to true (override of default false)', () => {
    const printings = [p('staff', 'PROMO', ['STAMPED_STAFF'], false)];
    const result = decideMasterSetMembership(input(printings, { include_staff: true }));
    expect(result.decisions.get('staff')).toBe(true);
    expect(result.overridesApplied.get('staff')?.reason).toBe('set_toggle');
    expect(result.overridesApplied.get('staff')?.toggle).toBe('include_staff');
  });

  it('include_error: true flips ERROR-flagged printings to true (rare set-specific override)', () => {
    const printings = [p('err', 'NON_HOLO', ['ERROR'], false)];
    const result = decideMasterSetMembership(input(printings, { include_error: true }));
    expect(result.decisions.get('err')).toBe(true);
    expect(result.overridesApplied.get('err')?.toggle).toBe('include_error');
  });

  it('include_textured: false flips TEXTURED class to false', () => {
    const printings = [p('tex', 'TEXTURED', [], true)];
    const result = decideMasterSetMembership(input(printings, { include_textured: false }));
    expect(result.decisions.get('tex')).toBe(false);
    expect(result.overridesApplied.get('tex')?.toggle).toBe('include_textured');
  });

  it('include_trainer_gallery: false flips TRAINER_GALLERY class to false', () => {
    const printings = [p('tg', 'TRAINER_GALLERY', [], true)];
    const result = decideMasterSetMembership(input(printings, { include_trainer_gallery: false }));
    expect(result.decisions.get('tg')).toBe(false);
    expect(result.overridesApplied.get('tg')?.toggle).toBe('include_trainer_gallery');
  });

  it('include_prerelease: false flips STAMPED_PRERELEASE to false (vintage prerelease exclusion)', () => {
    const printings = [p('pre', 'HOLO', ['STAMPED_PRERELEASE'], true)];
    const result = decideMasterSetMembership(input(printings, { include_prerelease: false }));
    expect(result.decisions.get('pre')).toBe(false);
  });

  it('include_league / include_buildbattle / include_championship each flip their flag', () => {
    const printings = [
      p('league', 'HOLO', ['STAMPED_LEAGUE'], true),
      p('bb', 'HOLO', ['STAMPED_BUILDBATTLE'], true),
      p('champ', 'HOLO', ['STAMPED_CHAMPIONSHIP'], true),
    ];
    const result = decideMasterSetMembership(
      input(printings, {
        include_league: false,
        include_buildbattle: false,
        include_championship: false,
      }),
    );
    expect(result.decisions.get('league')).toBe(false);
    expect(result.decisions.get('bb')).toBe(false);
    expect(result.decisions.get('champ')).toBe(false);
  });

  it('toggle that matches default is a no-op (no trace entry)', () => {
    const printings = [p('pb', 'NON_HOLO', ['POKE_BALL_PATTERN'], true)];
    const result = decideMasterSetMembership(
      input(printings, { include_pattern_variants: true }), // already true by default
    );
    expect(result.decisions.get('pb')).toBe(true);
    // Final == default, so no trace.
    expect(result.overridesApplied.has('pb')).toBe(false);
  });

  it('a printing with no flags / no class toggle is unaffected by toggles', () => {
    const printings = [p('plain-holo', 'HOLO', [], true)];
    const result = decideMasterSetMembership(
      input(printings, {
        include_staff: true,
        include_pattern_variants: false,
        include_textured: false,
      }),
    );
    expect(result.decisions.get('plain-holo')).toBe(true);
    expect(result.overridesApplied.size).toBe(0);
  });
});

describe('decideMasterSetMembership — per-printing overrides', () => {
  it('per-printing exclusion wins over default include', () => {
    const printings = [p('drop-me', 'HOLO', [], true)];
    const result = decideMasterSetMembership(
      input(printings, { additional_excluded_variant_keys: ['drop-me'] }),
    );
    expect(result.decisions.get('drop-me')).toBe(false);
    expect(result.overridesApplied.get('drop-me')?.reason).toBe('per_printing_excluded');
  });

  it('per-printing inclusion wins over default exclude', () => {
    const printings = [p('keep-me-err', 'NON_HOLO', ['ERROR'], false)];
    const result = decideMasterSetMembership(
      input(printings, { additional_included_variant_keys: ['keep-me-err'] }),
    );
    expect(result.decisions.get('keep-me-err')).toBe(true);
    expect(result.overridesApplied.get('keep-me-err')?.reason).toBe('per_printing_included');
  });

  it('per-printing exclusion wins over set-level toggle inclusion', () => {
    const printings = [p('staff-but-no', 'PROMO', ['STAMPED_STAFF'], false)];
    const result = decideMasterSetMembership(
      input(printings, {
        include_staff: true,
        additional_excluded_variant_keys: ['staff-but-no'],
      }),
    );
    expect(result.decisions.get('staff-but-no')).toBe(false);
    expect(result.overridesApplied.get('staff-but-no')?.reason).toBe('per_printing_excluded');
  });

  it('per-printing inclusion wins over per-printing exclusion when both list the same key', () => {
    // Documented precedence: positive assertions over blanket
    // exclusions. If a key is listed in both, inclusion wins.
    const printings = [p('conflict', 'HOLO', [], true)];
    const result = decideMasterSetMembership(
      input(printings, {
        additional_excluded_variant_keys: ['conflict'],
        additional_included_variant_keys: ['conflict'],
      }),
    );
    expect(result.decisions.get('conflict')).toBe(true);
    expect(result.overridesApplied.get('conflict')?.reason).toBe('per_printing_included');
  });
});

describe('decideMasterSetMembership — toggle precedence order', () => {
  it('include_staff: true beats include_pattern_variants: false on a STAFF + pattern printing', () => {
    // Synthetic edge case (rarely co-occurs IRL). The precedence
    // order puts include_pattern_variants earlier than
    // include_staff. Both toggles fire; staff is later → wins.
    // Default for STAMPED_STAFF is false; staff toggle flips to true.
    const printings = [p('staff-pb', 'NON_HOLO', ['POKE_BALL_PATTERN', 'STAMPED_STAFF'], false)];
    const overrides: MasterSetRulesOverrides = {
      include_pattern_variants: false,
      include_staff: true,
    };
    const result = decideMasterSetMembership(input(printings, overrides));
    expect(result.decisions.get('staff-pb')).toBe(true);
    expect(result.overridesApplied.get('staff-pb')?.toggle).toBe('include_staff');
  });

  it('include_error: true beats include_trainer_gallery: false (ERROR sits last)', () => {
    // Default for ERROR is false; include_error: true should flip
    // it back even when an earlier (include_trainer_gallery: false)
    // toggle would have left it at false.
    const printings = [p('err-tg', 'TRAINER_GALLERY', ['ERROR'], false)];
    const overrides: MasterSetRulesOverrides = {
      include_trainer_gallery: false,
      include_error: true,
    };
    const result = decideMasterSetMembership(input(printings, overrides));
    expect(result.decisions.get('err-tg')).toBe(true);
    expect(result.overridesApplied.get('err-tg')?.toggle).toBe('include_error');
  });

  it('flag toggle (staff) wins over class toggle (textured) when both fire', () => {
    // Default for STAMPED_STAFF is false (flag forces it). If the
    // set says include_textured: false (matches default no-op for
    // this case) and include_staff: true (later in precedence
    // order), staff wins → flips to true.
    const printings = [p('tex-staff', 'TEXTURED', ['STAMPED_STAFF'], false)];
    const overrides: MasterSetRulesOverrides = {
      include_textured: false,
      include_staff: true,
    };
    const result = decideMasterSetMembership(input(printings, overrides));
    expect(result.decisions.get('tex-staff')).toBe(true);
    expect(result.overridesApplied.get('tex-staff')?.toggle).toBe('include_staff');
  });
});

describe('decideMasterSetMembership — purity / idempotency', () => {
  it('same input produces deep-equal output across calls', () => {
    const printings = [
      p('a', 'HOLO'),
      p('b', 'NON_HOLO', ['ERROR'], false),
      p('c', 'TRAINER_GALLERY'),
      p('d', 'NON_HOLO', ['MASTER_BALL_PATTERN']),
    ];
    const overrides = { include_pattern_variants: false, include_trainer_gallery: false };
    const a = decideMasterSetMembership(input(printings, overrides));
    const b = decideMasterSetMembership(input(printings, overrides));
    expect([...a.decisions.entries()]).toEqual([...b.decisions.entries()]);
    expect([...a.overridesApplied.entries()]).toEqual([...b.overridesApplied.entries()]);
  });

  it('shuffled printings produce the same per-key decisions (order-independent semantics)', () => {
    const base = [p('a', 'HOLO'), p('b', 'NON_HOLO', ['STAMPED_STAFF'], false), p('c', 'PROMO')];
    const shuffled = [base[2]!, base[0]!, base[1]!];
    const a = decideMasterSetMembership(input(base));
    const b = decideMasterSetMembership(input(shuffled));
    for (const key of ['a', 'b', 'c']) {
      expect(b.decisions.get(key)).toBe(a.decisions.get(key));
    }
  });

  it('does not mutate the input printings or overrides', () => {
    const printings = [p('a', 'HOLO', ['MASTER_BALL_PATTERN'])] as const;
    const overrides = { include_pattern_variants: false };
    const beforePrintings = JSON.parse(JSON.stringify(printings));
    const beforeOverrides = JSON.parse(JSON.stringify(overrides));
    decideMasterSetMembership(input([...printings], overrides));
    expect(printings).toEqual(beforePrintings);
    expect(overrides).toEqual(beforeOverrides);
  });
});

describe('decideMasterSetMembership — trace correctness', () => {
  it('overridesApplied contains ONLY printings whose final differs from default', () => {
    const printings = [
      p('default-true', 'HOLO', [], true),
      p('default-false', 'NON_HOLO', ['ERROR'], false),
      p('flipped-by-toggle', 'NON_HOLO', ['MASTER_BALL_PATTERN'], true),
      p('per-printing-flip', 'HOLO', [], true),
    ];
    const result = decideMasterSetMembership(
      input(printings, {
        include_pattern_variants: false,
        additional_excluded_variant_keys: ['per-printing-flip'],
      }),
    );
    expect([...result.overridesApplied.keys()].sort()).toEqual(
      ['flipped-by-toggle', 'per-printing-flip'].sort(),
    );
    expect(result.overridesApplied.get('flipped-by-toggle')?.reason).toBe('set_toggle');
    expect(result.overridesApplied.get('per-printing-flip')?.reason).toBe('per_printing_excluded');
  });
});

describe('decideMasterSetMembership — error handling', () => {
  it('throws ZodError on malformed set.masterSetRules', () => {
    expect(() =>
      decideMasterSetMembership(input([p('a', 'HOLO')], { unknown_key: true })),
    ).toThrow();
  });

  it('handles an empty printings list', () => {
    const result = decideMasterSetMembership(input([]));
    expect(result.decisions.size).toBe(0);
    expect(result.overridesApplied.size).toBe(0);
  });
});
