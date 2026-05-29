// Shared types for the data pipeline.
//
// Two levels of types live here:
//
//   1. `Raw{Set,Card,Printing}` — what adapters EMIT. Lowest common
//      denominator across sources (TCGdex EN/JP, pokemontcg.io,
//      Bulbapedia, Pokellector, Serebii). Many fields are nullable
//      because not every source returns every field. Adapters do
//      per-source field-name remapping into this shape and call the
//      normalize/* helpers for vocabulary-level mapping (rarity, type).
//
//   2. `Canonical{Set,Card,Printing}` — what the resolver PRODUCES,
//      after primary/validation/filler merging, variant classification,
//      and canonical-key assembly. Field names and types here are
//      deliberately kept compatible with the drizzle insert types
//      (`NewSet`, `NewCard`, `NewPrinting` from `@binderly/db`) so the
//      seed-ingest task can map a Canonical record straight into a
//      drizzle insert without a second translation pass. The
//      compile-time alignment check lives in `types.alignment.test.ts`.
//
// All types ship paired with a zod schema for runtime validation.
// The schemas are deliberately lenient at the Raw level (tolerates
// unknown source quirks, coerces obvious types) and strict at the
// Canonical level (rejects malformed data so we never write garbage to
// the catalog tables).

import { z } from 'zod';

// ============================================================
// Enum primitives (mirrors of context/tcg-domain.md §1, §6, §7)
// ============================================================

/**
 * Variant class — the primary axis of a printing's identity. See
 * `context/tcg-domain.md` § 1.
 */
export const VARIANT_CLASSES = [
  'HOLO',
  'NON_HOLO',
  'REVERSE_HOLO',
  'FULL_ART',
  'ALT_ART',
  'SECRET_RARE',
  'GOLD',
  'RAINBOW',
  'TEXTURED',
  'TRAINER_GALLERY',
  'PROMO',
] as const;

export const variantClassSchema = z.enum(VARIANT_CLASSES);
export type VariantClass = z.infer<typeof variantClassSchema>;

/**
 * Variant flags — orthogonal modifiers that stack on top of a class.
 * See `context/tcg-domain.md` § 1.
 */
export const VARIANT_FLAGS = [
  'FIRST_EDITION',
  'SHADOWLESS',
  'UNLIMITED',
  'POKE_BALL_PATTERN',
  'MASTER_BALL_PATTERN',
  'COSMOS_PATTERN',
  'GALAXY_PATTERN',
  'STAMPED_PRERELEASE',
  'STAMPED_STAFF',
  'STAMPED_LEAGUE',
  'STAMPED_BUILDBATTLE',
  'STAMPED_CHAMPIONSHIP',
  'TEXTURED',
  'ERROR',
] as const;

export const variantFlagSchema = z.enum(VARIANT_FLAGS);
export type VariantFlag = z.infer<typeof variantFlagSchema>;

/**
 * Canonical rarity enum. See `context/tcg-domain.md` § 6.
 */
export const RARITIES = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'HOLO_RARE',
  'ULTRA_RARE',
  'SECRET_RARE',
  'HYPER_RARE',
  'RAINBOW_RARE',
  'SPECIAL_ILLUSTRATION_RARE',
  'ILLUSTRATION_RARE',
  'DOUBLE_RARE',
  'RADIANT_RARE',
  'AMAZING_RARE',
  'PROMO',
] as const;

export const raritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof raritySchema>;

/**
 * Pokémon types (see `context/tcg-domain.md` § 7).
 */
export const POKEMON_TYPES = [
  'GRASS',
  'FIRE',
  'WATER',
  'LIGHTNING',
  'PSYCHIC',
  'FIGHTING',
  'DARKNESS',
  'METAL',
  'FAIRY',
  'DRAGON',
  'COLORLESS',
] as const;

export const pokemonTypeSchema = z.enum(POKEMON_TYPES);
export type PokemonType = z.infer<typeof pokemonTypeSchema>;

/**
 * Card subtype — high-level coarse bucket. Trainer/Energy refinements
 * (ITEM, SUPPORTER, BASIC, SPECIAL, etc.) live in `card.subtype` as the
 * full enum string from `context/tcg-domain.md` § 7.
 */
export const CARD_SUBTYPES = [
  'POKEMON',
  'TRAINER_ITEM',
  'TRAINER_SUPPORTER',
  'TRAINER_STADIUM',
  'TRAINER_TOOL',
  'TRAINER_POKEMON_TOOL',
  'ENERGY_BASIC',
  'ENERGY_SPECIAL',
] as const;

export const cardSubtypeSchema = z.enum(CARD_SUBTYPES);
export type CardSubtype = z.infer<typeof cardSubtypeSchema>;

export const LANGUAGES = ['en', 'jp'] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

export const ADAPTER_TIERS = ['primary', 'validation', 'filler'] as const;
export const adapterTierSchema = z.enum(ADAPTER_TIERS);
export type AdapterTier = z.infer<typeof adapterTierSchema>;

// ============================================================
// Raw schemas — what adapters emit
// ============================================================

/**
 * Raw set as emitted by an adapter. Fields are nullable when sources
 * may not provide them; the resolver fills gaps from validation/filler
 * tiers. The `source` and `sourceKey` fields carry provenance — they
 * are stripped before write but used by the resolver to compose
 * `source_metadata`.
 */
export const rawSetSchema = z
  .object({
    source: z.string().min(1),
    sourceKey: z.string().min(1),
    code: z.string().min(1),
    language: languageSchema,
    name: z.string().min(1),
    series: z.string().nullable().optional(),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'releaseDate must be ISO yyyy-mm-dd'),
    printedTotal: z.number().int().nonnegative().nullable().optional(),
    total: z.number().int().nonnegative().nullable().optional(),
    logoUrl: z.string().url().nullable().optional(),
    symbolUrl: z.string().url().nullable().optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .strict();
export type RawSet = z.infer<typeof rawSetSchema>;

/**
 * Raw card as emitted by an adapter. `rarityRaw` is the source's own
 * rarity vocabulary; `normalizeRarity` translates it. Same for
 * `typeRaw`. Subtype is similarly raw — adapters keep source strings
 * and the normalizer maps them.
 */
export const rawCardSchema = z
  .object({
    source: z.string().min(1),
    sourceKey: z.string().min(1),
    setCode: z.string().min(1),
    language: languageSchema,
    number: z.string().min(1),
    name: z.string().min(1),
    nameLocalized: z.record(z.string()).nullable().optional(),
    typeRaw: z.string().nullable().optional(),
    subtypeRaw: z.string().nullable().optional(),
    hp: z.number().int().positive().nullable().optional(),
    illustrator: z.string().nullable().optional(),
    flavorText: z.string().nullable().optional(),
    attacks: z.array(z.unknown()).nullable().optional(),
    weakness: z.array(z.unknown()).nullable().optional(),
    resistance: z.array(z.unknown()).nullable().optional(),
    retreatCost: z.number().int().nonnegative().nullable().optional(),
    rarityRaw: z.string().nullable().optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .strict();
export type RawCard = z.infer<typeof rawCardSchema>;

/**
 * Raw printing as emitted by an adapter. Carries the raw signals the
 * variant classifier needs to make a deterministic decision. Adapters
 * never assign `variant_class` themselves — see rules/01-data-layer.md.
 */
export const rawPrintingSchema = z
  .object({
    source: z.string().min(1),
    sourceKey: z.string().min(1),
    cardKey: z.string().min(1),
    /** Source-declared printing label, e.g. "1st Edition Holo", "Reverse Holo". */
    sourcePrintingLabel: z.string().nullable().optional(),
    /** The source's own rarity if it carries one on the printing. */
    rarityRaw: z.string().nullable().optional(),
    /** Source-emitted boolean signals that drive the decision tree. */
    isHolo: z.boolean().nullable().optional(),
    isReverseHolo: z.boolean().nullable().optional(),
    isFirstEdition: z.boolean().nullable().optional(),
    isShadowless: z.boolean().nullable().optional(),
    isFullArt: z.boolean().nullable().optional(),
    isAltArt: z.boolean().nullable().optional(),
    isGoldRare: z.boolean().nullable().optional(),
    isRainbowRare: z.boolean().nullable().optional(),
    isTextured: z.boolean().nullable().optional(),
    isTrainerGallery: z.boolean().nullable().optional(),
    isPromo: z.boolean().nullable().optional(),
    isError: z.boolean().nullable().optional(),
    pattern: z.enum(['POKE_BALL', 'MASTER_BALL', 'COSMOS', 'GALAXY']).nullable().optional(),
    stamp: z
      .enum(['PRERELEASE', 'STAFF', 'LEAGUE', 'BUILDBATTLE', 'CHAMPIONSHIP'])
      .nullable()
      .optional(),
    imageSourceUrl: z.string().url().nullable().optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .strict();
export type RawPrinting = z.infer<typeof rawPrintingSchema>;

// ============================================================
// Canonical schemas — post-resolver, ready for DB insert
// ============================================================

/**
 * Match the drizzle column type for `set_id` references and
 * `printing.card_id`. UUIDs are not present in canonical records — they
 * are assigned by the database on first upsert; resolvers and ingest
 * jobs join across canonical records via `canonical_key` / `card_key`.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO yyyy-mm-dd');

/**
 * Canonical set. Field shape mirrors `packages/db/src/schema/sets.ts`:
 * `id`, `created_at`, `updated_at` are intentionally omitted (DB owns
 * them). `master_set_rules` is permissive `Record<string, unknown>` —
 * the master-set rules engine (T-DL-MASTER-SET-RULES) owns its
 * stricter shape.
 */
export const canonicalSetSchema = z
  .object({
    canonicalKey: z.string().min(1),
    code: z.string().min(1),
    language: languageSchema,
    name: z.string().min(1),
    series: z.string().nullable(),
    releaseDate: isoDate,
    printedTotal: z.number().int().nonnegative().nullable(),
    total: z.number().int().nonnegative().nullable(),
    logoUrl: z.string().url().nullable(),
    symbolUrl: z.string().url().nullable(),
    masterSetRules: z.record(z.unknown()),
    sourceMetadata: z.record(z.unknown()),
  })
  .strict();
export type CanonicalSet = z.infer<typeof canonicalSetSchema>;

/**
 * Canonical card. Mirrors `packages/db/src/schema/cards.ts`. `setId`
 * (the FK uuid) is filled in by the seed-ingest task at write time
 * after upserting the set; canonical records carry `setCanonicalKey`
 * instead, which is stable across re-runs.
 */
export const canonicalCardSchema = z
  .object({
    canonicalKey: z.string().min(1),
    setCanonicalKey: z.string().min(1),
    language: languageSchema,
    number: z.string().min(1),
    name: z.string().min(1),
    nameLocalized: z.record(z.string()).nullable(),
    type: pokemonTypeSchema.nullable(),
    subtype: cardSubtypeSchema.nullable(),
    hp: z.number().int().positive().nullable(),
    illustrator: z.string().nullable(),
    flavorText: z.string().nullable(),
    attacks: z.array(z.unknown()).nullable(),
    weakness: z.array(z.unknown()).nullable(),
    resistance: z.array(z.unknown()).nullable(),
    retreatCost: z.number().int().nonnegative().nullable(),
    rarity: raritySchema.nullable(),
    sourceMetadata: z.record(z.unknown()),
  })
  .strict();
export type CanonicalCard = z.infer<typeof canonicalCardSchema>;

/**
 * Canonical printing. Mirrors `packages/db/src/schema/printings.ts`.
 * `cardId` is filled in at write time; canonical records carry
 * `cardCanonicalKey`. `includeInMasterSet` is a *default* derived from
 * the variant classifier; the master-set rules engine may override it
 * before write.
 */
export const canonicalPrintingSchema = z
  .object({
    variantKey: z.string().min(1),
    cardCanonicalKey: z.string().min(1),
    variantClass: variantClassSchema,
    variantFlags: z.array(variantFlagSchema),
    variantCode: z.string().min(1),
    includeInMasterSet: z.boolean(),
    imageSmallUrl: z.string().url().nullable(),
    imageLargeUrl: z.string().url().nullable(),
    imageSourceUrl: z.string().url().nullable(),
    sourceMetadata: z.record(z.unknown()),
  })
  .strict();
export type CanonicalPrinting = z.infer<typeof canonicalPrintingSchema>;

// ============================================================
// Conflict and provenance types
// ============================================================

/**
 * A `DataConflict` is recorded when validation-tier sources disagree
 * with the primary on a field beyond the configured tolerance. The
 * resolver does NOT throw — it surfaces these for ops review (the
 * `data_conflict` table from `context/data-model.md`).
 */
export const dataConflictSchema = z
  .object({
    entity: z.enum(['set', 'card', 'printing']),
    entityKey: z.string().min(1),
    field: z.string().min(1),
    sources: z.record(z.unknown()),
    chosenValue: z.unknown(),
    chosenSource: z.string().min(1),
  })
  .strict();
export type DataConflict = z.infer<typeof dataConflictSchema>;

export interface ResolveResult<T> {
  canonical: T;
  conflicts: DataConflict[];
}

export interface ResolveListResult<T> {
  canonical: T[];
  conflicts: DataConflict[];
}

// ============================================================
// Raw price observations — what pricing adapters EMIT
// ============================================================

/**
 * The three values `price_observation.observation_kind` is allowed to
 * carry per `packages/db/src/schema/prices.ts`'s CHECK constraint:
 *
 *   - `'sold'`              — Layer 3 / aggregator-emitted sold sales.
 *   - `'active_listing'`    — Layer 2 (eBay Browse — asking prices).
 *   - `'aggregator_quote'`  — Layer 1 (aggregator's normalized quote).
 *
 * Mirrored here as a const tuple so adapters that emit
 * `RawPriceObservation` records validate against the schema without
 * dragging `@binderly/db` into the type graph.
 */
export const PRICE_OBSERVATION_KINDS = ['sold', 'active_listing', 'aggregator_quote'] as const;
export const priceObservationKindSchema = z.enum(PRICE_OBSERVATION_KINDS);
export type PriceObservationKind = z.infer<typeof priceObservationKindSchema>;

/**
 * Canonical `price_observation.grade_tier` vocabulary, copied from
 * `data-pipeline/src/parsers/ebay-listing/types.ts`. Re-declared here
 * (rather than imported) so this module stays at the bottom of the
 * type graph; the parser package is a downstream consumer.
 *
 * Keep this list in sync with the parser's `GRADE_TIERS`. A test in
 * `data-pipeline/src/types.alignment.test.ts` (or the adapter's own
 * tests) asserts the alignment.
 */
export const PRICE_OBSERVATION_GRADE_TIERS = [
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
export const priceObservationGradeTierSchema = z.enum(PRICE_OBSERVATION_GRADE_TIERS);
export type PriceObservationGradeTier = z.infer<typeof priceObservationGradeTierSchema>;

/**
 * `RawPriceObservation` — the shape every pricing adapter EMITS, one
 * row per upstream listing / quote / sale. This is the single shared
 * type for BOTH pricing adapters (#FU-2): the eBay Browse adapter
 * (Layer 2, `active_listing`) and the pricing aggregator (Layer 1,
 * `aggregator_quote` / `sold`) both import it from here — neither keeps
 * its own differentiated copy.
 *
 * Field-for-field mirror of `NewPriceObservation` from `@binderly/db`
 * (insert type for `price_observation`) so the runner's repo
 * implementation can map straight into a Drizzle insert without a
 * second translation pass — same posture as `FxRateRow` ↔ `NewFxRate`
 * from `T-DL-FX-RATES`.
 *
 * `observedPrice`, `shipping`, and `parseConfidence` are strings
 * (rather than `number`) because Drizzle's `numeric` columns round-trip
 * cleanly as strings (`'12.34'`) but suffer the usual floating-point
 * quirks when fed a raw `number` (`0.1 + 0.2 → 0.30000000000000004`).
 *
 * Shared by `T-DL-PRICING-EBAY-BROWSE` (Layer 2) and
 * `T-DL-PRICING-AGGREGATOR` (Layer 1).
 */
export const rawPriceObservationSchema = z
  .object({
    /** `'ebay_browse'`, `'aggregator_<name>'`, etc. */
    source: z.string().min(1),
    /**
     * Upstream stable id used for idempotent upserts. eBay returns
     * `itemId` (always present); aggregators that lack a stable id
     * may set this null — the schema's `(source, source_listing_id)`
     * UNIQUE constraint uses Postgres's default NULLS DISTINCT so
     * null entries don't conflict.
     */
    sourceListingId: z.string().min(1).nullable(),
    /** Resolved printing UUID from the catalog joiner. */
    printingId: z.string().uuid(),
    observationKind: priceObservationKindSchema,
    /** `market.code` value: `'EBAY_US'`, `'CARDMARKET_EU'`, etc. */
    market: z.string().min(1),
    gradeTier: priceObservationGradeTierSchema,
    /** numeric(12,2) — string for round-trip stability. */
    observedPrice: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
    /** ISO-4217 alpha-3, uppercase. */
    observedCurrency: z.string().regex(/^[A-Z]{3}$/),
    /** numeric(12,2). Null when shipping is unknown / free / bundled. */
    shipping: z
      .string()
      .regex(/^-?\d+(\.\d{1,2})?$/)
      .nullable(),
    /**
     * Parser confidence as a `numeric(3,2)`-formatted string in `[0, 1]`
     * (e.g. `'0.86'`), or null when the source is confidence-free.
     * String (not number) so it round-trips into the `parse_confidence`
     * numeric column without float drift — same posture as
     * `observedPrice` / `shipping`. Aggregates exclude < 0.70 per the
     * rollup spec.
     */
    parseConfidence: z
      .string()
      .regex(/^-?\d+(\.\d{1,2})?$/)
      .nullable(),
    /** When the upstream quote / sale was real. */
    observedAt: z.date(),
    /** ISO `YYYY-MM-DD`; date-only of `observedAt` (UTC) for FX joins. */
    observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /**
     * Listing title, seller, source URL, raw payload — debug-only,
     * never surfaced to clients (RLS is service-role-only). Also
     * the kill-switch / takedown response per `legal-and-brand.md`.
     */
    rawMetadata: z.record(z.unknown()).nullable(),
  })
  .strict();
export type RawPriceObservation = z.infer<typeof rawPriceObservationSchema>;
