// Card-name hint extraction.
//
// Strategy:
//   1. Scan the working string for any species name from
//      `POKEMON_NAME_DICT`. Longest match wins. This is the
//      high-confidence path — every Pokémon name is a strong
//      anchor.
//   2. Fall back to the longest contiguous run of letter-only
//      tokens (after stop-word removal) — handles Trainer cards
//      ("Professor's Research", "Boss's Orders") and uncommon
//      species the dictionary doesn't carry.
//
// Stop words filter out "pokemon", "card", "tcg", year tokens, and
// common listing-chrome words ("nm", "lp" — the condition pass takes
// these but only on raw cards; we still want to drop them from
// name-fallback in case the condition pass didn't fire). The list
// is short and documented.

import { POKEMON_NAME_DICT } from './pokemon-name-dict.js';

export interface NameMatch {
  readonly cardName: string | null;
  readonly remaining: string;
  readonly signals: readonly string[];
  /** `true` when `cardName` came from the species dictionary. */
  readonly fromDictionary: boolean;
}

const STOP_WORDS = new Set([
  'pokemon',
  'pokémon',
  'tcg',
  'card',
  'cards',
  'mint',
  'nm',
  'lp',
  'mp',
  'hp',
  'condition',
  'rare',
  'common',
  'uncommon',
  'holo',
  'psa',
  'bgs',
  'cgc',
  'sgc',
  'ace',
  'ags',
  'gem',
  'graded',
  'slab',
  'rare',
  'and',
  'or',
  'the',
  'of',
  'set',
  'collection',
  'lot',
  'with',
  'a',
  'an',
  'new',
  'used',
  'authentic',
  'official',
  'genuine',
  'free',
  'shipping',
  'us',
  'usa',
  'eng',
  'english',
  'japanese',
  'jp',
  'jpn',
  'edition',
  '1st',
  'first',
  'reverse',
  'shadowless',
  'unlimited',
  'promo',
  'rainbow',
  'gold',
  'secret',
  'art',
  'alt',
  'full',
  'fa',
  'aa',
  'sir',
  'staff',
  'pre',
  'release',
  'prerelease',
  'pristine',
  'black',
  'label',
  'rare',
  'foil',
]);

const YEAR_RE = /^(?:19|20)\d{2}$/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

function tryDictionaryMatch(working: string): {
  readonly name: string | null;
  readonly remaining: string;
} {
  let bestName: string | null = null;
  let bestIndex = 0;
  let bestLen = 0;
  for (const name of POKEMON_NAME_DICT) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`);
    const m = re.exec(working);
    if (!m || m.index === undefined) continue;
    if (m[0].length > bestLen) {
      bestName = name;
      bestIndex = m.index;
      bestLen = m[0].length;
    }
  }
  if (bestName == null) return { name: null, remaining: working };
  return {
    name: bestName,
    remaining: redactRange(working, bestIndex, bestIndex + bestLen),
  };
}

function tryFallbackMatch(working: string): {
  readonly name: string | null;
  readonly remaining: string;
} {
  // Split on whitespace and filter out stop-word / number / single-
  // char tokens, then collect the longest contiguous run of
  // letter-only tokens.
  const tokens = working.split(/\s+/).filter((t) => t.length > 0);
  let bestRun: string[] = [];
  let currentRun: string[] = [];
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    const looksLikeWord = /^[a-z][a-z'-]*$/i.test(tok) && tok.length >= 2;
    const isStop = STOP_WORDS.has(lower) || YEAR_RE.test(tok);
    if (looksLikeWord && !isStop) {
      currentRun.push(tok);
    } else {
      if (currentRun.length > bestRun.length) bestRun = currentRun;
      currentRun = [];
    }
  }
  if (currentRun.length > bestRun.length) bestRun = currentRun;
  if (bestRun.length === 0) return { name: null, remaining: working };
  // Single-token fallback only if it's at least 4 chars — short
  // residuals are usually noise.
  if (bestRun.length === 1 && bestRun[0]!.length < 4) {
    return { name: null, remaining: working };
  }
  const joined = bestRun.join(' ').toLowerCase();
  // Redact each token from the working string.
  let remaining = working;
  for (const tok of bestRun) {
    const re = new RegExp(`\\b${escapeRegex(tok)}\\b`);
    const m = re.exec(remaining);
    if (m && m.index !== undefined) {
      remaining = redactRange(remaining, m.index, m.index + m[0].length);
    }
  }
  return { name: joined, remaining };
}

export function detectName(working: string): NameMatch {
  const dict = tryDictionaryMatch(working);
  if (dict.name != null) {
    return {
      cardName: dict.name,
      remaining: dict.remaining,
      signals: [`name:dict:${dict.name}`],
      fromDictionary: true,
    };
  }
  const fallback = tryFallbackMatch(working);
  if (fallback.name != null) {
    return {
      cardName: fallback.name,
      remaining: fallback.remaining,
      signals: ['name:fallback'],
      fromDictionary: false,
    };
  }
  return { cardName: null, remaining: working, signals: [], fromDictionary: false };
}
