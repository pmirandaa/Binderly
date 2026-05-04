// Override schema for `set.master_set_rules` (jsonb).
//
// The shape is the canonical one documented in
// `context/tcg-domain.md` § 2 — every key is OPTIONAL and missing
// keys fall back to the variant classifier's default
// (`include_in_master_set_default`). Unknown keys are REJECTED at
// validation time (`.strict()`) so a typo on the write side surfaces
// as a hard error rather than silently no-op'ing the override.
//
// The schema deliberately omits toggles for HOLO / NON_HOLO /
// REVERSE_HOLO / SECRET_RARE / RAINBOW / GOLD / FULL_ART / ALT_ART /
// PROMO classes: their classifier defaults are stable per § 2's
// invariants. Sets that need to surgically remove a single printing
// (or include a normally-excluded one) use the per-printing arrays.
//
// COSMOS_PATTERN and GALAXY_PATTERN are intentionally NOT governed by
// `include_pattern_variants` — they are cosmetic background patterns
// on promos, not master-set-defining variants per Pablo's spec. Their
// inclusion follows the underlying class default.

import { z } from 'zod';

/**
 * Every printing's `variant_key` is a `text` value in the catalog
 * (`{card.canonical_key}-{variant_code}`, e.g.
 * `en-base1-004-holo-fe-sl`). The schema accepts any non-empty
 * string here and trusts the caller to supply real keys; referential
 * integrity (does this key resolve to a real printing?) is the
 * seed-ingest's job, not this engine's.
 */
const variantKeySchema = z.string().min(1, 'variant_key cannot be empty');

/**
 * `MasterSetRulesOverrides` — the runtime shape of
 * `set.master_set_rules` jsonb. All keys optional; the engine maps
 * `undefined` to "fall back to classifier default".
 *
 * See `context/tcg-domain.md` § 2 for the canonical product spec.
 */
export const masterSetRulesSchema = z
  .object({
    // ----- Class-level toggles -----
    /** TEXTURED variant_class default (true). */
    include_textured: z.boolean().optional(),
    /** TRAINER_GALLERY variant_class default (true). */
    include_trainer_gallery: z.boolean().optional(),

    // ----- Flag-level toggles -----
    /**
     * POKE_BALL_PATTERN | MASTER_BALL_PATTERN flags. Default true
     * (Pablo's explicit master-set inclusion ask). Sets that DON'T
     * mint pattern reverse holos can leave this alone — no printings
     * will match.
     */
    include_pattern_variants: z.boolean().optional(),
    /** STAMPED_PRERELEASE flag. Default inherits class default (true for HOLO/NON_HOLO). */
    include_prerelease: z.boolean().optional(),
    /** STAMPED_LEAGUE flag. */
    include_league: z.boolean().optional(),
    /** STAMPED_BUILDBATTLE flag. */
    include_buildbattle: z.boolean().optional(),
    /** STAMPED_CHAMPIONSHIP flag. */
    include_championship: z.boolean().optional(),
    /**
     * STAMPED_STAFF flag. Default false per § 2's "always excluded by
     * default" rule (different-set staff promos pollute completion).
     */
    include_staff: z.boolean().optional(),
    /**
     * ERROR flag. Default false per § 2 / § 3's "Errors and misprints"
     * rule. A per-set toggle exists for the rare set whose master
     * specifically catalogues a known error printing.
     */
    include_error: z.boolean().optional(),

    // ----- Surgical per-printing overrides -----
    /**
     * Variant keys explicitly EXCLUDED for this set's master regardless
     * of class/flag defaults. Lower-precedence than
     * `additional_included_variant_keys` when a key appears in both
     * (positive assertions win — see README precedence section).
     */
    additional_excluded_variant_keys: z.array(variantKeySchema).optional(),
    /**
     * Variant keys explicitly INCLUDED for this set's master regardless
     * of class/flag defaults. Wins over `additional_excluded` and over
     * any class/flag toggle.
     */
    additional_included_variant_keys: z.array(variantKeySchema).optional(),
  })
  .strict();

/**
 * `MasterSetRulesOverrides` — TypeScript view of the validated shape.
 * Inferred from the zod schema so they stay in sync.
 */
export type MasterSetRulesOverrides = z.infer<typeof masterSetRulesSchema>;

/**
 * Empty overrides — the common case (defaults are correct for ~all
 * sets). Frozen so consumers can use it as a stable default-reference.
 */
export const EMPTY_MASTER_SET_RULES: Readonly<MasterSetRulesOverrides> = Object.freeze({});

/**
 * Strict parse: throws a `z.ZodError` on schema violations. Suitable
 * at write time when the caller wants a hard fail on malformed
 * `set.master_set_rules` jsonb.
 */
export function parseMasterSetRules(value: unknown): MasterSetRulesOverrides {
  return masterSetRulesSchema.parse(value ?? {});
}

/**
 * Soft parse: returns the discriminated `SafeParseResult` so callers
 * can recover (e.g. log + fall back to `EMPTY_MASTER_SET_RULES`).
 */
export function safeParseMasterSetRules(
  value: unknown,
): z.SafeParseReturnType<unknown, MasterSetRulesOverrides> {
  return masterSetRulesSchema.safeParse(value ?? {});
}
