// Typed `CardInfobox` parser. Reads the wikitext yielded by
// `parseTemplateBlocks` and returns a `ParsedCard` with normalized
// fields.
//
// The fields we read are documented on the elaborated task spec at
// `tasks/01-data-layer/T-DL-SOURCE-BULBAPEDIA.md` ("Bulbapedia Card
// page → RawCard"). Anything not listed is preserved on the
// underlying raw template but ignored by this typed view.

import {
  flattenWikitextValue,
  parseTemplateBlocks,
  stripWikitextLinks,
  unwrapWikitextItalics,
} from './wikitext-infobox.js';

import type { ParsedCard, ParsedPrinting, ParsedTemplateBlock } from '../wiki-types.js';

/** Names of the templates we treat as the dominant card infobox.
 *  Bulbapedia migrated `CardInfobox` → `TCGCardInfobox` over time; we
 *  accept both. */
const CARD_INFOBOX_NAMES = new Set(['CardInfobox', 'TCGCardInfobox']);

/** Names of templates we treat as per-print release-information rows.
 *  Bulbapedia uses a small family of these for vintage card pages. */
const PRINTING_TEMPLATE_NAMES = new Set([
  'CardPrintInfo',
  'PrintInfo',
  'TCGPrintInfo',
  'TCGCardPrintInfo',
  'CardPrint',
]);

/**
 * Parse a card page's wikitext into a `ParsedCard`. The
 * `pageTitle` is supplied separately because Bulbapedia's response
 * carries it on the page metadata, not the wikitext body.
 */
export function parseCardInfobox(pageTitle: string, wikitext: string): ParsedCard {
  const blocks = parseTemplateBlocks(wikitext);
  const infobox = blocks.find((b) => CARD_INFOBOX_NAMES.has(b.name));
  const printingBlocks = blocks.filter((b) => PRINTING_TEMPLATE_NAMES.has(b.name));

  const out: ParsedCard = { pageTitle };

  if (infobox) {
    const p = infobox.params;
    const name = pickFlat(p, 'cardname', 'name');
    if (name) out.name = name;
    const setName = pickFlat(p, 'expansion', 'setname', 'set');
    if (setName) out.setName = setName;
    const cardno = pickFlat(p, 'cardno', 'cardnumber');
    if (cardno) {
      out.cardnoRaw = cardno;
      const num = extractNumberToken(cardno);
      if (num) out.number = num;
    }
    const type = pickFlat(p, 'type');
    if (type) out.type = expandTypeAbbreviation(type);
    const hp = parseIntStrict(pickFlat(p, 'hp'));
    if (hp != null) out.hp = hp;
    const retreat = parseRetreat(pickFlat(p, 'retreatcost', 'retreat'));
    if (retreat != null) out.retreatCost = retreat;
    const illus = pickIllustrator(p);
    if (illus) out.illustrator = illus;
    const rarity = pickFlat(p, 'rarity');
    if (rarity) out.rarity = rarity;
    const cls = pickFlat(p, 'class');
    if (cls) out.class = cls;
    const cardType = pickFlat(p, 'cardtype', 'subclass', 'kind');
    if (cardType) out.cardType = cardType;
    const species = pickFlat(p, 'species');
    if (species) out.species = species;
    const evostage = pickFlat(p, 'evostage', 'stage');
    if (evostage) out.evostage = evostage;
    const evoFrom = pickFlat(p, 'evoname', 'evos', 'evoFrom', 'prevo');
    if (evoFrom) out.evolveFrom = evoFrom;
    const reg = pickFlat(p, 'regulationmark', 'regulation');
    if (reg) out.regulationMark = reg.toUpperCase();
    const jname = pickFlat(p, 'jname', 'jpname');
    if (jname) out.japaneseName = jname;
    if (parseYesNo(p['1stEdition'] ?? p['firstedition']) === true) out.isFirstEdition = true;
    if (parseYesNo(p['shadowless']) === true) out.isShadowless = true;
    if (parseYesNo(p['unlimited']) === true) out.isUnlimited = true;
    const stamp = parseStamp(pickFlat(p, 'stamp'));
    if (stamp) out.stamp = stamp;
  }

  if (printingBlocks.length > 0) {
    const printings = printingBlocks
      .map((b) => parsePrintingBlock(b))
      .filter((x): x is ParsedPrinting => x != null);
    if (printings.length > 0) out.printings = printings;
  }

  return out;
}

// ============================================================
// Per-print template parsing
// ============================================================

function parsePrintingBlock(block: ParsedTemplateBlock): ParsedPrinting | null {
  const p = block.params;
  // Each printing must carry SOMETHING that distinguishes it.
  const label = pickFlat(p, 'label', 'name', '1');
  const cls = pickFlat(p, 'class', 'type');
  if (!label && !cls) return null;
  const out: ParsedPrinting = {
    label: label ?? cls ?? 'Unlabeled',
  };
  if (cls) out.class = cls;
  if (parseYesNo(p['1stEdition'] ?? p['firstedition']) === true) out.isFirstEdition = true;
  if (parseYesNo(p['shadowless']) === true) out.isShadowless = true;
  if (parseYesNo(p['unlimited']) === true) out.isUnlimited = true;
  const stamp = parseStamp(pickFlat(p, 'stamp'));
  if (stamp) out.stamp = stamp;
  // Some templates encode the variant via the label string instead
  // of dedicated yes/no params; harvest from the label too.
  const lc = (label ?? '').toLowerCase();
  if (!out.isFirstEdition && lc.includes('1st edition')) out.isFirstEdition = true;
  if (!out.isShadowless && lc.includes('shadowless')) out.isShadowless = true;
  if (!out.isUnlimited && lc.includes('unlimited')) out.isUnlimited = true;
  if (!out.stamp) {
    const labelStamp = parseStamp(label ?? '');
    if (labelStamp) out.stamp = labelStamp;
  }
  return out;
}

// ============================================================
// Helpers
// ============================================================

function pickFlat(p: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const raw = p[k];
    if (raw == null) continue;
    const flat = flattenWikitextValue(raw);
    if (flat) return flat;
  }
  return undefined;
}

function pickIllustrator(p: Record<string, string>): string | undefined {
  // Modern infoboxes use `illus`. Older infoboxes leave the slot
  // empty and put the illustrator in `caption` as
  // `Illus. [[Mitsuhiro Arita]]`.
  const direct = pickFlat(p, 'illus', 'illustrator');
  if (direct) return direct;
  const captionRaw = p['caption'];
  if (!captionRaw) return undefined;
  // Strip italics/links first so the prefix matches reliably.
  const flat = flattenWikitextValue(captionRaw);
  const match = /illus\.?\s+(.+)$/i.exec(flat);
  if (match && match[1]) return match[1].trim();
  return undefined;
}

function parseIntStrict(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/^-?\d+/);
  if (!m) return undefined;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseRetreat(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '-' || trimmed === '—' || trimmed === '–') return 0;
  return parseIntStrict(trimmed);
}

function parseYesNo(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const v = stripWikitextLinks(unwrapWikitextItalics(value)).trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'yes' || v === 'true' || v === '1' || v === 'y') return true;
  if (v === 'no' || v === 'false' || v === '0' || v === 'n') return false;
  return undefined;
}

function parseStamp(
  value: string | undefined,
): import('../wiki-types.js').ParsedPrintingStamp | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v.includes('prerelease')) return 'PRERELEASE';
  if (v.includes('staff')) return 'STAFF';
  if (v.includes('build') && v.includes('battle')) return 'BUILDBATTLE';
  if (v.includes('build-and-battle') || v.includes('build & battle')) return 'BUILDBATTLE';
  if (v.includes('league')) return 'LEAGUE';
  if (v.includes('championship')) return 'CHAMPIONSHIP';
  return undefined;
}

/**
 * Pull the leading numeric / lettered token off a `cardno` value
 * shaped `4/102`, `TG01/TG30`, or `SWSH285`. Bulbapedia consistently
 * uses `numerator/denominator` for numbered cards and bare tokens
 * for promos; we keep just the numerator.
 */
export function extractNumberToken(cardno: string): string | undefined {
  const trimmed = cardno.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf('/');
  const head = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const cleaned = head.trim();
  if (!cleaned) return undefined;
  return cleaned;
}

/**
 * Bulbapedia infoboxes sometimes use single-letter type abbreviations
 * (matching the energy-symbol templates). Expand them so the
 * downstream `normalizePokemonType` can map the value to the
 * canonical enum. Already-spelled-out values pass through.
 */
function expandTypeAbbreviation(value: string): string {
  const v = value.trim();
  switch (v.toUpperCase()) {
    case 'G':
      return 'Grass';
    case 'R':
      return 'Fire';
    case 'W':
      return 'Water';
    case 'L':
      return 'Lightning';
    case 'P':
      return 'Psychic';
    case 'F':
      return 'Fighting';
    case 'D':
      return 'Darkness';
    case 'M':
      return 'Metal';
    case 'Y':
      return 'Fairy';
    case 'N':
      return 'Dragon';
    case 'C':
      return 'Colorless';
    default:
      return v;
  }
}
