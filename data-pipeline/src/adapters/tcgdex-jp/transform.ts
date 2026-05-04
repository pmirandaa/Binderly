// Pure transforms: TCGdex JP JSON → `Raw{Set,Card,Printing}`. Zero
// side effects, no HTTP, no globals. Tested with captured fixture
// JSON.
//
// The JP transform is structurally a clone of the EN transform — the
// REST shape is identical across language slugs. We keep a separate
// copy (rather than re-export from `../tcgdex-en/transform.ts`) so a
// future EN-only change (e.g. EN-specific rarity alias on
// `rarityToVariantSignals`) doesn't ripple into JP.
//
// The single deliberate cross-import is `isTcgdexPromoSet`, the
// language-agnostic suffix-`p` rule from `../tcgdex-en/promo-sets.ts`.
// The TCGDEX-EN execution-notes appendix pre-authorized this reuse.
//
// References:
//   - `data-pipeline/src/types.ts` — Raw* zod schemas (round-tripped
//     by the test suite).
//   - `data-pipeline/src/variant-classify.ts` — consumes the
//     `RawPrinting` signals we emit.
//   - `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-JP.md` — full mapping
//     tables, kept in sync with this module.

import { type TCGdexJpCard, type TCGdexJpSet, type TCGdexJpVariantDetailed } from './api-types.js';
import { isTcgdexPromoSet } from '../tcgdex-en/promo-sets.js';

import type { RawCard, RawPrinting, RawSet } from '../../types.js';

export const TCGDEX_JP_SOURCE = 'tcgdex-jp' as const;

/**
 * Transform a TCGdex `/v2/jp/sets/{id}` response to a `RawSet`.
 *
 * Behavioural notes:
 *   - `code` is set to TCGdex's `id` verbatim. TCGdex IDs are already
 *     lowercase and free of whitespace; `canonical-keys.ts` does its
 *     own defensive normalization on top.
 *   - `logoUrl` / `symbolUrl` are reconstructed with a `.png` suffix
 *     because TCGdex serves the asset URL extension-less and the
 *     downstream zod schema requires a fully-qualified URL.
 *   - Japanese strings on `name` / `series` flow through verbatim.
 */
export function tcgdexJpSetToRaw(set: TCGdexJpSet): RawSet {
  if (!set.id) {
    throw new Error('tcgdex-jp: set is missing required field `id`');
  }
  if (!set.name) {
    throw new Error(`tcgdex-jp: set ${set.id} is missing required field \`name\``);
  }
  if (!set.releaseDate) {
    throw new Error(`tcgdex-jp: set ${set.id} is missing required field \`releaseDate\``);
  }

  const extra: Record<string, unknown> = {};
  if (set.tcgOnline != null) extra['tcgOnline'] = set.tcgOnline;
  if (set.abbreviation?.official != null) extra['abbreviation'] = set.abbreviation.official;
  if (set.legal != null) extra['legal'] = set.legal;
  if (set.cardCount != null) extra['cardCounts'] = set.cardCount;
  if (set.serie?.id != null) extra['serieId'] = set.serie.id;

  const raw: RawSet = {
    source: TCGDEX_JP_SOURCE,
    sourceKey: set.id,
    code: set.id,
    language: 'jp',
    name: set.name,
    series: set.serie?.name ?? null,
    releaseDate: set.releaseDate,
    printedTotal: set.cardCount?.official ?? null,
    total: set.cardCount?.total ?? null,
    logoUrl: assetUrl(set.logo),
    symbolUrl: assetUrl(set.symbol),
  };
  if (Object.keys(extra).length > 0) {
    raw.extra = extra;
  }
  return raw;
}

/**
 * Transform a TCGdex `/v2/jp/cards/{id}` response to a `RawCard`.
 *
 * The JP adapter is the JP authority — this record's `name` carries
 * the Japanese name. `nameLocalized` stays `null` because the
 * cross-language join (matching the EN canonical card → setting its
 * `nameLocalized.jp`) lives in the seed-ingest task, not this
 * transform.
 */
export function tcgdexJpCardToRaw(card: TCGdexJpCard): RawCard {
  if (!card.id) throw new Error('tcgdex-jp: card is missing required field `id`');
  if (!card.localId) {
    throw new Error(`tcgdex-jp: card ${card.id} is missing required field \`localId\``);
  }
  if (!card.set?.id) {
    throw new Error(`tcgdex-jp: card ${card.id} is missing required field \`set.id\``);
  }
  if (!card.name) {
    throw new Error(`tcgdex-jp: card ${card.id} is missing required field \`name\``);
  }

  const rarityRaw = normalizeRarityRaw(card.rarity ?? null);
  const subtypeRaw = deriveSubtypeRaw(card);
  const typeRaw = card.types && card.types.length > 0 ? (card.types[0] ?? null) : null;

  const extra: Record<string, unknown> = {};
  if (card.dexId != null) extra['dexId'] = card.dexId;
  if (card.stage != null) extra['stage'] = card.stage;
  if (card.evolveFrom != null) extra['evolveFrom'] = card.evolveFrom;
  if (card.regulationMark != null) extra['regulationMark'] = card.regulationMark;
  if (card.suffix != null) extra['suffix'] = card.suffix;
  if (card.legal != null) extra['legal'] = card.legal;
  if (card.effect != null) extra['effect'] = card.effect;
  if (card.trainerType != null) extra['trainerType'] = card.trainerType;
  if (card.energyType != null) extra['energyType'] = card.energyType;
  if (card.abilities != null) extra['abilities'] = card.abilities;
  if (card.image) extra['imageUrl'] = `${card.image}/high.png`;
  if (card.updated != null) extra['updated'] = card.updated;
  if (card.category != null) extra['category'] = card.category;

  const raw: RawCard = {
    source: TCGDEX_JP_SOURCE,
    sourceKey: card.id,
    setCode: card.set.id,
    language: 'jp',
    number: card.localId,
    name: card.name,
    nameLocalized: null,
    typeRaw,
    subtypeRaw,
    hp: card.hp ?? null,
    illustrator: card.illustrator ?? null,
    flavorText: card.description ?? null,
    attacks: card.attacks ? [...card.attacks] : null,
    weakness: card.weaknesses ? [...card.weaknesses] : null,
    resistance: card.resistances ? [...card.resistances] : null,
    retreatCost: card.retreat ?? null,
    rarityRaw,
  };
  if (Object.keys(extra).length > 0) {
    raw.extra = extra;
  }
  return raw;
}

/**
 * Transform a TCGdex JP Card payload into one or more `RawPrinting`s.
 *
 * Resolution order (full rules in
 * `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-JP.md` §
 * "TCGdex JP Card → RawPrinting[]"):
 *
 *   1. `variants_detailed` when present.
 *   2. `variants` flags otherwise.
 *   3. Rarity-string fallback for SV-era special rares (one
 *      printing). The JP-side accepts both the EN-tier labels
 *      ("Illustration Rare", "Special Illustration Rare", "Hyper
 *      Rare", "Rainbow Rare") and the JP-specific aliases ("Art
 *      Rare", "Special Art Rare").
 *   4. Promo-set fallback when nothing above fired but the parent
 *      set is a promo set (one printing classified `PROMO` by the
 *      classifier).
 *
 * The adapter never assigns `variant_class`. Each printing carries
 * the raw signals and the central classifier in
 * `data-pipeline/src/variant-classify.ts` picks the class.
 */
export function tcgdexJpCardToPrintings(card: TCGdexJpCard): RawPrinting[] {
  if (!card.id) throw new Error('tcgdex-jp: card is missing required field `id`');
  if (!card.set?.id) {
    throw new Error(`tcgdex-jp: card ${card.id} is missing required field \`set.id\``);
  }

  const setIsPromo = isTcgdexPromoSet(card.set.id);
  const isTrainerGallery = /^(?:TG|GG)\d+$/i.test(card.localId.trim());
  const rarityFallback = rarityToVariantSignals(card.rarity ?? null);

  const detailed: ReadonlyArray<TCGdexJpVariantDetailed> = card.variants_detailed ?? [];

  if (detailed.length > 0) {
    return detailed.map((entry, index) =>
      buildPrintingFromDetailed({
        card,
        entry,
        entryIndex: index,
        rarityFallback,
        isTrainerGallery,
        setIsPromo,
      }),
    );
  }

  const printings: RawPrinting[] = [];
  const variants = card.variants;

  if (variants && (variants.normal || variants.reverse || variants.holo)) {
    if (variants.normal) {
      printings.push(
        buildPrinting({
          card,
          variantTag: 'normal',
          label: 'Non-Holo',
          isHolo: false,
          isReverseHolo: false,
          rarityFallback,
          isTrainerGallery,
          setIsPromo,
        }),
      );
    }
    if (variants.reverse) {
      printings.push(
        buildPrinting({
          card,
          variantTag: 'reverse',
          label: 'Reverse Holo',
          isHolo: false,
          isReverseHolo: true,
          rarityFallback,
          isTrainerGallery,
          setIsPromo,
        }),
      );
    }
    if (variants.holo) {
      printings.push(
        buildPrinting({
          card,
          variantTag: 'holo',
          label: 'Holo',
          isHolo: true,
          isReverseHolo: false,
          rarityFallback,
          isTrainerGallery,
          setIsPromo,
        }),
      );
    }
    return printings;
  }

  if (rarityFallback.kind !== 'none') {
    printings.push(
      buildPrinting({
        card,
        variantTag: rarityFallback.tag,
        label: rarityFallback.label,
        isHolo: true,
        isReverseHolo: false,
        rarityFallback,
        isTrainerGallery,
        setIsPromo,
      }),
    );
    return printings;
  }

  if (setIsPromo) {
    printings.push(
      buildPrinting({
        card,
        variantTag: 'promo',
        label: 'Promo',
        isHolo: maybeBool(variants?.holo) ?? false,
        isReverseHolo: false,
        rarityFallback,
        isTrainerGallery,
        setIsPromo,
      }),
    );
    return printings;
  }

  return printings;
}

// ============================================================
// Internals
// ============================================================

interface BuildPrintingArgs {
  card: TCGdexJpCard;
  variantTag: string;
  label: string;
  isHolo: boolean;
  isReverseHolo: boolean;
  rarityFallback: RarityFallback;
  isTrainerGallery: boolean;
  setIsPromo: boolean;
  isFirstEdition?: boolean;
  isShadowless?: boolean;
  isUnlimited?: boolean;
  detailed?: TCGdexJpVariantDetailed;
}

function buildPrinting(args: BuildPrintingArgs): RawPrinting {
  const {
    card,
    variantTag,
    label,
    isHolo,
    isReverseHolo,
    rarityFallback,
    isTrainerGallery,
    setIsPromo,
    isFirstEdition,
    isShadowless,
    isUnlimited,
    detailed,
  } = args;

  const extra: Record<string, unknown> = {};
  if (detailed?.variantId != null) extra['tcgdexVariantId'] = detailed.variantId;
  if (detailed?.size != null) extra['size'] = detailed.size;
  if (detailed?.subtype != null) extra['subtypeTag'] = detailed.subtype;
  if (isUnlimited === true) extra['isUnlimited'] = true;

  const printing: RawPrinting = {
    source: TCGDEX_JP_SOURCE,
    sourceKey: `${card.id}-${variantTag}`,
    cardKey: card.id,
    sourcePrintingLabel: label,
    rarityRaw: normalizeRarityRaw(card.rarity ?? null),
    isHolo,
    isReverseHolo,
    isFirstEdition: isFirstEdition ?? false,
    isShadowless: isShadowless ?? false,
    isFullArt: rarityFallback.kind === 'illustration_rare',
    isAltArt: rarityFallback.kind === 'special_illustration_rare',
    isGoldRare: rarityFallback.kind === 'hyper_rare',
    isRainbowRare: rarityFallback.kind === 'rainbow_rare',
    isTextured: false,
    isTrainerGallery,
    isPromo: setIsPromo || card.variants?.wPromo === true,
    isError: false,
    pattern: null,
    stamp: null,
    imageSourceUrl: card.image ? `${card.image}/high.png` : null,
  };
  if (Object.keys(extra).length > 0) {
    printing.extra = extra;
  }
  return printing;
}

interface DetailedArgs {
  card: TCGdexJpCard;
  entry: TCGdexJpVariantDetailed;
  entryIndex: number;
  rarityFallback: RarityFallback;
  isTrainerGallery: boolean;
  setIsPromo: boolean;
}

function buildPrintingFromDetailed(args: DetailedArgs): RawPrinting {
  const { card, entry, entryIndex, rarityFallback, isTrainerGallery, setIsPromo } = args;

  const stamp1stEd = (entry.stamp ?? []).some((s) => s.toLowerCase() === '1st-edition');
  const subtypeTag = entry.subtype ? entry.subtype.toLowerCase() : '';
  const isShadowless = subtypeTag === 'shadowless';
  const isUnlimited = subtypeTag === 'unlimited';

  const isReverseHolo = entry.type === 'reverse';
  const isHolo = entry.type === 'holo';

  const variantTag = buildVariantTag({
    type: entry.type,
    isShadowless,
    isUnlimited,
    isFirstEdition: stamp1stEd,
    fallback: `var${entryIndex + 1}`,
  });

  const label = buildLabel({
    type: entry.type,
    isShadowless,
    isUnlimited,
    isFirstEdition: stamp1stEd,
  });

  return buildPrinting({
    card,
    variantTag,
    label,
    isHolo,
    isReverseHolo,
    rarityFallback,
    isTrainerGallery,
    setIsPromo,
    isFirstEdition: stamp1stEd,
    isShadowless,
    isUnlimited,
    detailed: entry,
  });
}

function buildVariantTag(args: {
  type: string;
  isShadowless: boolean;
  isUnlimited: boolean;
  isFirstEdition: boolean;
  fallback: string;
}): string {
  const parts: string[] = [];
  if (args.type === 'reverse') parts.push('reverse');
  else if (args.type === 'holo') parts.push('holo');
  else if (args.type === 'normal') parts.push('normal');
  else parts.push(args.type || args.fallback);
  if (args.isShadowless) parts.push('shadowless');
  if (args.isUnlimited) parts.push('unlimited');
  if (args.isFirstEdition) parts.push('1stedition');
  return parts.join('-');
}

function buildLabel(args: {
  type: string;
  isShadowless: boolean;
  isUnlimited: boolean;
  isFirstEdition: boolean;
}): string {
  const parts: string[] = [];
  if (args.isFirstEdition) parts.push('1st Edition');
  if (args.isShadowless) parts.push('Shadowless');
  if (args.isUnlimited) parts.push('Unlimited');
  if (args.type === 'reverse') parts.push('Reverse Holo');
  else if (args.type === 'holo') parts.push('Holo');
  else if (args.type === 'normal') parts.push('Non-Holo');
  else parts.push(args.type);
  return parts.join(' ');
}

interface RarityFallback {
  kind: 'none' | 'illustration_rare' | 'special_illustration_rare' | 'hyper_rare' | 'rainbow_rare';
  tag: string;
  label: string;
}

/**
 * Map a TCGdex JP rarity string to the visual-axis fallback signals
 * used by the SV-era branch. JP responses use the same English-tier
 * vocabulary as EN PLUS two JP-specific aliases:
 *   - `"Art Rare"` / `"Illustration Rare"`        → FULL_ART axis.
 *   - `"Special Art Rare"` / `"Special Illustration Rare"` → ALT_ART.
 *   - `"Hyper Rare"`                              → GOLD axis.
 *   - `"Rainbow Rare"` / `"Rare Rainbow"`         → RAINBOW axis.
 */
function rarityToVariantSignals(rarity: string | null): RarityFallback {
  if (!rarity) return { kind: 'none', tag: '', label: '' };
  const lc = rarity.trim().toLowerCase();
  if (lc === 'illustration rare' || lc === 'art rare') {
    return { kind: 'illustration_rare', tag: 'illustration', label: 'Illustration Rare' };
  }
  if (lc === 'special illustration rare' || lc === 'special art rare') {
    return {
      kind: 'special_illustration_rare',
      tag: 'special-illustration',
      label: 'Special Illustration Rare',
    };
  }
  if (lc === 'hyper rare') {
    return { kind: 'hyper_rare', tag: 'hyper', label: 'Hyper Rare' };
  }
  if (lc === 'rainbow rare' || lc === 'rare rainbow') {
    return { kind: 'rainbow_rare', tag: 'rainbow', label: 'Rainbow Rare' };
  }
  return { kind: 'none', tag: '', label: '' };
}

/**
 * TCGdex emits `"None"` (sometimes empty string) on cards lacking a
 * rarity tier — typically promos. We coerce these to `null` so the
 * resolver / rarity normalizer don't have to learn a "None" alias.
 */
function normalizeRarityRaw(rarity: string | null): string | null {
  if (rarity == null) return null;
  const trimmed = rarity.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'none') return null;
  return trimmed;
}

function deriveSubtypeRaw(card: TCGdexJpCard): string | null {
  switch (card.category) {
    case 'Pokemon':
      return 'Pokemon';
    case 'Trainer':
      return card.trainerType ?? null;
    case 'Energy':
      if (card.energyType === 'Special') return 'Special Energy';
      if (card.energyType != null) return 'Basic Energy';
      return null;
    default:
      return null;
  }
}

function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value}.png`;
}

function maybeBool(value: boolean | undefined | null): boolean | null {
  if (value == null) return null;
  return Boolean(value);
}

/** Re-exported so tests / sibling adapters can introspect the helper. */
export { isTcgdexPromoSet };
