// Set + card-number extraction.
//
// Title patterns we cover, in descending specificity:
//
//   1. `\d+ / \d+`      — the modal modern pattern: "Charizard 4/102"
//                          or "Sylveon V 091/069"
//   2. `(TG|GG|SWSH|SM|XY|HGSS|...)\d+`
//                       — sub-set / promo numbering: "TG18", "GG70",
//                         "SWSH284"
//   3. `\d+ of \d+`     — vintage long-form: "4 of 102"
//   4. Set name from `SET_NAME_TO_CODE` dictionary
//
// The dictionary is intentionally small and modern-era-biased (per
// AC: ≥95% precision on modern; partial vintage). When a set NAME
// matches but no number was captured, we still emit `set.nameHint`
// and `set.codeHint` so the joiner can do a name-based catalog
// fallback.

import { lookupSetCodeByName, SET_NAME_TO_CODE } from './set-name-dict.js';

export interface SetNumberMatch {
  readonly setCode: string | null;
  readonly setName: string | null;
  readonly cardNumber: string | null;
  readonly remaining: string;
  readonly signals: readonly string[];
}

// Detect "<n>/<denom>", capturing the numerator only. We allow alpha
// prefixes on the numerator ("TG18/TG30") for sub-sets — the prefix
// becomes part of the captured number to preserve `printing.number`'s
// "TG01 is not TG1" invariant from `rules/01-data-layer.md`.
const SLASH_NUMBER_RE =
  /\b(?<num>(?:tg|gg|sw|swsh|sm|xy|hgss|np)?\d+[a-z]?)\s*\/\s*(?<denom>(?:tg|gg|sw|swsh|sm|xy|hgss|np)?\d+)\b/i;

// Promo / sub-set prefix without a slash: "GG70", "SWSH284".
const PREFIX_NUMBER_RE = /\b(?<prefix>tg|gg|sw|swsh|sm|xy|hgss|np|wp|wcs|swp)(?<num>\d+[a-z]?)\b/i;

// Long-form vintage: "4 of 102".
const LONGFORM_RE = /\b(?<num>\d+)\s+of\s+(?<denom>\d+)\b/i;

function redactRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

/**
 * Try the number-extraction patterns in descending specificity.
 * Captures the *numerator* verbatim (no padding applied — the
 * canonical-key generator does padding) so `TG01` stays `TG01`.
 */
/**
 * Upper-case the leading alpha prefix of a card number (`tg10` →
 * `TG10`) while leaving any trailing alpha suffix as-is (`4a` stays
 * `4a` per the canonical-keys "alpha suffix preserved" rule).
 */
function normalizeNumber(num: string): string {
  return num.replace(/^[a-z]+/i, (s) => s.toUpperCase());
}

function tryExtractNumber(working: string): {
  readonly number: string | null;
  readonly remaining: string;
  readonly signal: string | null;
} {
  const slash = SLASH_NUMBER_RE.exec(working);
  if (slash && slash.index !== undefined && slash.groups?.num) {
    return {
      number: normalizeNumber(slash.groups.num),
      remaining: redactRange(working, slash.index, slash.index + slash[0].length),
      signal: 'number:slash',
    };
  }
  const prefix = PREFIX_NUMBER_RE.exec(working);
  if (prefix && prefix.index !== undefined) {
    const prefixToken = (prefix.groups?.prefix ?? '').toUpperCase();
    const num = prefix.groups?.num ?? '';
    return {
      number: `${prefixToken}${num}`,
      remaining: redactRange(working, prefix.index, prefix.index + prefix[0].length),
      signal: 'number:prefix',
    };
  }
  const longform = LONGFORM_RE.exec(working);
  if (longform && longform.index !== undefined && longform.groups?.num) {
    return {
      number: longform.groups.num,
      remaining: redactRange(working, longform.index, longform.index + longform[0].length),
      signal: 'number:longform',
    };
  }
  return { number: null, remaining: working, signal: null };
}

/**
 * Search the working string for any registered set name. Longest
 * match wins so "crown zenith" beats "crown" (and "team rocket"
 * beats "team"). Returns the matched name + canonical code +
 * redacted remaining.
 */
function tryExtractSetName(working: string): {
  readonly setName: string | null;
  readonly setCode: string | null;
  readonly remaining: string;
} {
  const candidates: Array<{ name: string; index: number; length: number }> = [];
  for (const name of SET_NAME_TO_CODE.keys()) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`);
    const m = re.exec(working);
    if (m && m.index !== undefined) {
      candidates.push({ name, index: m.index, length: m[0].length });
    }
  }
  if (candidates.length === 0) {
    return { setName: null, setCode: null, remaining: working };
  }
  // Longest match wins; tiebreak on lower index.
  candidates.sort((a, b) => b.length - a.length || a.index - b.index);
  const winner = candidates[0]!;
  return {
    setName: winner.name,
    setCode: lookupSetCodeByName(winner.name),
    remaining: redactRange(working, winner.index, winner.index + winner.length),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectSetNumber(working: string): SetNumberMatch {
  const signals: string[] = [];
  let remaining = working;

  const num = tryExtractNumber(remaining);
  if (num.signal) signals.push(num.signal);
  remaining = num.remaining;

  const set = tryExtractSetName(remaining);
  if (set.setName) {
    signals.push(`set:${set.setCode ?? set.setName}`);
  }
  remaining = set.remaining;

  return {
    setCode: set.setCode,
    setName: set.setName,
    cardNumber: num.number,
    remaining,
    signals,
  };
}
