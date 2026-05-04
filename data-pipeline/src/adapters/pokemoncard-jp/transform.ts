// Pure transforms: Pokemon-Card.com HTML → `PokemonCardJp{Set,Card}`
// → `Raw{Set,Card,Printing}`. Zero side effects, no HTTP, no
// globals. Tested against captured HTML fixtures.
//
// The transform is split into two stages:
//
//   1. HTML → parsed struct (`pokemonCardJpHtmlToSet` /
//      `pokemonCardJpHtmlToCard`). Uses the regex helpers in
//      `parsers.ts`. Returns `null` when the page indicates "card
//      not found".
//   2. Parsed struct → `Raw*` (`pokemonCardJpSetToRaw` /
//      `pokemonCardJpCardToRaw` / `pokemonCardJpCardToPrintings`).
//      Pure mappers; the adapter calls these after fetching.
//
// References:
//   - `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-JP.md` § "Pokemon-Card.com"
//     for the URL shape, mapping tables, and matcher.
//   - `data-pipeline/src/types.ts` — `Raw*` zod schemas.
//   - `data-pipeline/src/variant-classify.ts` — consumes the
//     `RawPrinting` signals we emit.

import {
  type PokemonCardJpCard,
  type PokemonCardJpRarityLabel,
  type PokemonCardJpSet,
} from './api-types.js';
import {
  absolutizeUrl,
  cleanText,
  convertJaDateToISO,
  decodeHtmlEntities,
  extractAttr,
  extractByDtDd,
  extractTextContent,
  looksLikeNotFoundCardBody,
  parseCardNumber,
  parseRarityGlyph,
} from './parsers.js';
import { pcjpToTcgdexSetCode } from './set-aliases.js';
import { isTcgdexPromoSet } from '../tcgdex-en/promo-sets.js';

import type { RawCard, RawPrinting, RawSet } from '../../types.js';

export const POKEMONCARD_JP_SOURCE = 'pokemoncard-jp' as const;

/** Origin used when resolving relative URLs in the page. */
export const POKEMONCARD_JP_ORIGIN = 'https://www.pokemon-card.com' as const;

// ============================================================
// Stage 1: HTML → parsed struct
// ============================================================

/**
 * Parse a Pokemon-Card.com expansion landing page. Returns `null`
 * when the page lacks the expected expansion header — the adapter
 * treats this as "set not found" semantics.
 *
 * `pcjpSetId` is provided by the caller (it lives in the URL the
 * caller fetched, not the response body).
 */
export function pokemonCardJpHtmlToSet(
  html: string,
  args: { pcjpSetId: string },
): PokemonCardJpSet | null {
  const name =
    extractTextContent(html, /<h2[^>]*class="[^"]*expansionName[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ??
    extractTextContent(html, /<h1[^>]*class="[^"]*expansionName[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!name) return null;

  const shortCode =
    extractTextContent(
      html,
      /<span[^>]*class="[^"]*expansionShortCode[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ) ??
    extractByDtDd(html, '略号') ??
    '';

  const releaseDateRaw = extractByDtDd(html, '発売日');
  const releaseDate = convertJaDateToISO(releaseDateRaw);
  if (!releaseDate) return null;

  const seriesRaw = extractByDtDd(html, 'シリーズ');
  const series = seriesRaw && seriesRaw.length > 0 ? seriesRaw : null;

  const logoUrl = absolutizeUrl(
    extractAttr(html, /<img[^>]*class="[^"]*expansion-logo[^"]*"[^>]*>/i, 'src'),
    POKEMONCARD_JP_ORIGIN,
  );
  const symbolUrl = absolutizeUrl(
    extractAttr(html, /<img[^>]*class="[^"]*expansion-symbol[^"]*"[^>]*>/i, 'src'),
    POKEMONCARD_JP_ORIGIN,
  );

  return {
    pcjpSetId: args.pcjpSetId,
    shortCode: shortCode.trim(),
    name,
    series,
    releaseDate,
    logoUrl,
    symbolUrl,
  };
}

/**
 * Parse a Pokemon-Card.com card detail page. Returns `null` when the
 * page renders the "card not found" body shape — the adapter
 * surfaces this as `NotFoundError` upstream.
 */
export function pokemonCardJpHtmlToCard(
  html: string,
  args: { pcjpCardId: string },
): PokemonCardJpCard | null {
  if (looksLikeNotFoundCardBody(html)) return null;

  const name =
    extractTextContent(
      html,
      /<h1[^>]*class="[^"]*pageHeader[^"]*cardDetail[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
    ) ?? extractTextContent(html, /<h1[^>]*class="[^"]*cardDetail[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!name) return null;

  const shortCode =
    extractTextContent(
      html,
      /<span[^>]*class="[^"]*expansionShortCode[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ) ??
    extractByDtDd(html, '略号') ??
    '';

  const numberRaw = extractByDtDd(html, 'カード番号');
  const number = parseCardNumber(numberRaw);
  if (!number) return null;

  const hpStr = extractTextContent(
    html,
    /<span[^>]*class="[^"]*hp-num[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  );
  const hp = hpStr ? toIntOrNull(hpStr) : null;

  const illustrator = extractByDtDd(html, 'イラストレーター');
  const flavorText = extractByDtDd(html, 'ポケモンずかんから');

  const typeAlt = extractAttr(html, /<img[^>]*class="[^"]*icon-pokemon-type[^"]*"[^>]*>/i, 'alt');
  const type = typeAlt ? mapJaTypeAltToTcgdex(typeAlt) : null;

  const trainerType = extractByDtDd(html, 'トレーナーズ');
  const energyType = extractByDtDd(html, 'エネルギー');
  const subtype = deriveSubtype({ hp, trainerType, energyType });

  const weakness = parseTypeValuePair(extractByDtDd(html, '弱点'));
  const resistance = parseTypeValuePair(extractByDtDd(html, '抵抗力'));
  const retreatCost = parseRetreatCost(extractByDtDd(html, 'にげる'));

  const rarityGlyph = extractTextContent(
    html,
    /<span[^>]*class="[^"]*rarity[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  );
  const parsed = parseRarityGlyph(rarityGlyph);
  const rarityLabel: PokemonCardJpRarityLabel | null = parsed?.label ?? null;
  const rarityGlyphRaw = parsed?.glyph ?? rarityGlyph?.trim() ?? null;

  const imageUrl = absolutizeUrl(
    extractAttr(html, /<img[^>]*class="[^"]*card-image[^"]*"[^>]*>/i, 'src'),
    POKEMONCARD_JP_ORIGIN,
  );

  return {
    pcjpCardId: args.pcjpCardId,
    shortCode: shortCode.trim(),
    number,
    name,
    type,
    subtype,
    hp,
    illustrator,
    flavorText,
    weakness,
    resistance,
    retreatCost,
    rarityLabel,
    rarityGlyph: rarityGlyphRaw,
    imageUrl,
  };
}

// ============================================================
// Stage 2: parsed struct → Raw*
// ============================================================

export function pokemonCardJpSetToRaw(set: PokemonCardJpSet): RawSet {
  if (!set.pcjpSetId) {
    throw new Error('pokemoncard-jp: set is missing required field `pcjpSetId`');
  }
  if (!set.name) {
    throw new Error(`pokemoncard-jp: set ${set.pcjpSetId} is missing required field \`name\``);
  }
  if (!set.releaseDate) {
    throw new Error(
      `pokemoncard-jp: set ${set.pcjpSetId} is missing required field \`releaseDate\``,
    );
  }

  // Prefer the matched TCGdex JP code (so canonical-key joins line
  // up); fall back to the lowercased on-page short code.
  const matchedCode = pcjpToTcgdexSetCode(set.shortCode);
  const code = matchedCode ?? set.shortCode.toLowerCase() ?? set.pcjpSetId;
  if (!code) {
    throw new Error(
      `pokemoncard-jp: set ${set.pcjpSetId} has no resolvable code (shortCode=${JSON.stringify(set.shortCode)})`,
    );
  }

  const extra: Record<string, unknown> = {
    pcjpSetId: set.pcjpSetId,
    shortCode: set.shortCode,
  };

  const raw: RawSet = {
    source: POKEMONCARD_JP_SOURCE,
    sourceKey: set.pcjpSetId,
    code,
    language: 'jp',
    name: set.name,
    series: set.series,
    releaseDate: set.releaseDate,
    printedTotal: null,
    total: null,
    logoUrl: set.logoUrl,
    symbolUrl: set.symbolUrl,
    extra,
  };
  return raw;
}

export function pokemonCardJpCardToRaw(card: PokemonCardJpCard): RawCard {
  if (!card.pcjpCardId) {
    throw new Error('pokemoncard-jp: card is missing required field `pcjpCardId`');
  }
  if (!card.name) {
    throw new Error(`pokemoncard-jp: card ${card.pcjpCardId} is missing required field \`name\``);
  }
  if (!card.number) {
    throw new Error(`pokemoncard-jp: card ${card.pcjpCardId} is missing required field \`number\``);
  }

  const matchedCode = pcjpToTcgdexSetCode(card.shortCode);
  const setCode = matchedCode ?? card.shortCode.toLowerCase();
  if (!setCode) {
    throw new Error(
      `pokemoncard-jp: card ${card.pcjpCardId} has no resolvable setCode (shortCode=${JSON.stringify(card.shortCode)})`,
    );
  }

  const extra: Record<string, unknown> = {
    pcjpCardId: card.pcjpCardId,
    shortCode: card.shortCode,
  };
  if (card.imageUrl) extra['imageUrl'] = card.imageUrl;
  if (card.rarityGlyph) extra['rarityGlyph'] = card.rarityGlyph;

  const raw: RawCard = {
    source: POKEMONCARD_JP_SOURCE,
    sourceKey: card.pcjpCardId,
    setCode,
    language: 'jp',
    number: card.number,
    name: card.name,
    nameLocalized: null,
    typeRaw: card.type,
    subtypeRaw: card.subtype,
    hp: card.hp,
    illustrator: card.illustrator,
    flavorText: card.flavorText,
    attacks: null,
    weakness: card.weakness ? [...card.weakness] : null,
    resistance: card.resistance ? [...card.resistance] : null,
    retreatCost: card.retreatCost,
    rarityRaw: card.rarityLabel,
    extra,
  };
  return raw;
}

/**
 * Pokemon-Card.com renders one detail page per distinct printing —
 * separate `pcjpCardId`s for the AR / SAR / SR / HR variants of the
 * same card. So we emit exactly ONE printing per parsed card.
 *
 * The adapter never assigns `variant_class`. Raw signals derived
 * from the rarity label feed `classifyVariant` downstream:
 *   - `Art Rare` / `Illustration Rare`        → `isFullArt`
 *   - `Special Art Rare` / `Special Illustration Rare` → `isAltArt`
 *   - `Hyper Rare`                            → `isGoldRare`
 *   - `Super Rare` / `Ultra Rare` / `Double Rare` /
 *     `Shiny Rare` / `Shiny Super Rare` /
 *     `Character Rare` / `Character Super Rare` → `isHolo`
 *   - `Promo`                                  → `isPromo` (and the
 *      classifier hits `PROMO`).
 *
 * Reverse-holo / pattern / first-edition / shadowless are **not**
 * surfaced by Pokemon-Card.com; the filler doesn't claim them.
 */
export function pokemonCardJpCardToPrintings(card: PokemonCardJpCard): RawPrinting[] {
  if (!card.pcjpCardId) {
    throw new Error('pokemoncard-jp: card is missing required field `pcjpCardId`');
  }

  const matchedSetCode = pcjpToTcgdexSetCode(card.shortCode);
  const fallbackSetCode = matchedSetCode ?? card.shortCode.toLowerCase();
  const setLooksPromo =
    matchedSetCode != null ? isTcgdexPromoSet(matchedSetCode) : isTcgdexPromoSet(fallbackSetCode);

  const tag = (card.rarityGlyph ?? 'main').toLowerCase().replace(/[^a-z0-9]/g, '') || 'main';
  const label = card.rarityLabel ?? 'Main Print';

  const isFullArt = card.rarityLabel === 'Art Rare' || card.rarityLabel === 'Illustration Rare';
  const isAltArt =
    card.rarityLabel === 'Special Art Rare' || card.rarityLabel === 'Special Illustration Rare';
  const isGoldRare = card.rarityLabel === 'Hyper Rare';
  const isPromoRarity = card.rarityLabel === 'Promo';
  const isHoloByRarity = isHoloRarityLabel(card.rarityLabel);
  const isTrainerGallery = /^(?:TG|GG)\d+$/i.test(card.number.trim());

  const extra: Record<string, unknown> = {
    pcjpCardId: card.pcjpCardId,
    shortCode: card.shortCode,
  };
  if (card.rarityGlyph) extra['rarityGlyph'] = card.rarityGlyph;

  const printing: RawPrinting = {
    source: POKEMONCARD_JP_SOURCE,
    sourceKey: `${card.pcjpCardId}-${tag}`,
    cardKey: card.pcjpCardId,
    sourcePrintingLabel: label,
    rarityRaw: card.rarityLabel,
    isHolo: isHoloByRarity,
    isReverseHolo: false,
    isFirstEdition: false,
    isShadowless: false,
    isFullArt,
    isAltArt,
    isGoldRare,
    isRainbowRare: false,
    isTextured: false,
    isTrainerGallery,
    isPromo: setLooksPromo || isPromoRarity,
    isError: false,
    pattern: null,
    stamp: null,
    imageSourceUrl: card.imageUrl,
    extra,
  };
  return [printing];
}

// ============================================================
// Helpers
// ============================================================

function isHoloRarityLabel(label: PokemonCardJpRarityLabel | null): boolean {
  if (label == null) return false;
  switch (label) {
    case 'Common':
    case 'Uncommon':
      return false;
    case 'Rare':
      // Plain "R" Pokémon in modern Japanese sets are visually
      // holographic on Pokémon (non-trainer); we conservatively
      // record `false` here and let the resolver pick up holo
      // signals from the primary (TCGdex JP) when they disagree.
      return false;
    case 'Promo':
      return false;
    default:
      // `Double Rare`, `Super Rare`, `Ultra Rare`, `Hyper Rare`,
      // `Art Rare`, `Special Art Rare`, `Illustration Rare`,
      // `Special Illustration Rare`, `Shiny Rare`,
      // `Shiny Super Rare`, `Character Rare`,
      // `Character Super Rare` are all visually holographic.
      return true;
  }
}

function deriveSubtype(args: {
  hp: number | null;
  trainerType: string | null;
  energyType: string | null;
}): string | null {
  if (args.hp != null) return 'Pokemon';
  if (args.trainerType) {
    const t = args.trainerType.trim();
    if (t.includes('グッズ') || t.includes('Item')) return 'Item';
    if (t.includes('サポート') || t.includes('Supporter')) return 'Supporter';
    if (t.includes('スタジアム') || t.includes('Stadium')) return 'Stadium';
    if (t.includes('ポケモンのどうぐ') || t.includes('Tool')) return 'Tool';
    return t;
  }
  if (args.energyType) {
    const e = args.energyType.trim();
    if (e.includes('特殊') || e.toLowerCase().includes('special')) return 'Special Energy';
    return 'Basic Energy';
  }
  return null;
}

function parseTypeValuePair(
  raw: string | null,
): ReadonlyArray<{ type: string; value: string }> | null {
  if (!raw) return null;
  // Pokemon-Card.com renders weakness as e.g. "炎×2" or "草+30".
  const m = /^([^\d×+-]+?)\s*([×+-]\s*\d+)\s*$/.exec(raw.trim());
  if (!m || m[1] == null || m[2] == null) return null;
  const type = mapJaTypeNameToTcgdex(m[1].trim());
  const value = m[2].replace(/\s+/g, '');
  return [{ type, value }];
}

function parseRetreatCost(raw: string | null): number | null {
  if (!raw) return null;
  // The retreat cell renders one `<img>` per energy; the parsers
  // helper has stripped tags, leaving us with a numeric string OR
  // a pile of energy unicode like "★★" — but Pokemon-Card.com
  // usually surfaces the count as a number after the tag-stripped
  // run. Try both shapes.
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  // Count whitespace-separated tokens as a proxy for icon count.
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  return parts.length;
}

function toIntOrNull(s: string): number | null {
  const m = /(\d+)/.exec(s);
  if (!m || m[1] == null) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

const JA_TYPE_TO_TCGDEX: Readonly<Record<string, string>> = {
  草: 'Grass',
  炎: 'Fire',
  水: 'Water',
  雷: 'Lightning',
  超: 'Psychic',
  闘: 'Fighting',
  悪: 'Darkness',
  鋼: 'Metal',
  フェアリー: 'Fairy',
  ドラゴン: 'Dragon',
  無色: 'Colorless',
};

function mapJaTypeAltToTcgdex(alt: string): string | null {
  const trimmed = decodeHtmlEntities(alt).trim();
  if (!trimmed) return null;
  if (Object.prototype.hasOwnProperty.call(JA_TYPE_TO_TCGDEX, trimmed)) {
    return JA_TYPE_TO_TCGDEX[trimmed] ?? null;
  }
  // Fall back: many alts spell the type in English already on
  // Pokemon-Card.com.
  return trimmed;
}

function mapJaTypeNameToTcgdex(name: string): string {
  const trimmed = cleanText(name);
  if (Object.prototype.hasOwnProperty.call(JA_TYPE_TO_TCGDEX, trimmed)) {
    return JA_TYPE_TO_TCGDEX[trimmed] ?? trimmed;
  }
  return trimmed;
}
