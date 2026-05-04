// Default master-set inclusion table by `variant_class` and forced
// overrides by `variant_flag`, plus the `class/flag → override toggle`
// mapping helpers used by `decide.ts`.
//
// The class table is the SAME shape as the classifier's
// `decideMasterDefault` in `variant-classify.ts` — exported here for
// downstream debugging (T-SP-SET-COMPLETION docs, future ops UIs).
// The classifier remains the single source of truth at runtime; this
// table is for documentation, exhaustive-enum tests, and the rare
// case where a downstream consumer needs the default *without* full
// printing context.

import type { VariantClass, VariantFlag } from '../types.js';
import type { MasterSetRulesOverrides } from './types.js';

/**
 * Default `include_in_master_set` per variant class. Mirrors
 * `variant-classify.ts:decideMasterDefault`. § 2's invariants treat
 * every class above as part of the master by default; the per-set
 * overrides flip the cosmetic / staff / error edge cases off.
 *
 * Tested for exhaustiveness against `VARIANT_CLASSES` in `rules.test.ts`.
 */
export const DEFAULT_INCLUDE_BY_CLASS: Readonly<Record<VariantClass, boolean>> = Object.freeze({
  HOLO: true,
  NON_HOLO: true,
  REVERSE_HOLO: true,
  FULL_ART: true,
  ALT_ART: true,
  SECRET_RARE: true,
  GOLD: true,
  RAINBOW: true,
  TEXTURED: true,
  TRAINER_GALLERY: true,
  PROMO: true,
});

/**
 * Forced exclusions by flag. Per § 2's "Always excluded by default"
 * rule:
 *   - ERROR — known printing errors are not part of the master
 *   - STAMPED_STAFF — staff promos pollute completion
 *
 * Other flags inherit their printing's class default and can be
 * overridden per set (see `flagToTogglePath` below).
 */
export const DEFAULT_INCLUDE_BY_FLAG: Readonly<Partial<Record<VariantFlag, boolean>>> =
  Object.freeze({
    ERROR: false,
    STAMPED_STAFF: false,
  });

/**
 * `flagToTogglePath` — given a printing flag, return which override
 * key (if any) on `set.master_set_rules` governs it. Returns `null`
 * for flags that are not user-overridable at the set level
 * (`FIRST_EDITION`, `SHADOWLESS`, `UNLIMITED`, `COSMOS_PATTERN`,
 * `GALAXY_PATTERN`, `TEXTURED` flag).
 *
 * Pattern flags POKE_BALL_PATTERN / MASTER_BALL_PATTERN both map to
 * the SAME toggle (`include_pattern_variants`) per § 2's grouping —
 * Pablo treats them as one product concept.
 */
export function flagToTogglePath(flag: VariantFlag): keyof MasterSetRulesOverrides | null {
  switch (flag) {
    case 'POKE_BALL_PATTERN':
    case 'MASTER_BALL_PATTERN':
      return 'include_pattern_variants';
    case 'STAMPED_PRERELEASE':
      return 'include_prerelease';
    case 'STAMPED_LEAGUE':
      return 'include_league';
    case 'STAMPED_BUILDBATTLE':
      return 'include_buildbattle';
    case 'STAMPED_CHAMPIONSHIP':
      return 'include_championship';
    case 'STAMPED_STAFF':
      return 'include_staff';
    case 'ERROR':
      return 'include_error';
    case 'FIRST_EDITION':
    case 'SHADOWLESS':
    case 'UNLIMITED':
    case 'COSMOS_PATTERN':
    case 'GALAXY_PATTERN':
    case 'TEXTURED':
      // These flags don't have set-level toggles. § 2 doesn't treat
      // them as master-set-defining: edition flags are part of the
      // printing's identity (and Base Set's three printings are all
      // included by definition); cosmos/galaxy/textured-flag patterns
      // are cosmetic — the underlying class default decides.
      return null;
  }
}

/**
 * `classToTogglePath` — given a variant class, return which override
 * key (if any) on `set.master_set_rules` governs it.
 *
 * Only TEXTURED and TRAINER_GALLERY have class-level set toggles. The
 * other classes (HOLO, NON_HOLO, REVERSE_HOLO, SECRET_RARE, FULL_ART,
 * ALT_ART, GOLD, RAINBOW, PROMO) ALWAYS default-include and a per-set
 * surgical exclusion uses `additional_excluded_variant_keys` instead
 * (per the elaborated task spec — keeps the toggle surface minimal).
 */
export function classToTogglePath(cls: VariantClass): keyof MasterSetRulesOverrides | null {
  switch (cls) {
    case 'TEXTURED':
      return 'include_textured';
    case 'TRAINER_GALLERY':
      return 'include_trainer_gallery';
    case 'HOLO':
    case 'NON_HOLO':
    case 'REVERSE_HOLO':
    case 'FULL_ART':
    case 'ALT_ART':
    case 'SECRET_RARE':
    case 'GOLD':
    case 'RAINBOW':
    case 'PROMO':
      return null;
  }
}

/**
 * Fixed application order for set-level toggles when a printing
 * matches multiple. Later wins. The order puts the more restrictive
 * defaults (`include_staff`, `include_error`) at the bottom so they
 * dominate when they conflict with class-level inclusions. See
 * `tasks/01-data-layer/T-DL-MASTER-SET-RULES.md` §
 * "Toggle precedence within set-level rules" for rationale.
 *
 * The engine consults this list in order and applies any toggle
 * whose domain matches the printing.
 */
export const TOGGLE_PRECEDENCE: ReadonlyArray<keyof MasterSetRulesOverrides> = Object.freeze([
  'include_textured',
  'include_trainer_gallery',
  'include_pattern_variants',
  'include_prerelease',
  'include_league',
  'include_buildbattle',
  'include_championship',
  'include_staff',
  'include_error',
]);
