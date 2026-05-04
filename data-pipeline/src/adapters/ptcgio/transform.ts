// Pure transforms: PTCGIO JSON → `Raw{Set,Card,Printing}`. Zero side
// effects, no HTTP, no globals. Tested with captured fixture JSON.
//
// The adapter calls these AFTER the rate-limited HTTP client returns
// a parsed body (already stripped of the `{ data: ... }` envelope).
// Errors here mean malformed / unexpected payload; they bubble as
// plain `Error` and are wrapped into `PermanentError` by the caller.
//
// References:
//   - `data-pipeline/src/types.ts` — Raw* zod schemas (round-tripped
//     by the test suite).
//   - `data-pipeline/src/variant-classify.ts` — consumes the
//     `RawPrinting` signals we emit.
//   - `tasks/01-data-layer/T-DL-SOURCE-PTCGIO.md` — full mapping
//     tables, kept in sync with this module.

import { isPtcgioPromoSet } from './promo-sets.js';

import type { PTCGIOCard, PTCGIOSet } from './api-types.js';
import type { RawCard, RawPrinting, RawSet } from '../../types.js';

export const PTCGIO_SOURCE = 'ptcgio' as const;

/**
 * Transform a PTCGIO `/v2/sets/{id}` response (after envelope strip)
 * into a `RawSet`.
 *
 * Behavioural notes:
 *   - `code` is set to PTCGIO's `id` verbatim. PTCGIO IDs are already
 *     lowercase and free of whitespace.
 *   - `releaseDate` is reformatted from PTCGIO's `yyyy/mm/dd` to ISO
 *     `yyyy-mm-dd` (the `RawSet.releaseDate` zod schema requires ISO).
 *   - `printedTotal` / `total` follow the convention from
 *     `tcg-domain.md` § 5: `printed_total` ≅ PTCGIO `printedTotal`,
 *     `total` ≅ PTCGIO `total`. PTCGIO often under-counts vs TCGdex
 *     because PTCGIO does not surface the Trainer Gallery sub-set;
 *     this is a documented validation-tier limitation.
 */
export function ptcgioSetToRaw(set: PTCGIOSet): RawSet {
  if (!set.id) throw new Error('ptcgio: set is missing required field `id`');
  if (!set.name) throw new Error(`ptcgio: set ${set.id} is missing required field \`name\``);
  if (!set.releaseDate) {
    throw new Error(`ptcgio: set ${set.id} is missing required field \`releaseDate\``);
  }

  const extra: Record<string, unknown> = {};
  if (set.ptcgoCode != null) extra['ptcgoCode'] = set.ptcgoCode;
  if (set.legalities != null) extra['legalities'] = set.legalities;
  if (set.updatedAt != null) extra['updatedAt'] = set.updatedAt;

  const raw: RawSet = {
    source: PTCGIO_SOURCE,
    sourceKey: set.id,
    code: set.id,
    language: 'en',
    name: set.name,
    series: set.series ?? null,
    releaseDate: normalizePtcgioDate(set.releaseDate),
    printedTotal: set.printedTotal ?? null,
    total: set.total ?? null,
    logoUrl: set.images?.logo ?? null,
    symbolUrl: set.images?.symbol ?? null,
  };
  if (Object.keys(extra).length > 0) {
    raw.extra = extra;
  }
  return raw;
}

/**
 * Transform a PTCGIO `/v2/cards/{id}` response (after envelope strip)
 * into a `RawCard`.
 *
 * Caller is responsible for the upstream HTTP. The function is pure;
 * any failure surfaces as a thrown `Error` and the adapter wraps it
 * into a `PermanentError`.
 */
export function ptcgioCardToRaw(card: PTCGIOCard): RawCard {
  if (!card.id) throw new Error('ptcgio: card is missing required field `id`');
  if (!card.number) {
    throw new Error(`ptcgio: card ${card.id} is missing required field \`number\``);
  }
  if (!card.set?.id) {
    throw new Error(`ptcgio: card ${card.id} is missing required field \`set.id\``);
  }
  if (!card.name) {
    throw new Error(`ptcgio: card ${card.id} is missing required field \`name\``);
  }

  const rarityRaw = normalizeRarityRaw(card.rarity ?? null);
  const subtypeRaw = deriveSubtypeRaw(card);
  const typeRaw = card.types && card.types.length > 0 ? (card.types[0] ?? null) : null;
  const hp = parseHp(card.hp);
  const retreatCost =
    card.convertedRetreatCost ?? (Array.isArray(card.retreatCost) ? card.retreatCost.length : null);

  const extra: Record<string, unknown> = {};
  if (card.nationalPokedexNumbers != null) extra['dexId'] = card.nationalPokedexNumbers;
  if (card.subtypes != null) extra['subtypes'] = card.subtypes;
  if (card.evolvesFrom != null) extra['evolvesFrom'] = card.evolvesFrom;
  if (card.evolvesTo != null) extra['evolvesTo'] = card.evolvesTo;
  if (card.regulationMark != null) extra['regulationMark'] = card.regulationMark;
  if (card.legalities != null) extra['legalities'] = card.legalities;
  if (card.rules != null) extra['rules'] = card.rules;
  if (card.abilities != null) extra['abilities'] = card.abilities;
  if (card.ancientTrait != null) extra['ancientTrait'] = card.ancientTrait;
  if (card.level != null) extra['level'] = card.level;
  if (card.images?.small != null) extra['imageSmall'] = card.images.small;
  if (card.images?.large != null) extra['imageLarge'] = card.images.large;
  if (card.supertype != null) extra['supertype'] = card.supertype;

  const raw: RawCard = {
    source: PTCGIO_SOURCE,
    sourceKey: card.id,
    setCode: card.set.id,
    language: 'en',
    number: card.number,
    name: card.name,
    nameLocalized: null,
    typeRaw,
    subtypeRaw,
    hp,
    illustrator: card.artist ?? null,
    flavorText: card.flavorText ?? null,
    attacks: card.attacks ? [...card.attacks] : null,
    weakness: card.weaknesses ? [...card.weaknesses] : null,
    resistance: card.resistances ? [...card.resistances] : null,
    retreatCost,
    rarityRaw,
  };
  if (Object.keys(extra).length > 0) {
    raw.extra = extra;
  }
  return raw;
}

/**
 * Transform a PTCGIO Card payload into one or more `RawPrinting`s.
 *
 * Resolution order (full rules in
 * `tasks/01-data-layer/T-DL-SOURCE-PTCGIO.md` §
 * "PTCGIO Card → RawPrinting[]"):
 *
 *   1. `tcgplayer.prices` keys when present — emit one printing per
 *      key (normal / holofoil / reverseHolofoil / 1stEditionNormal /
 *      1stEditionHolofoil).
 *   2. Rarity-string fallback when the prices map is absent / empty.
 *   3. Promo-set fallback when 1+2 produced nothing.
 *
 * After determining which printings exist, the adapter overlays
 * class signals derived from the rarity string on every emitted
 * printing (Illustration Rare → isFullArt, Special Illustration Rare
 * → isAltArt, Hyper Rare → isGoldRare, Rare Rainbow → isRainbowRare,
 * Trainer Gallery Rare Holo → isTrainerGallery, Promo → isPromo).
 *
 * The adapter never assigns `variant_class` — the variant classifier
 * in `data-pipeline/src/variant-classify.ts` picks the class.
 */
export function ptcgioCardToPrintings(card: PTCGIOCard): RawPrinting[] {
  if (!card.id) throw new Error('ptcgio: card is missing required field `id`');
  if (!card.set?.id) {
    throw new Error(`ptcgio: card ${card.id} is missing required field \`set.id\``);
  }

  const setIsPromo = isPtcgioPromoSet(card.set.id);
  const rarityOverlay = rarityToOverlay(card.rarity ?? null);
  const isTrainerGalleryByNumber = /^(?:TG|GG)\d+$/i.test((card.number ?? '').trim());

  // Branch 1: tcgplayer.prices key set — strongest signal.
  const priceKeys = collectPriceKeys(card.tcgplayer?.prices);
  if (priceKeys.length > 0) {
    const printings: RawPrinting[] = [];
    for (const key of priceKeys) {
      const print = priceKeyToPrinting(card, key);
      if (print)
        printings.push(applyOverlay(print, rarityOverlay, isTrainerGalleryByNumber, setIsPromo));
    }
    if (printings.length > 0) return printings;
  }

  // Branch 2: rarity-string fallback.
  if (rarityOverlay.kind !== 'none') {
    const printing = rarityOverlayToPrinting(card, rarityOverlay);
    return [applyOverlay(printing, rarityOverlay, isTrainerGalleryByNumber, setIsPromo)];
  }
  if (card.rarity) {
    // Plain rarity (Common / Uncommon / Rare / Rare Holo …) — emit a
    // single printing with isHolo derived from the string.
    const printing = plainRarityToPrinting(card);
    return [applyOverlay(printing, rarityOverlay, isTrainerGalleryByNumber, setIsPromo)];
  }

  // Branch 3: promo-set fallback (no rarity, no prices).
  if (setIsPromo) {
    return [
      applyOverlay(
        buildPrinting({
          card,
          variantTag: 'promo',
          label: 'Promo',
          isHolo: false,
          isReverseHolo: false,
          isFirstEdition: false,
        }),
        rarityOverlay,
        isTrainerGalleryByNumber,
        true,
      ),
    ];
  }

  return [];
}

/** Re-exported so tests / sibling adapters can introspect the helper. */
export { isPtcgioPromoSet };

// ============================================================
// Internals
// ============================================================

interface BuildPrintingArgs {
  card: PTCGIOCard;
  variantTag: string;
  label: string;
  isHolo: boolean;
  isReverseHolo: boolean;
  isFirstEdition: boolean;
}

function buildPrinting(args: BuildPrintingArgs): RawPrinting {
  const { card, variantTag, label, isHolo, isReverseHolo, isFirstEdition } = args;
  const printing: RawPrinting = {
    source: PTCGIO_SOURCE,
    sourceKey: `${card.id}-${variantTag}`,
    cardKey: card.id,
    sourcePrintingLabel: label,
    rarityRaw: normalizeRarityRaw(card.rarity ?? null),
    isHolo,
    isReverseHolo,
    isFirstEdition,
    isShadowless: false,
    isFullArt: false,
    isAltArt: false,
    isGoldRare: false,
    isRainbowRare: false,
    isTextured: false,
    isTrainerGallery: false,
    isPromo: false,
    isError: false,
    pattern: null,
    stamp: null,
    imageSourceUrl: card.images?.large ?? card.images?.small ?? null,
  };
  return printing;
}

/**
 * Apply rarity-string overlay signals to a printing produced from
 * Branch 1 / 2 / 3. Mutates a shallow copy and returns it.
 */
function applyOverlay(
  printing: RawPrinting,
  overlay: RarityOverlay,
  isTrainerGalleryByNumber: boolean,
  setIsPromo: boolean,
): RawPrinting {
  // Special-class rarities are visually holographic; mark isHolo true
  // unless already explicitly reverse-holo.
  if (overlay.kind === 'illustration_rare') {
    printing.isFullArt = true;
    if (!printing.isReverseHolo) printing.isHolo = true;
  } else if (overlay.kind === 'special_illustration_rare') {
    printing.isAltArt = true;
    if (!printing.isReverseHolo) printing.isHolo = true;
  } else if (overlay.kind === 'hyper_rare') {
    printing.isGoldRare = true;
    if (!printing.isReverseHolo) printing.isHolo = true;
  } else if (overlay.kind === 'rainbow_rare') {
    printing.isRainbowRare = true;
    if (!printing.isReverseHolo) printing.isHolo = true;
  } else if (overlay.kind === 'trainer_gallery') {
    printing.isTrainerGallery = true;
    if (!printing.isReverseHolo) printing.isHolo = true;
  } else if (overlay.kind === 'promo') {
    printing.isPromo = true;
  }

  // Defensive Trainer Gallery detection from card number prefix.
  if (isTrainerGalleryByNumber) {
    printing.isTrainerGallery = true;
  }

  if (setIsPromo) {
    printing.isPromo = true;
  }

  return printing;
}

/**
 * Map a `tcgplayer.prices` key to a printing. Returns null for
 * unrecognized keys (caller logs a warn and falls through).
 */
function priceKeyToPrinting(card: PTCGIOCard, key: string): RawPrinting | null {
  switch (key) {
    case 'normal':
      return buildPrinting({
        card,
        variantTag: 'normal',
        label: 'Non-Holo',
        isHolo: false,
        isReverseHolo: false,
        isFirstEdition: false,
      });
    case 'holofoil':
      return buildPrinting({
        card,
        variantTag: 'holo',
        label: 'Holo',
        isHolo: true,
        isReverseHolo: false,
        isFirstEdition: false,
      });
    case 'reverseHolofoil':
      return buildPrinting({
        card,
        variantTag: 'reverse',
        label: 'Reverse Holo',
        isHolo: false,
        isReverseHolo: true,
        isFirstEdition: false,
      });
    case '1stEditionNormal':
      return buildPrinting({
        card,
        variantTag: 'normal-1stedition',
        label: '1st Edition Non-Holo',
        isHolo: false,
        isReverseHolo: false,
        isFirstEdition: true,
      });
    case '1stEditionHolofoil':
      return buildPrinting({
        card,
        variantTag: 'holo-1stedition',
        label: '1st Edition Holo',
        isHolo: true,
        isReverseHolo: false,
        isFirstEdition: true,
      });
    default:
      return null;
  }
}

/**
 * Order of `tcgplayer.prices` keys we walk. Insertion order is the
 * natural order PTCGIO emits, but we explicitly enumerate the
 * supported keys (in non-1st-Edition → 1st-Edition order) so that
 * unknown keys are skipped consistently.
 */
const KNOWN_PRICE_KEYS: ReadonlyArray<string> = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  '1stEditionNormal',
  '1stEditionHolofoil',
];

function collectPriceKeys(prices: Record<string, unknown> | undefined): string[] {
  if (!prices) return [];
  const result: string[] = [];
  for (const key of KNOWN_PRICE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(prices, key)) result.push(key);
  }
  return result;
}

interface RarityOverlay {
  kind:
    | 'none'
    | 'illustration_rare'
    | 'special_illustration_rare'
    | 'hyper_rare'
    | 'rainbow_rare'
    | 'trainer_gallery'
    | 'promo';
  tag: string;
  label: string;
}

function rarityToOverlay(rarity: string | null): RarityOverlay {
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
  if (lc === 'rare rainbow' || lc === 'rainbow rare') {
    return { kind: 'rainbow_rare', tag: 'rainbow', label: 'Rainbow Rare' };
  }
  if (lc === 'trainer gallery rare holo') {
    return { kind: 'trainer_gallery', tag: 'trainer-gallery', label: 'Trainer Gallery Rare Holo' };
  }
  if (lc === 'promo') {
    return { kind: 'promo', tag: 'promo', label: 'Promo' };
  }
  return { kind: 'none', tag: '', label: '' };
}

/**
 * Build a printing for a card whose only signal is the rarity-overlay
 * branch (no `tcgplayer.prices` keys). All overlay rarities are
 * visually holographic.
 */
function rarityOverlayToPrinting(card: PTCGIOCard, overlay: RarityOverlay): RawPrinting {
  return buildPrinting({
    card,
    variantTag: overlay.tag,
    label: overlay.label,
    isHolo: overlay.kind !== 'promo',
    isReverseHolo: false,
    isFirstEdition: false,
  });
}

/**
 * Build a printing for a card with a plain rarity (Common / Uncommon /
 * Rare / Rare Holo / Rare Holo VSTAR / Rare Secret / etc.) and no
 * `tcgplayer.prices` keys. Used on cards that are missing pricing
 * data entirely (rare in the wild but possible for newly-added or
 * promo cards).
 */
function plainRarityToPrinting(card: PTCGIOCard): RawPrinting {
  const rarity = (card.rarity ?? '').trim();
  const lc = rarity.toLowerCase();
  // Anything with "holo" in the name reads as a holo print; "Rare
  // Ultra" / "Rare Secret" / "Amazing Rare" / "Radiant Rare" /
  // "Double Rare" likewise. Plain "Common"/"Uncommon"/"Rare" → non-holo.
  const isHolo =
    lc.includes('holo') ||
    lc === 'rare ultra' ||
    lc === 'rare secret' ||
    lc === 'amazing rare' ||
    lc === 'radiant rare' ||
    lc === 'double rare' ||
    lc === 'rare shiny' ||
    lc === 'rare shining' ||
    lc === 'rare prism star' ||
    lc === 'rare prime' ||
    lc === 'rare ace' ||
    lc === 'rare break';
  return buildPrinting({
    card,
    variantTag: isHolo ? 'holo' : 'normal',
    label: isHolo ? 'Holo' : 'Non-Holo',
    isHolo,
    isReverseHolo: false,
    isFirstEdition: false,
  });
}

/**
 * PTCGIO emits empty strings or `'None'` on rare cards lacking a
 * rarity tier. Coerce these to `null` so the resolver / rarity
 * normalizer don't have to learn a "None" alias.
 */
function normalizeRarityRaw(rarity: string | null): string | null {
  if (rarity == null) return null;
  const trimmed = rarity.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'none') return null;
  return trimmed;
}

/**
 * PTCGIO's `releaseDate` is `yyyy/mm/dd`; the `RawSet.releaseDate`
 * zod schema requires ISO `yyyy-mm-dd`. Defensive: also accept ISO
 * input verbatim (idempotent).
 */
export function normalizePtcgioDate(input: string): string {
  const trimmed = input.trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(trimmed);
  if (!m) {
    throw new Error(`ptcgio: cannot normalize releaseDate ${JSON.stringify(input)}`);
  }
  const yyyy = m[1]!;
  const mm = m[2]!.padStart(2, '0');
  const dd = m[3]!.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * PTCGIO emits `hp` as a string ("280", "120", "60", or absent). Some
 * vintage cards have hp `"?"` for the unset / mystery hp gimmick. We
 * parse defensively.
 */
function parseHp(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function deriveSubtypeRaw(card: PTCGIOCard): string | null {
  const subtypes = (card.subtypes ?? []).map((s) => s.trim());
  switch (card.supertype) {
    case 'Pokémon':
      return 'Pokemon';
    case 'Trainer':
      if (subtypes.includes('Item')) return 'Item';
      if (subtypes.includes('Supporter')) return 'Supporter';
      if (subtypes.includes('Stadium')) return 'Stadium';
      if (subtypes.includes('Pokémon Tool')) return 'Pokémon Tool';
      if (subtypes.includes('Tool')) return 'Tool';
      return null;
    case 'Energy':
      if (subtypes.includes('Special')) return 'Special Energy';
      // Default for Energy is the basic-typed energies (subtypes:
      // ["Basic"]).
      return 'Basic Energy';
    default:
      return null;
  }
}
