// Catalog joiner. Maps a `ParsedListing` to a `(card_id,
// printing_id)` tuple via canonical-key lookup against the catalog
// the resolver materialised in `card`, `printing`, `set`.
//
// The joiner is **DB-shape-agnostic** — it consumes a small reader
// interface (`ParserCatalogReader`) so it can be tested against
// synthetic in-memory fixtures and wired up against `@binderly/db`
// in downstream pricing tasks (T-DL-PRICING-EBAY-BROWSE,
// T-DL-PRICING-AGGREGATOR). Tests in `joiner.test.ts` use the
// in-memory variant.
//
// Algorithm:
//   1. Refuse lots — `isLot=true` returns `(null, null, 0)`.
//   2. Build a canonical card key when set + number are both
//      present. Lookup via `findCardByCanonicalKey`.
//   3. Fallback to name + set lookup via `findCardsByNameAndSetCode`.
//   4. Once a card is resolved, narrow printings via
//      `findPrintingsByCardId` + variant-hint scoring.
//   5. Confidence = parsed × join-quality factor.

import { canonicalCardKey, canonicalSetKey } from '../../canonical-keys.js';

import type { ParsedListing, VariantHints } from './types.js';

/**
 * Minimal card reader the joiner needs. The shapes match what
 * downstream tasks will derive from `@binderly/db` queries (drizzle
 * `db.query.cardTable.findFirst({...})`).
 */
export interface ParserCatalogCard {
  readonly id: string;
  readonly canonicalKey: string;
  readonly setCanonicalKey: string;
  readonly name: string;
}

export interface ParserCatalogPrinting {
  readonly id: string;
  readonly variantKey: string;
  readonly cardId: string;
  readonly variantClass: string;
  readonly variantFlags: readonly string[];
}

export interface ParserCatalogReader {
  /** Direct canonical-key lookup. Returns null on miss. */
  findCardByCanonicalKey(canonicalKey: string): Promise<ParserCatalogCard | null>;
  /**
   * Name-fallback lookup. The `nameLike` is the parsed nameHint
   * (lowercased, no punctuation); the implementation can use a
   * trigram / ILIKE strategy. `setCanonicalKey` is the pre-built
   * `{language}-{setCode}` key when known, else null.
   */
  findCardsByNameAndSetCode(args: {
    nameLike: string;
    setCanonicalKey: string | null;
    limit?: number;
  }): Promise<readonly ParserCatalogCard[]>;
  /** Return every printing belonging to the given card. */
  findPrintingsByCardId(cardId: string): Promise<readonly ParserCatalogPrinting[]>;
}

export interface JoinerResult {
  readonly cardId: string | null;
  readonly printingId: string | null;
  /**
   * 0..1. Multiplies `parsed.confidenceScore` by a join-quality
   * factor (1.0 canonical-key hit, 0.6 name-fallback hit, 0.3 card
   * resolved but no variant match, 0 lot or no resolution).
   */
  readonly confidence: number;
}

/**
 * Score a printing against the parser's variant hints. Higher is
 * better. The score covers `variant_class` matches and
 * `variant_flags` overlap; ties broken by ranks declared inline.
 */
function scorePrintingAgainstHints(printing: ParserCatalogPrinting, hints: VariantHints): number {
  let score = 0;
  // Class scoring — listing variant hints map onto class labels in
  // `tcg-domain.md` § 1.
  if (hints.isAltArt && printing.variantClass === 'ALT_ART') score += 4;
  if (hints.isFullArt && printing.variantClass === 'FULL_ART') score += 4;
  if (hints.isReverseHolo && printing.variantClass === 'REVERSE_HOLO') score += 4;
  if (hints.isHolo === true && printing.variantClass === 'HOLO') score += 3;
  if (hints.isRainbow && printing.variantClass === 'RAINBOW') score += 4;
  if (hints.isGold && printing.variantClass === 'GOLD') score += 4;
  if (hints.isSecretRare && printing.variantClass === 'SECRET_RARE') score += 4;
  if (hints.isPromo && printing.variantClass === 'PROMO') score += 4;
  // Class fallback — when no variant-hint asserted, prefer NON_HOLO
  // / HOLO over the more exotic classes.
  if (!hints.isHolo && !hints.isReverseHolo && !hints.isFullArt && !hints.isAltArt) {
    if (printing.variantClass === 'NON_HOLO' || printing.variantClass === 'HOLO') {
      score += 1;
    }
  }
  // Flag scoring — orthogonal modifiers stack. We REWARD asserted
  // matches and PENALIZE flags the printing carries that the
  // listing didn't claim (otherwise a "Holo Charizard" listing
  // ties between the unlimited Holo printing and the 1st-Ed
  // Shadowless Holo printing — the latter is more specific and
  // should lose when the listing doesn't assert FIRST_EDITION).
  const flags = new Set(printing.variantFlags);
  const FLAG_BINDINGS: ReadonlyArray<readonly [keyof VariantHints, string, number]> = [
    ['isFirstEdition', 'FIRST_EDITION', 2],
    ['isShadowless', 'SHADOWLESS', 2],
    ['isPokeBallPattern', 'POKE_BALL_PATTERN', 3],
    ['isMasterBallPattern', 'MASTER_BALL_PATTERN', 3],
    ['isStaff', 'STAMPED_STAFF', 2],
    ['isPrerelease', 'STAMPED_PRERELEASE', 2],
  ];
  for (const [hintKey, flagName, reward] of FLAG_BINDINGS) {
    const hintAsserted = hints[hintKey] === true;
    const flagPresent = flags.has(flagName);
    if (hintAsserted && flagPresent) score += reward;
    else if (!hintAsserted && flagPresent) score -= 1;
  }
  return score;
}

/**
 * Resolve a `ParsedListing` against the catalog reader. Returns the
 * matched `(cardId, printingId)` and a join-quality-adjusted
 * confidence score.
 */
export async function resolveListingToPrinting(
  parsed: ParsedListing,
  reader: ParserCatalogReader,
): Promise<JoinerResult> {
  if (parsed.isLot) {
    return { cardId: null, printingId: null, confidence: 0 };
  }

  // Try canonical-key lookup first.
  const language = parsed.language === 'jp' ? 'jp' : 'en';
  const setCode = parsed.set.codeHint;
  let card: ParserCatalogCard | null = null;
  let joinQuality = 0;

  if (setCode != null && parsed.card.numberHint != null) {
    const setKey = canonicalSetKey({ language, code: setCode });
    const cardKey = canonicalCardKey({ number: parsed.card.numberHint }, { canonicalKey: setKey });
    card = await reader.findCardByCanonicalKey(cardKey);
    if (card != null) joinQuality = 1.0;
  }

  // Fallback: name + set name lookup.
  if (card == null && parsed.card.nameHint != null) {
    const setKey = setCode != null ? canonicalSetKey({ language, code: setCode }) : null;
    const candidates = await reader.findCardsByNameAndSetCode({
      nameLike: parsed.card.nameHint,
      setCanonicalKey: setKey,
      limit: 5,
    });
    if (candidates.length > 0) {
      card = candidates[0]!;
      joinQuality = setKey != null ? 0.6 : 0.4;
    }
  }

  if (card == null) {
    return { cardId: null, printingId: null, confidence: 0 };
  }

  // Narrow printings by variant hints.
  const printings = await reader.findPrintingsByCardId(card.id);
  if (printings.length === 0) {
    return {
      cardId: card.id,
      printingId: null,
      confidence: parsed.confidenceScore * 0.3,
    };
  }
  let bestPrinting: ParserCatalogPrinting = printings[0]!;
  let bestScore = scorePrintingAgainstHints(bestPrinting, parsed.variantHints);
  for (let i = 1; i < printings.length; i++) {
    const p = printings[i]!;
    const s = scorePrintingAgainstHints(p, parsed.variantHints);
    if (s > bestScore) {
      bestPrinting = p;
      bestScore = s;
    }
  }
  // If no printing scored above zero, we still pick one but signal
  // a lower join quality — the catalog had printings but none
  // matched any hint.
  if (bestScore === 0) {
    joinQuality = Math.min(joinQuality, 0.3);
  }

  return {
    cardId: card.id,
    printingId: bestPrinting.id,
    confidence: clamp01(parsed.confidenceScore * joinQuality),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 100) / 100;
}
