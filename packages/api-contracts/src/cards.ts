// Card-catalog DTOs (READ shapes — the wire format).
//
// Mirrors the Drizzle catalog tables in
// `packages/db/src/schema/{sets,cards,printings}.ts`, exposing the
// externally-useful subset:
//
//   - `id` is included (it's the stable cross-request handle the
//     UI uses for routing — `/v1/cards/{id}`).
//   - `canonical_key` / `variant_key` are included (URL slugs and
//     idempotent client-side caches benefit from them).
//   - `source_metadata` is dropped (pipeline-internal provenance —
//     never user-facing).
//   - `image_source_url` on `printing` is dropped (also internal
//     fallback per the comment in `printings.ts`).
//   - `created_at` / `updated_at` are exposed because mobile's
//     SWR-style cache benefits from them; web doesn't have to
//     read them.
//   - Variant taxonomy (variant class / flag / rarity / Pokémon
//     type / card subtype) is re-declared here as locally-owned
//     zod enums, mirroring the canonical tuples in
//     `data-pipeline/src/types.ts`. We re-declare rather than
//     import so consumers (web / mobile / scanner) don't pull
//     `@binderly/data-pipeline` (Sharp / AWS-SDK / pg-driver
//     weight) into their transitive graph.

import { z } from 'zod';

import { isoDateSchema, isoDateTimeSchema, languageSchema, uuidSchema } from './common.js';

// ============================================================
// Variant taxonomy — mirrors data-pipeline/src/types.ts
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
 * Variant flags — orthogonal modifiers that stack on top of a
 * class. See `context/tcg-domain.md` § 1.
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
 * Card subtype — high-level coarse bucket. Trainer / Energy
 * refinements (`ITEM`, `SUPPORTER`, `BASIC`, `SPECIAL`, etc.)
 * are encoded into the subtype value itself, mirroring
 * `data-pipeline/src/types.ts`.
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

// ============================================================
// Set DTO — mirrors `set` table
// ============================================================

/**
 * Read-side wire shape for a `set` row. Drops
 * `source_metadata` (pipeline-internal). `master_set_rules` is
 * surfaced as `Record<string, unknown>` because the per-set
 * override schema is owned by `T-DL-MASTER-SET-RULES` and the
 * client renders it as opaque JSON for now.
 */
export const setDto = z
  .object({
    id: uuidSchema,
    canonicalKey: z.string().min(1),
    code: z.string().min(1),
    language: languageSchema,
    name: z.string().min(1),
    series: z.string().nullable(),
    releaseDate: isoDateSchema,
    printedTotal: z.number().int().nonnegative().nullable(),
    total: z.number().int().nonnegative().nullable(),
    logoUrl: z.string().url().nullable(),
    symbolUrl: z.string().url().nullable(),
    masterSetRules: z.record(z.unknown()),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type SetDto = z.infer<typeof setDto>;

// ============================================================
// Card DTO — mirrors `card` table
// ============================================================

/**
 * Read-side wire shape for a `card` row.
 *
 * - `attacks` / `weakness` / `resistance` stay as `unknown[]`
 *   because their normalized shape is owned by the data-pipeline
 *   adapter normalizer (the `card.ts` schema comment explicitly
 *   defers their contract there). UIs render them via a small
 *   per-renderer adapter.
 * - `nameLocalized` is `Record<language, string>` — only the two
 *   v1 languages.
 * - `setId` is included so a card detail page can fetch the
 *   parent set without a re-resolution step.
 */
export const cardDto = z
  .object({
    id: uuidSchema,
    canonicalKey: z.string().min(1),
    setId: uuidSchema,
    language: languageSchema,
    number: z.string().min(1),
    name: z.string().min(1),
    nameLocalized: z.record(languageSchema, z.string()).nullable(),
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
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type CardDto = z.infer<typeof cardDto>;

// ============================================================
// Printing DTO — mirrors `printing` table
// ============================================================

/**
 * Read-side wire shape for a `printing` row. `image_source_url`
 * is dropped (pipeline-internal fallback per the schema's own
 * comment). `cardId` is included so the printing detail surface
 * can dereference the parent card cheaply.
 */
export const printingDto = z
  .object({
    id: uuidSchema,
    variantKey: z.string().min(1),
    cardId: uuidSchema,
    variantClass: variantClassSchema,
    variantFlags: z.array(variantFlagSchema),
    variantCode: z.string().min(1),
    includeInMasterSet: z.boolean(),
    imageSmallUrl: z.string().url().nullable(),
    imageLargeUrl: z.string().url().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type PrintingDto = z.infer<typeof printingDto>;

// ============================================================
// Composite shapes
// ============================================================

/**
 * A card with all its printings inlined — the typical "card
 * detail page" payload. Reduces round-trips for a screen that
 * always wants both halves of the join.
 */
export const cardWithPrintingsDto = cardDto
  .extend({
    printings: z.array(printingDto),
  })
  .strict();
export type CardWithPrintingsDto = z.infer<typeof cardWithPrintingsDto>;

/**
 * A printing with its parent card and set inlined — the typical
 * scanner-result payload. The scanner returns "this is the
 * printing you held up; here's everything the UI needs to render
 * a card detail screen".
 */
export const printingWithContextDto = printingDto
  .extend({
    card: cardDto,
    set: setDto,
  })
  .strict();
export type PrintingWithContextDto = z.infer<typeof printingWithContextDto>;
