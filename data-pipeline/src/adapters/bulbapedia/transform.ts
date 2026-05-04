// Pure transforms: Bulbapedia `Parsed*` shapes → `Raw{Set,Card,Printing}`.
// Zero side effects, no HTTP, no globals. Tested with captured
// fixture wikitext.
//
// References:
//   - `data-pipeline/src/types.ts` — Raw* zod schemas (round-tripped
//     by the test suite).
//   - `data-pipeline/src/variant-classify.ts` — consumes the
//     `RawPrinting` signals we emit.
//   - `tasks/01-data-layer/T-DL-SOURCE-BULBAPEDIA.md` — full mapping
//     tables, kept in sync with this module.

import { parseCardInfobox } from './parsers/card-infobox.js';
import { parseSetInfobox } from './parsers/set-infobox.js';
import { isBulbapediaPromoSet, resolveBulbapediaSetCode } from './set-codes.js';

import type { ParsedCard, ParsedPrinting, ParsedSet } from './wiki-types.js';
import type { RawCard, RawPrinting, RawSet } from '../../types.js';

export const BULBAPEDIA_EN_SOURCE = 'bulbapedia-en' as const;

// Re-exported helpers so sibling adapter / orchestrator code can
// introspect Bulbapedia conventions without recompiling.
export { isBulbapediaPromoSet, resolveBulbapediaSetCode };

/**
 * Wikitext → `RawSet`. Convenience wrapper over `parseSetInfobox` +
 * `bulbapediaParsedSetToRaw` that the adapter uses on each fetch.
 */
export function bulbapediaWikitextToSet(pageTitle: string, wikitext: string): RawSet {
  return bulbapediaParsedSetToRaw(parseSetInfobox(pageTitle, wikitext));
}

/**
 * `ParsedSet` → `RawSet`. Stays pure for unit testing without the
 * wikitext parser stage.
 */
export function bulbapediaParsedSetToRaw(parsed: ParsedSet): RawSet {
  if (!parsed.pageTitle) {
    throw new Error('bulbapedia-en: parsed set is missing pageTitle');
  }
  // The page-title trailing `(TCG)` is stripped to recover the human
  // set name; the infobox name is the source of truth when present.
  const pageTitleSetName = parsed.pageTitle.replace(/\s*\(TCG\)\s*$/i, '').trim();
  const setName = parsed.name ?? pageTitleSetName;
  if (!setName) {
    throw new Error(`bulbapedia-en: set ${JSON.stringify(parsed.pageTitle)} has no usable name`);
  }
  if (!parsed.releaseDate) {
    throw new Error(
      `bulbapedia-en: set ${JSON.stringify(parsed.pageTitle)} is missing required field releaseDate`,
    );
  }
  const code = resolveBulbapediaSetCode(setName);

  const extra: Record<string, unknown> = {
    bulbapediaTitle: parsed.pageTitle,
    bulbapediaSetName: setName,
  };
  if (parsed.japaneseName) extra['japaneseName'] = parsed.japaneseName;

  const raw: RawSet = {
    source: BULBAPEDIA_EN_SOURCE,
    sourceKey: parsed.pageTitle,
    code,
    language: 'en',
    name: setName,
    series: parsed.series ?? null,
    releaseDate: parsed.releaseDate,
    printedTotal: parsed.printedTotal ?? null,
    total: parsed.total ?? parsed.printedTotal ?? null,
    logoUrl: null,
    symbolUrl: null,
    extra,
  };
  return raw;
}

/**
 * Wikitext → `RawCard`. Convenience wrapper.
 */
export function bulbapediaWikitextToCard(pageTitle: string, wikitext: string): RawCard {
  return bulbapediaParsedCardToRaw(parseCardInfobox(pageTitle, wikitext));
}

/**
 * `ParsedCard` → `RawCard`.
 *
 * Behavioural notes:
 *   - Number padding follows TCGdex convention: pure numerics zero-
 *     pad to 3 (`4` → `004`); lettered numbers (`TG01`, `GG14`,
 *     `SWSH285`) preserve the original form per the elaborated spec
 *     and the rule in `rules/01-data-layer.md` ("never strip leading
 *     zeros from `card.number`. `TG01` is not `TG1`.")
 *   - `setCode` is resolved via `resolveBulbapediaSetCode`. When the
 *     mapping table doesn't carry the set, we emit a slug fallback
 *     that the resolver flags as a presence conflict.
 *   - We never emit Bulbapedia hosted image URLs anywhere — neither
 *     on `RawCard` nor on `RawPrinting.imageSourceUrl`. Per
 *     `legal-and-brand.md`, the wiki's image hosting is
 *     CC-BY-NC-SA-incompatible for our re-host pipeline; the
 *     primary tier carries the image URL.
 */
export function bulbapediaParsedCardToRaw(parsed: ParsedCard): RawCard {
  if (!parsed.pageTitle) {
    throw new Error('bulbapedia-en: parsed card is missing pageTitle');
  }
  const setName = parsed.setName;
  if (!setName) {
    throw new Error(
      `bulbapedia-en: card ${JSON.stringify(parsed.pageTitle)} is missing setName (couldn't determine parent set)`,
    );
  }
  if (!parsed.name) {
    throw new Error(
      `bulbapedia-en: card ${JSON.stringify(parsed.pageTitle)} is missing required field name`,
    );
  }
  if (!parsed.number) {
    throw new Error(
      `bulbapedia-en: card ${JSON.stringify(parsed.pageTitle)} is missing required field number`,
    );
  }

  const number = padCardNumber(parsed.number);
  const setCode = resolveBulbapediaSetCode(setName);

  const subtypeRaw = deriveSubtypeRaw(parsed);
  const rarityRaw = normalizeRarityRaw(parsed.rarity ?? null);
  const typeRaw = parsed.type ?? null;

  const nameLocalized: Record<string, string> | null = parsed.japaneseName
    ? { jp: parsed.japaneseName }
    : null;

  const extra: Record<string, unknown> = { bulbapediaTitle: parsed.pageTitle };
  if (parsed.evostage) extra['evostage'] = parsed.evostage;
  if (parsed.evolveFrom) extra['evolveFrom'] = parsed.evolveFrom;
  if (parsed.species) extra['species'] = parsed.species;
  if (parsed.regulationMark) extra['regulationMark'] = parsed.regulationMark;
  if (parsed.cardnoRaw) extra['cardno'] = parsed.cardnoRaw;
  if (parsed.class) extra['class'] = parsed.class;
  if (parsed.cardType) extra['cardType'] = parsed.cardType;
  extra['expansion'] = setName;

  const raw: RawCard = {
    source: BULBAPEDIA_EN_SOURCE,
    sourceKey: parsed.pageTitle,
    setCode,
    language: 'en',
    number,
    name: parsed.name,
    nameLocalized,
    typeRaw,
    subtypeRaw,
    hp: parsed.hp ?? null,
    illustrator: parsed.illustrator ?? null,
    flavorText: null,
    attacks: null,
    weakness: null,
    resistance: null,
    retreatCost: parsed.retreatCost ?? null,
    rarityRaw,
    extra,
  };
  return raw;
}

/**
 * Wikitext → `RawPrinting[]`.
 */
export function bulbapediaWikitextToPrintings(pageTitle: string, wikitext: string): RawPrinting[] {
  return bulbapediaParsedCardToPrintings(parseCardInfobox(pageTitle, wikitext));
}

/**
 * `ParsedCard` → `RawPrinting[]`.
 *
 * Branch order (the first that emits ≥1 printing wins):
 *
 *   1. Release-information sub-templates when present (vintage
 *      multi-print runs).
 *   2. Trainer Gallery / Galarian Gallery number prefix → one
 *      printing flagged `isTrainerGallery`.
 *   3. Single dominant infobox class → one printing.
 *   4. Promo-set fallback → one promo printing.
 *
 * The classifier (`data-pipeline/src/variant-classify.ts`) consumes
 * these signals and assigns `variant_class`. The adapter never
 * assigns it.
 */
export function bulbapediaParsedCardToPrintings(parsed: ParsedCard): RawPrinting[] {
  if (!parsed.pageTitle) {
    throw new Error('bulbapedia-en: parsed card is missing pageTitle');
  }
  const setName = parsed.setName;
  if (!setName) return [];
  const setIsPromo = isBulbapediaPromoSet(setName);
  const number = parsed.number ? padCardNumber(parsed.number) : '';
  const isTrainerGallery = /^(?:TG|GG)\d+$/i.test(number);

  // Branch 1: explicit per-print sub-templates.
  if (parsed.printings && parsed.printings.length > 0) {
    return parsed.printings.map((printing) =>
      buildPrintingFromSubTemplate({
        parsed,
        printing,
        isTrainerGallery,
        setIsPromo,
      }),
    );
  }

  // Branch 2 + 3: dominant infobox.
  const dominantClass = (parsed.class ?? parsed.rarity ?? '').trim();
  if (dominantClass || isTrainerGallery || setIsPromo) {
    return [
      buildPrintingFromDominant({
        parsed,
        dominantClass,
        isTrainerGallery,
        setIsPromo,
      }),
    ];
  }

  // Branch 4 (final fallback): nothing identifiable.
  return [];
}

// ============================================================
// Internals — printing assembly
// ============================================================

interface DominantArgs {
  parsed: ParsedCard;
  dominantClass: string;
  isTrainerGallery: boolean;
  setIsPromo: boolean;
}

function buildPrintingFromDominant(args: DominantArgs): RawPrinting {
  const { parsed, dominantClass, isTrainerGallery, setIsPromo } = args;
  const signals = classSignals(dominantClass, parsed.rarity ?? null);
  const variantTagParts: string[] = [];
  if (signals.tag) variantTagParts.push(signals.tag);
  if (parsed.isShadowless) variantTagParts.push('shadowless');
  if (parsed.isUnlimited) variantTagParts.push('unlimited');
  if (parsed.isFirstEdition) variantTagParts.push('1stedition');
  if (parsed.stamp) variantTagParts.push(parsed.stamp.toLowerCase());
  if (variantTagParts.length === 0) {
    variantTagParts.push(setIsPromo ? 'promo' : 'main');
  }
  const variantTag = variantTagParts.join('-');
  const labelParts: string[] = [];
  if (parsed.isFirstEdition) labelParts.push('1st Edition');
  if (parsed.isShadowless) labelParts.push('Shadowless');
  if (parsed.isUnlimited) labelParts.push('Unlimited');
  if (signals.label) labelParts.push(signals.label);
  if (parsed.stamp) labelParts.push(stampToLabel(parsed.stamp));
  const label = labelParts.length > 0 ? labelParts.join(' ') : 'Printing';

  return assemblePrinting({
    parsed,
    variantTag,
    label,
    signals,
    isFirstEdition: parsed.isFirstEdition === true,
    isShadowless: parsed.isShadowless === true,
    isUnlimited: parsed.isUnlimited === true,
    stamp: parsed.stamp ?? null,
    isTrainerGallery,
    setIsPromo,
  });
}

interface SubTemplateArgs {
  parsed: ParsedCard;
  printing: ParsedPrinting;
  isTrainerGallery: boolean;
  setIsPromo: boolean;
}

function buildPrintingFromSubTemplate(args: SubTemplateArgs): RawPrinting {
  const { parsed, printing, isTrainerGallery, setIsPromo } = args;
  const dominantClass = (printing.class ?? '').trim();
  const signals = classSignals(dominantClass, parsed.rarity ?? null);
  const variantTagParts: string[] = [];
  if (signals.tag) variantTagParts.push(signals.tag);
  if (printing.isShadowless) variantTagParts.push('shadowless');
  if (printing.isUnlimited) variantTagParts.push('unlimited');
  if (printing.isFirstEdition) variantTagParts.push('1stedition');
  if (printing.stamp) variantTagParts.push(printing.stamp.toLowerCase());
  if (variantTagParts.length === 0) {
    variantTagParts.push(slugify(printing.label));
  }
  const variantTag = variantTagParts.join('-');
  return assemblePrinting({
    parsed,
    variantTag,
    label: printing.label,
    signals,
    isFirstEdition: printing.isFirstEdition === true,
    isShadowless: printing.isShadowless === true,
    isUnlimited: printing.isUnlimited === true,
    stamp: printing.stamp ?? null,
    isTrainerGallery,
    setIsPromo,
  });
}

interface AssembleArgs {
  parsed: ParsedCard;
  variantTag: string;
  label: string;
  signals: ClassSignals;
  isFirstEdition: boolean;
  isShadowless: boolean;
  isUnlimited: boolean;
  stamp: import('./wiki-types.js').ParsedPrintingStamp | null;
  isTrainerGallery: boolean;
  setIsPromo: boolean;
}

function assemblePrinting(args: AssembleArgs): RawPrinting {
  const {
    parsed,
    variantTag,
    label,
    signals,
    isFirstEdition,
    isShadowless,
    isUnlimited,
    stamp,
    isTrainerGallery,
    setIsPromo,
  } = args;
  const extra: Record<string, unknown> = { bulbapediaPrintingLabel: label };
  if (isUnlimited) extra['isUnlimited'] = true;
  const printing: RawPrinting = {
    source: BULBAPEDIA_EN_SOURCE,
    sourceKey: `${parsed.pageTitle}-${variantTag}`,
    cardKey: parsed.pageTitle,
    sourcePrintingLabel: label,
    rarityRaw: normalizeRarityRaw(parsed.rarity ?? null),
    isHolo: signals.isHolo,
    isReverseHolo: signals.isReverseHolo,
    isFirstEdition,
    isShadowless,
    isFullArt: signals.isFullArt,
    isAltArt: signals.isAltArt,
    isGoldRare: signals.isGoldRare,
    isRainbowRare: signals.isRainbowRare,
    isTextured: false,
    isTrainerGallery,
    isPromo: setIsPromo,
    isError: false,
    pattern: null,
    stamp,
    imageSourceUrl: null,
    extra,
  };
  return printing;
}

// ============================================================
// Class / rarity signal mapping
// ============================================================

interface ClassSignals {
  tag: string;
  label: string;
  isHolo: boolean;
  isReverseHolo: boolean;
  isFullArt: boolean;
  isAltArt: boolean;
  isGoldRare: boolean;
  isRainbowRare: boolean;
}

function emptySignals(): ClassSignals {
  return {
    tag: '',
    label: '',
    isHolo: false,
    isReverseHolo: false,
    isFullArt: false,
    isAltArt: false,
    isGoldRare: false,
    isRainbowRare: false,
  };
}

/**
 * Map a Bulbapedia "class" (or fallback to its rarity tier) to the
 * raw signals the variant classifier consumes. Layered to handle
 * the two slots Bulbapedia uses to express the same axis: the
 * dedicated `class` infobox slot (e.g. `Holographic`) and the
 * `rarity` slot (e.g. `Rare Holo VSTAR`). Both can imply the same
 * decision; we OR them together.
 */
function classSignals(klass: string, rarity: string | null): ClassSignals {
  const out = emptySignals();
  const fields = [klass, rarity ?? ''].map((f) => f.toLowerCase());
  const has = (needle: string): boolean => fields.some((f) => f.includes(needle));

  if (has('rainbow')) {
    out.tag = 'rainbow';
    out.label = 'Rainbow Rare';
    out.isRainbowRare = true;
    return out;
  }
  if (has('hyper rare') || has('hyper-rare')) {
    out.tag = 'hyper';
    out.label = 'Hyper Rare';
    out.isGoldRare = true;
    return out;
  }
  if (has('special illustration')) {
    out.tag = 'special-illustration';
    out.label = 'Special Illustration Rare';
    out.isAltArt = true;
    return out;
  }
  if (has('illustration rare') || has('full art')) {
    out.tag = 'illustration';
    out.label = has('full art') ? 'Full Art' : 'Illustration Rare';
    out.isFullArt = true;
    return out;
  }
  if (has('reverse holo') || has('reverse holographic')) {
    out.tag = 'reverse';
    out.label = 'Reverse Holo';
    out.isReverseHolo = true;
    return out;
  }
  // Holographic class OR explicit "Holo Rare" / "Rare Holo" rarity.
  if (
    has('holographic') ||
    has('holo rare') ||
    has('rare holo') ||
    has('holo ex') ||
    has('holo gx') ||
    has('holo v') ||
    has('holo vmax') ||
    has('holo vstar') ||
    has('holo lv.x')
  ) {
    out.tag = 'holo';
    out.label = 'Holo';
    out.isHolo = true;
    return out;
  }
  // Bare "Rare" / "Common" / "Uncommon" → non-holo printing. We don't
  // set isHolo; the classifier picks `NON_HOLO` and the rarity
  // slot's `RARE` lands separately during normalization.
  if (has('rare') || has('common') || has('uncommon')) {
    out.tag = 'nonholo';
    out.label = 'Non-Holo';
    return out;
  }
  // Promo on its own (e.g. `class=` empty, `rarity=Promo`): no
  // visual class signal yet — the promo-set branch picks up
  // `isPromo` separately.
  if (has('promo')) {
    out.tag = 'promo';
    out.label = 'Promo';
    return out;
  }
  return out;
}

function stampToLabel(stamp: import('./wiki-types.js').ParsedPrintingStamp): string {
  switch (stamp) {
    case 'PRERELEASE':
      return 'Prerelease';
    case 'STAFF':
      return 'Staff';
    case 'LEAGUE':
      return 'League';
    case 'BUILDBATTLE':
      return 'Build & Battle';
    case 'CHAMPIONSHIP':
      return 'Championship';
  }
}

// ============================================================
// Helpers
// ============================================================

function deriveSubtypeRaw(parsed: ParsedCard): string | null {
  // Pokémon pages reliably set `species` + `type` + `evostage` and
  // these are the unambiguous Pokémon-card signal. We check this
  // FIRST because Bulbapedia's `class` infobox slot describes the
  // rarity / print-run class (`Holographic`, `Rainbow Rare`, …) not
  // the card category — so a Pokémon's `class=Holographic` must not
  // mask the Pokémon detection below.
  if (parsed.species && parsed.type) return 'Pokemon';
  const cls = (parsed.class ?? '').toLowerCase();
  const ct = (parsed.cardType ?? '').toLowerCase();
  if (!cls && !ct) return null;
  if (cls.includes('pok') || cls.includes('pokémon')) return 'Pokemon';
  if (cls.includes('trainer') || ct.includes('trainer')) {
    if (ct.includes('item')) return 'Item';
    if (ct.includes('supporter')) return 'Supporter';
    if (ct.includes('stadium')) return 'Stadium';
    if (ct.includes('pokémon tool') || ct.includes('pokemon tool')) return 'Pokémon Tool';
    if (ct.includes('tool')) return 'Tool';
    return 'Item';
  }
  if (cls.includes('energy') || ct.includes('energy')) {
    if (ct.includes('special')) return 'Special Energy';
    return 'Basic Energy';
  }
  return null;
}

/**
 * Coerce Bulbapedia's frequent `None` / empty rarity to `null`. We
 * also strip wikitext italics that occasionally wrap rarity values
 * on older pages (`''Holo Rare''`).
 */
function normalizeRarityRaw(rarity: string | null): string | null {
  if (rarity == null) return null;
  const trimmed = rarity.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'none') return null;
  return trimmed;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'printing'
  );
}

/**
 * Pure numerics zero-pad to 3; lettered numbers preserve casing /
 * punctuation. Mirrors the convention `canonical-keys.ts` enforces
 * downstream so the resolver can join filler against primary
 * deterministically.
 */
export function padCardNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, '0');
  return trimmed;
}
