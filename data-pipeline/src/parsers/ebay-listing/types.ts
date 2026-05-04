// `ParsedListing` zod schema and the supporting condition / grade-tier
// enums.
//
// The shape is intentionally flat-ish — every consumer (the Layer-2
// eBay Browse adapter, the Layer-1 aggregator's title-normaliser, the
// catalog joiner) reads it directly without a second translation pass.
// All fields are mandatory on the output (parser produces a complete
// record for every input); nullable fields capture "unknown" without
// distinguishing it from "not present" — the parser is best-effort by
// design.
//
// References:
//   - `context/data-model.md` § "Grade tiers" (the canonical
//     `price_observation.grade_tier` enum)
//   - `packages/db/src/schema/grading.ts` — `grade_company` enum
//     (`'PSA' | 'BGS' | 'CGC' | 'SGC' | 'OTHER'`); AGS / ACE bucket
//     through `OTHER`.
//   - `packages/db/src/schema/collections.ts` — `condition` strings
//     (`NEAR_MINT`, etc.). We mirror the same SCREAMING_SNAKE_CASE
//     enum so downstream consumers don't translate.

import { z } from 'zod';

/**
 * Grading companies the parser knows how to emit. The drizzle schema
 * (`grading_training_sample.grade_company` CHECK) constrains stored
 * values to this exact set; the parser refuses to invent new buckets.
 */
export const GRADE_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'OTHER'] as const;
export const gradeCompanySchema = z.enum(GRADE_COMPANIES);
export type GradeCompany = z.infer<typeof gradeCompanySchema>;

/**
 * Canonical grade tiers from `context/data-model.md` § "Grade tiers".
 * `price_observation.grade_tier` is free-form `text` for forward
 * flexibility, but the parser emits exactly this enum so the rollup
 * job can group cleanly.
 */
export const GRADE_TIERS = [
  'RAW_NM',
  'RAW_LP',
  'RAW_MP',
  'RAW_HP',
  'RAW_DMG',
  'RAW_UNKNOWN',
  'PSA_10',
  'PSA_9',
  'PSA_8',
  'PSA_7',
  'PSA_LOWER',
  'BGS_10_BLACK',
  'BGS_10',
  'BGS_9_5',
  'BGS_9',
  'BGS_LOWER',
  'CGC_10_PRISTINE',
  'CGC_10',
  'CGC_9_5',
  'CGC_9',
  'CGC_LOWER',
  'OTHER_GRADED',
] as const;
export const gradeTierSchema = z.enum(GRADE_TIERS);
export type GradeTier = z.infer<typeof gradeTierSchema>;

/**
 * Raw-card condition vocabulary. Matches `collection_item.condition`
 * defaults from `packages/db/src/schema/collections.ts` and the
 * `RAW_*` strand of `data-model.md`'s grade-tier enum.
 */
export const CONDITIONS = [
  'MINT',
  'NEAR_MINT',
  'LIGHTLY_PLAYED',
  'MODERATELY_PLAYED',
  'HEAVILY_PLAYED',
  'DAMAGED',
] as const;
export const conditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof conditionSchema>;

/**
 * Listing-language detection. `'unknown'` is the default; the parser
 * never assumes English without a positive signal so the field stays
 * honest.
 */
export const LISTING_LANGUAGES = ['en', 'jp', 'unknown'] as const;
export const listingLanguageSchema = z.enum(LISTING_LANGUAGES);
export type ListingLanguage = z.infer<typeof listingLanguageSchema>;

/**
 * Modern-rarity hint extracted from a listing title. Captures the
 * collector vocabulary ("V", "VMAX", "VSTAR", "ex", "GX", etc.) that
 * collectors use as shorthand for the underlying card. The variant
 * classifier (`variant-classify.ts`) is the source of truth for the
 * final `variant_class` — this hint is a *signal*, not a decision.
 */
export const RARITY_HINTS = [
  'V',
  'VMAX',
  'VSTAR',
  'EX',
  'GX',
  'ex',
  'BREAK',
  'TAG_TEAM',
  'MEGA',
] as const;
export const rarityHintSchema = z.enum(RARITY_HINTS);
export type RarityHint = z.infer<typeof rarityHintSchema>;

const tristate = z.boolean().nullable();

export const variantHintsSchema = z
  .object({
    isHolo: tristate,
    isReverseHolo: tristate,
    isFirstEdition: tristate,
    isShadowless: tristate,
    isFullArt: tristate,
    isAltArt: tristate,
    isPromo: tristate,
    isRainbow: tristate,
    isGold: tristate,
    isSecretRare: tristate,
    isStaff: tristate,
    isPrerelease: tristate,
    isPokeBallPattern: tristate,
    isMasterBallPattern: tristate,
    rarityHint: rarityHintSchema.nullable(),
  })
  .strict();
export type VariantHints = z.infer<typeof variantHintsSchema>;

export const gradingHintsSchema = z
  .object({
    company: gradeCompanySchema.nullable(),
    /**
     * Numeric grade on the company's native scale (0..10 for PSA / BGS
     * / CGC / SGC). `null` when `isSlab` is true but the title didn't
     * carry a parseable number (rare; "graded" without a digit).
     */
    grade: z.number().nullable(),
    /**
     * Human label observed in the title — `'GEM MINT'`, `'BLACK
     * LABEL'`, `'PRISTINE'`, etc. Diagnostic only; the canonical
     * routing key is `gradeTier`.
     */
    gradeLabel: z.string().nullable(),
    /**
     * `true` when the listing describes a slabbed (graded) card, even
     * if the numeric grade couldn't be parsed. `false` for raw cards.
     */
    isSlab: z.boolean(),
    gradeTier: gradeTierSchema.nullable(),
  })
  .strict();
export type GradingHints = z.infer<typeof gradingHintsSchema>;

export const setHintsSchema = z
  .object({
    /**
     * Set code if a reliable signal was found (either by direct match
     * to a known modern-set code or by name-dictionary lookup).
     * Lower-cased, no spaces — ready to feed `canonicalSetKey()`.
     */
    codeHint: z.string().nullable(),
    /**
     * The raw set name as it appeared in the title (lowercased,
     * whitespace-trimmed). Useful for fallback name-based lookups
     * when `codeHint` is null.
     */
    nameHint: z.string().nullable(),
  })
  .strict();
export type SetHints = z.infer<typeof setHintsSchema>;

export const cardHintsSchema = z
  .object({
    /**
     * Card-number hint preserved verbatim from the title (no padding
     * applied — `canonicalCardKey()` will pad as needed). May be a
     * pure number, a `TG`/`GG`/`SWSH` prefix, or `null` when no
     * number was found.
     */
    numberHint: z.string().nullable(),
    nameHint: z.string().nullable(),
  })
  .strict();
export type CardHints = z.infer<typeof cardHintsSchema>;

export const parsedListingSchema = z
  .object({
    rawTitle: z.string(),
    cleanedTitle: z.string(),
    grading: gradingHintsSchema,
    condition: conditionSchema.nullable(),
    language: listingLanguageSchema,
    set: setHintsSchema,
    card: cardHintsSchema,
    variantHints: variantHintsSchema,
    isLot: z.boolean(),
    /**
     * Declared multi-card count when the title mentions one
     * ("Lot of 50" → 50). `null` when the listing was flagged as a
     * lot but no count was found.
     */
    lotSize: z.number().int().positive().nullable(),
    confidenceScore: z.number().min(0).max(1),
    matchedSignals: z.array(z.string()),
    unparsedTokens: z.array(z.string()),
  })
  .strict();
export type ParsedListing = z.infer<typeof parsedListingSchema>;

/** Default `variantHints` — every flag null until a pass asserts. */
export function emptyVariantHints(): VariantHints {
  return {
    isHolo: null,
    isReverseHolo: null,
    isFirstEdition: null,
    isShadowless: null,
    isFullArt: null,
    isAltArt: null,
    isPromo: null,
    isRainbow: null,
    isGold: null,
    isSecretRare: null,
    isStaff: null,
    isPrerelease: null,
    isPokeBallPattern: null,
    isMasterBallPattern: null,
    rarityHint: null,
  };
}

/** Default `grading` — empty slab indicator until grade pass fires. */
export function emptyGradingHints(): GradingHints {
  return {
    company: null,
    grade: null,
    gradeLabel: null,
    isSlab: false,
    gradeTier: null,
  };
}
