// Pure transforms: TCGdex JSON → `Raw{Set,Card,Printing}`. Zero side
// effects, no HTTP, no globals. Tested with captured fixture JSON.
//
// The adapter calls these AFTER the rate-limited HTTP client returns
// a parsed body. Errors here mean malformed / unexpected payload;
// they bubble as plain `Error` and are wrapped into `PermanentError`
// by the caller.
//
// References:
//   - `data-pipeline/src/types.ts` — Raw* zod schemas (round-tripped
//     by the test suite).
//   - `data-pipeline/src/variant-classify.ts` — consumes the
//     `RawPrinting` signals we emit.
//   - `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-EN.md` — full mapping
//     tables, kept in sync with this module.

import { type TCGdexCard, type TCGdexSet, type TCGdexVariantDetailed } from './api-types.js';
import { isTcgdexPromoSet } from './promo-sets.js';

import type { RawCard, RawPrinting, RawSet } from '../../types.js';

export const TCGDEX_EN_SOURCE = 'tcgdex-en' as const;

/**
 * Transform a TCGdex `/v2/en/sets/{id}` response to a `RawSet`.
 *
 * Behavioural notes:
 *   - `code` is set to TCGdex's `id` verbatim. TCGdex IDs are already
 *     lowercase and free of whitespace; `canonical-keys.ts` does its
 *     own defensive normalization on top.
 *   - `logoUrl` / `symbolUrl` are reconstructed with a `.png` suffix
 *     because TCGdex serves the asset URL extension-less and the
 *     downstream zod schema requires a fully-qualified URL.
 *   - `printedTotal` / `total` follow the convention from
 *     `tcg-domain.md` § 5: `printed_total` ≅ TCGdex `cardCount.official`
 *     (numbered cards on-card), `total` ≅ TCGdex `cardCount.total`
 *     (includes secret rares + alt prints + Trainer Gallery).
 */
export function tcgdexSetToRaw(set: TCGdexSet): RawSet {
  if (!set.id) {
    throw new Error('tcgdex-en: set is missing required field `id`');
  }
  if (!set.name) {
    throw new Error(`tcgdex-en: set ${set.id} is missing required field \`name\``);
  }
  if (!set.releaseDate) {
    throw new Error(`tcgdex-en: set ${set.id} is missing required field \`releaseDate\``);
  }

  const extra: Record<string, unknown> = {};
  if (set.tcgOnline != null) extra['tcgOnline'] = set.tcgOnline;
  if (set.abbreviation?.official != null) extra['abbreviation'] = set.abbreviation.official;
  if (set.legal != null) extra['legal'] = set.legal;
  if (set.cardCount != null) extra['cardCounts'] = set.cardCount;
  if (set.serie?.id != null) extra['serieId'] = set.serie.id;

  const raw: RawSet = {
    source: TCGDEX_EN_SOURCE,
    sourceKey: set.id,
    code: set.id,
    language: 'en',
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
 * Transform a TCGdex `/v2/en/cards/{id}` response to a `RawCard`.
 *
 * Caller is responsible for the upstream HTTP. The function is pure;
 * any failure surfaces as a thrown `Error` and the adapter wraps it
 * into a `PermanentError`.
 */
export function tcgdexCardToRaw(card: TCGdexCard): RawCard {
  if (!card.id) throw new Error('tcgdex-en: card is missing required field `id`');
  if (!card.localId) {
    throw new Error(`tcgdex-en: card ${card.id} is missing required field \`localId\``);
  }
  if (!card.set?.id) {
    throw new Error(`tcgdex-en: card ${card.id} is missing required field \`set.id\``);
  }
  if (!card.name) {
    throw new Error(`tcgdex-en: card ${card.id} is missing required field \`name\``);
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
    source: TCGDEX_EN_SOURCE,
    sourceKey: card.id,
    setCode: card.set.id,
    language: 'en',
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
 * Transform a TCGdex Card payload into one or more `RawPrinting`s.
 *
 * Resolution order (full rules in
 * `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-EN.md` §
 * "TCGdex Card → RawPrinting[]"):
 *
 *   1. `variants_detailed` when present.
 *   2. `variants` flags otherwise.
 *   3. Rarity-string fallback for SV-era special rares (one
 *      printing).
 *   4. Promo-set fallback when nothing above fired but the parent
 *      set is a promo set (one printing classified `PROMO` by the
 *      classifier).
 *
 * The adapter never assigns `variant_class`. Each printing carries
 * the raw signals (`isHolo`, `isReverseHolo`, `isFullArt`,
 * `isAltArt`, `isGoldRare`, `isFirstEdition`, `isShadowless`,
 * `isTrainerGallery`, `isPromo`) and the variant classifier in
 * `data-pipeline/src/variant-classify.ts` picks the class.
 */
export function tcgdexCardToPrintings(card: TCGdexCard): RawPrinting[] {
  if (!card.id) throw new Error('tcgdex-en: card is missing required field `id`');
  if (!card.set?.id) {
    throw new Error(`tcgdex-en: card ${card.id} is missing required field \`set.id\``);
  }

  const setIsPromo = isTcgdexPromoSet(card.set.id);
  const isTrainerGallery = /^(?:TG|GG)\d+$/i.test(card.localId.trim());
  const rarityFallback = rarityToVariantSignals(card.rarity ?? null);

  const detailed: ReadonlyArray<TCGdexVariantDetailed> = card.variants_detailed ?? [];

  // Branch 1: detailed variants take precedence — they describe each
  // distinct print run (vintage 1st-Ed / Shadowless / Unlimited).
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

  // Branch 2: variants flags. Multiple `true` flags emit multiple
  // printings (rare on modern cards but happens for some Trainer
  // cards: `Professor's Research` is `holo + reverse`).
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

  // Branch 3: rarity-string fallback (SV-era special rares).
  if (rarityFallback.kind !== 'none') {
    printings.push(
      buildPrinting({
        card,
        variantTag: rarityFallback.tag,
        label: rarityFallback.label,
        // SV-era special rares are visually holo even though TCGdex
        // returns `variants.holo: false`.
        isHolo: true,
        isReverseHolo: false,
        rarityFallback,
        isTrainerGallery,
        setIsPromo,
      }),
    );
    return printings;
  }

  // Branch 4: promo-set fallback (cards with no variant info — rare,
  // observed on a handful of older promos).
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

  // No printable signal at all — return empty. The resolver tolerates
  // this; ops can audit via the source's "no printings" log line.
  return printings;
}

// ============================================================
// Internals
// ============================================================

interface BuildPrintingArgs {
  card: TCGdexCard;
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
  detailed?: TCGdexVariantDetailed;
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
    source: TCGDEX_EN_SOURCE,
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
  card: TCGdexCard;
  entry: TCGdexVariantDetailed;
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

  // The detailed entry's `type` is the visual axis. Stamps + subtypes
  // layer on as flags. A run with `type: 'reverse'` is a reverse-holo
  // print regardless of any stamps.
  const isReverseHolo = entry.type === 'reverse';
  const isHolo = entry.type === 'holo';
  // `type: 'normal'` is non-holo (and not reverse).

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

function rarityToVariantSignals(rarity: string | null): RarityFallback {
  if (!rarity) return { kind: 'none', tag: '', label: '' };
  const lc = rarity.trim().toLowerCase();
  if (lc === 'illustration rare') {
    return { kind: 'illustration_rare', tag: 'illustration', label: 'Illustration Rare' };
  }
  if (lc === 'special illustration rare') {
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

function deriveSubtypeRaw(card: TCGdexCard): string | null {
  switch (card.category) {
    case 'Pokemon':
      return 'Pokemon';
    case 'Trainer':
      return card.trainerType ?? null;
    case 'Energy':
      if (card.energyType === 'Special') return 'Special Energy';
      // TCGdex emits `Normal` on per-type basics in modern sets and
      // `Basic` on older sets. Both map to ENERGY_BASIC downstream.
      if (card.energyType != null) return 'Basic Energy';
      return null;
    default:
      return null;
  }
}

function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  // TCGdex serves logos / symbols extension-less; consumers append
  // .png/.webp to pick a format. The Raw* zod schema requires a full
  // URL.
  return `${value}.png`;
}

function maybeBool(value: boolean | undefined | null): boolean | null {
  if (value == null) return null;
  return Boolean(value);
}

/** Re-exported so tests / sibling adapters can introspect the helper. */
export { isTcgdexPromoSet };
