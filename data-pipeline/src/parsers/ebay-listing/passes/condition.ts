// Raw-card condition pass.
//
// Only runs when the grade pass did NOT flag the listing as a slab —
// "PSA 10 Charizard NM" still says "PSA 10", not "near mint" of a
// raw card. Vocabulary mirrors `collection_item.condition` defaults
// from `packages/db/src/schema/collections.ts`.
//
// Patterns are tried in descending specificity (e.g. "near mint"
// before "mint", "near-mint" hyphenated before "near mint", "mp"
// abbreviation last because two-letter tokens are easy to mis-match).

import type { Condition } from '../types.js';

export interface ConditionMatch {
  readonly condition: Condition | null;
  readonly remaining: string;
  readonly signals: readonly string[];
}

interface ConditionPattern {
  readonly re: RegExp;
  readonly condition: Condition;
  readonly label: string;
}

// Order matters — multi-word patterns come before abbreviations, and
// abbreviations fire only as standalone two-letter tokens.
const CONDITION_PATTERNS: readonly ConditionPattern[] = [
  {
    re: /\bnear\s*-?\s*mint\b|\bnm\s*-\s*mt\b/,
    condition: 'NEAR_MINT',
    label: 'condition:near-mint',
  },
  {
    re: /\blightly\s+played\b/,
    condition: 'LIGHTLY_PLAYED',
    label: 'condition:lightly-played',
  },
  {
    re: /\bmoderately\s+played\b/,
    condition: 'MODERATELY_PLAYED',
    label: 'condition:moderately-played',
  },
  {
    re: /\bheavily\s+played\b/,
    condition: 'HEAVILY_PLAYED',
    label: 'condition:heavily-played',
  },
  {
    re: /\bdamaged\b|\bpoor\b/,
    condition: 'DAMAGED',
    label: 'condition:damaged',
  },
  // Abbreviations next — paired-with-condition-keyword variants
  // catch "EX/NM" and similar.
  {
    re: /\bnm\b|\bm\/nm\b/,
    condition: 'NEAR_MINT',
    label: 'condition:nm',
  },
  {
    re: /\blp\b/,
    condition: 'LIGHTLY_PLAYED',
    label: 'condition:lp',
  },
  {
    re: /\bmp\b/,
    condition: 'MODERATELY_PLAYED',
    label: 'condition:mp',
  },
  {
    re: /\bhp\b/,
    condition: 'HEAVILY_PLAYED',
    label: 'condition:hp',
  },
  {
    re: /\bdmg\b/,
    condition: 'DAMAGED',
    label: 'condition:dmg',
  },
  // Plain "mint" without "near" — fire LAST so "near mint" already
  // claimed the span.
  {
    re: /\bmint\b/,
    condition: 'MINT',
    label: 'condition:mint',
  },
  // Generic "played" without a qualifier — coarsest bucket.
  {
    re: /\bplayed\b/,
    condition: 'MODERATELY_PLAYED',
    label: 'condition:played',
  },
];

function redactRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

/**
 * Detect the condition of a raw card. Returns `condition: null` when
 * no signal fires; the caller can then default to `RAW_UNKNOWN` for
 * the grade tier.
 */
export function detectCondition(working: string): ConditionMatch {
  for (const pat of CONDITION_PATTERNS) {
    const m = pat.re.exec(working);
    if (!m || m.index === undefined) continue;
    return {
      condition: pat.condition,
      remaining: redactRange(working, m.index, m.index + m[0].length),
      signals: [pat.label],
    };
  }
  return { condition: null, remaining: working, signals: [] };
}
