// Variant-hint extraction.
//
// We emit *signals*, not classifications. The variant classifier
// (`data-pipeline/src/variant-classify.ts`) is the source of truth
// for the final `variant_class`; the parser's job is to surface
// "this listing mentioned 'reverse holo'" so downstream code can
// narrow printings.
//
// Order matters — specific patterns must run before more general
// ones:
//   - `reverse holo` before `holo`
//   - `vmax`/`vstar` before `v`
//   - `1st edition` matched by language pass already redacted JP
//     1st-Ed; we still match the EN form here

import { emptyVariantHints } from '../types.js';

import type { RarityHint, VariantHints } from '../types.js';

export interface VariantsMatch {
  readonly hints: VariantHints;
  readonly remaining: string;
  readonly signals: readonly string[];
}

interface VariantPattern {
  readonly re: RegExp;
  readonly label: string;
  readonly apply: (hints: VariantHints) => void;
}

const VARIANT_PATTERNS: readonly VariantPattern[] = [
  // Reverse holo BEFORE plain holo.
  {
    re: /\breverse\s+holo(?:foil)?\b|\brh\b/,
    label: 'variant:reverse-holo',
    apply: (h) => {
      h.isReverseHolo = true;
    },
  },
  // 1st Edition / first edition / 1st ed
  {
    re: /\b1st\s+(?:edition|ed)\b|\bfirst\s+edition\b/,
    label: 'variant:1st-edition',
    apply: (h) => {
      h.isFirstEdition = true;
    },
  },
  {
    re: /\bshadowless\b/,
    label: 'variant:shadowless',
    apply: (h) => {
      h.isShadowless = true;
    },
  },
  // Pokemon Center / mass market patterns (Master Ball / Poke Ball)
  {
    re: /\bmaster\s*ball(?:\s+(?:pattern|holo|reverse))?\b/,
    label: 'variant:master-ball',
    apply: (h) => {
      h.isMasterBallPattern = true;
    },
  },
  {
    re: /\bpok[eé]?\s*ball(?:\s+(?:pattern|holo|reverse))?\b/,
    label: 'variant:poke-ball',
    apply: (h) => {
      h.isPokeBallPattern = true;
    },
  },
  // Alt-art / Special Illustration Rare BEFORE generic full-art.
  {
    re: /\balt(?:ernate|ernative)?\s*-?\s*art(?:work)?\b|\bspecial\s+illustration\s+rare\b|\bsir\b|\bs\.?i\.?r\.?\b/,
    label: 'variant:alt-art',
    apply: (h) => {
      h.isAltArt = true;
    },
  },
  {
    re: /\bfull\s*-?\s*art\b/,
    label: 'variant:full-art',
    apply: (h) => {
      h.isFullArt = true;
    },
  },
  {
    re: /\brainbow(?:\s+rare)?\b/,
    label: 'variant:rainbow',
    apply: (h) => {
      h.isRainbow = true;
    },
  },
  {
    re: /\bgold(?:\s+(?:rare|secret))?\b(?!\s+star)/,
    label: 'variant:gold',
    apply: (h) => {
      h.isGold = true;
    },
  },
  {
    re: /\b(?:secret\s+rare|secret)\b(?!\s+rare\s+gallery)/,
    label: 'variant:secret-rare',
    apply: (h) => {
      h.isSecretRare = true;
    },
  },
  {
    re: /\b(?:black\s+star\s+)?promo\b/,
    label: 'variant:promo',
    apply: (h) => {
      h.isPromo = true;
    },
  },
  {
    re: /\bstaff\b/,
    label: 'variant:staff',
    apply: (h) => {
      h.isStaff = true;
    },
  },
  {
    re: /\b(?:pre-?release|prerelease|pre\s+release)\b/,
    label: 'variant:prerelease',
    apply: (h) => {
      h.isPrerelease = true;
    },
  },
  // Generic holo LAST so it doesn't pre-empt reverse-holo.
  {
    re: /\bholo(?:foil|graphic)?\b/,
    label: 'variant:holo',
    apply: (h) => {
      // Only set isHolo if reverse-holo wasn't already asserted.
      if (h.isReverseHolo !== true) h.isHolo = true;
    },
  },
];

interface RarityPattern {
  readonly re: RegExp;
  readonly hint: RarityHint;
  readonly label: string;
}

// Modern rarity-hint patterns. Order matters — VMAX/VSTAR/EX before
// V/E. We match them as standalone tokens so "Charizard V" and
// "Charizard VMAX" don't both fire.
const RARITY_PATTERNS: readonly RarityPattern[] = [
  { re: /\bvmax\b/, hint: 'VMAX', label: 'rarity:vmax' },
  { re: /\bvstar\b|\bv-?star\b/, hint: 'VSTAR', label: 'rarity:vstar' },
  { re: /\btag\s+team\b/, hint: 'TAG_TEAM', label: 'rarity:tag-team' },
  { re: /\bbreak\b/, hint: 'BREAK', label: 'rarity:break' },
  { re: /\bmega\b/, hint: 'MEGA', label: 'rarity:mega' },
  // The capital-EX (vintage Ruby/Sapphire era) and the lowercase-ex
  // (modern SV-era) collapse into one hint here — the *case* is
  // already lost by preclean. Distinguishing the two requires the
  // catalog (set era) and is out of scope for the parser.
  { re: /\bex\b/, hint: 'ex', label: 'rarity:ex' },
  { re: /\bgx\b/, hint: 'GX', label: 'rarity:gx' },
  // Plain "V" is risky — only fire when followed by a digit
  // (Charizard V is risky too because card names sometimes contain
  // a `V`). We require a word-boundary V followed by a non-letter.
  { re: /\bv\b(?!\w)/, hint: 'V', label: 'rarity:v' },
];

function redactRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

/**
 * Run every variant + rarity regex over the working string. Each
 * match redacts its span; the same string can carry multiple flags
 * (e.g. "1st Ed Holo Charizard").
 */
export function detectVariants(working: string): VariantsMatch {
  const hints = emptyVariantHints();
  const signals: string[] = [];
  let remaining = working;

  for (const pat of VARIANT_PATTERNS) {
    const m = pat.re.exec(remaining);
    if (!m || m.index === undefined) continue;
    pat.apply(hints);
    signals.push(pat.label);
    remaining = redactRange(remaining, m.index, m.index + m[0].length);
  }

  for (const pat of RARITY_PATTERNS) {
    if (hints.rarityHint != null) break;
    const m = pat.re.exec(remaining);
    if (!m || m.index === undefined) continue;
    hints.rarityHint = pat.hint;
    signals.push(pat.label);
    remaining = redactRange(remaining, m.index, m.index + m[0].length);
  }

  return { hints, remaining, signals };
}
