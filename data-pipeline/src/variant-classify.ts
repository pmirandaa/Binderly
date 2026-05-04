// `classifyVariant` — the canonical variant decision tree.
//
// Pure function. Implements the tree in `context/tcg-domain.md` § 8
// using the orthogonal flag taxonomy in § 1 and tested against every
// edge case in § 3. Adapters never assign `variant_class` themselves;
// they emit `RawPrinting` signals (isHolo, isReverseHolo, pattern,
// stamp, isFirstEdition, isShadowless, …) and this fn classifies.
//
// Contract:
//
//   classifyVariant(printing, card, set)
//     → { variant_class, variant_flags, variant_code,
//         include_in_master_set_default }
//
// `variant_code` is deterministic: short-form class + sorted short-form
// flags joined by `-`. See § 1's worked examples.
//
// `include_in_master_set_default` is a CONSERVATIVE default reflecting
// "this would clearly belong / clearly does not belong in master set"
// per § 2's invariant rules. The master-set rules engine
// (T-DL-MASTER-SET-RULES) reads this, then applies per-set overrides
// from `set.master_set_rules`, and writes the final boolean. We do not
// pretend to make per-set decisions here.

import type { RawCard, RawPrinting, RawSet, VariantClass, VariantFlag } from './types.js';

export interface ClassifyVariantResult {
  variant_class: VariantClass;
  variant_flags: VariantFlag[];
  variant_code: string;
  include_in_master_set_default: boolean;
}

// Short-form codes used in `variant_code` assembly. Per § 1 examples:
//   HOLO            → holo
//   NON_HOLO        → nonholo
//   REVERSE_HOLO    → revholo
//   FULL_ART        → fullart
//   ALT_ART         → altart
//   SECRET_RARE     → secret
//   GOLD            → gold
//   RAINBOW         → rainbow
//   TEXTURED        → textured
//   TRAINER_GALLERY → tg
//   PROMO           → promo
const CLASS_SHORT: Readonly<Record<VariantClass, string>> = {
  HOLO: 'holo',
  NON_HOLO: 'nonholo',
  REVERSE_HOLO: 'revholo',
  FULL_ART: 'fullart',
  ALT_ART: 'altart',
  SECRET_RARE: 'secret',
  GOLD: 'gold',
  RAINBOW: 'rainbow',
  TEXTURED: 'textured',
  TRAINER_GALLERY: 'tg',
  PROMO: 'promo',
};

// Per § 1 examples ("Base Set Charizard 1st Edition Shadowless Holo:
// holo-fe-sl"), flags are short two/three-letter tokens, sorted
// alphabetically.
const FLAG_SHORT: Readonly<Record<VariantFlag, string>> = {
  FIRST_EDITION: 'fe',
  SHADOWLESS: 'sl',
  UNLIMITED: 'unl',
  POKE_BALL_PATTERN: 'pb',
  MASTER_BALL_PATTERN: 'mb',
  COSMOS_PATTERN: 'cosmos',
  GALAXY_PATTERN: 'galaxy',
  STAMPED_PRERELEASE: 'pre',
  STAMPED_STAFF: 'staff',
  STAMPED_LEAGUE: 'league',
  STAMPED_BUILDBATTLE: 'bb',
  STAMPED_CHAMPIONSHIP: 'champ',
  TEXTURED: 'tex',
  ERROR: 'err',
};

/**
 * Pure: same input → same output.
 *
 * The decision tree (`tcg-domain.md` § 8):
 *
 *   1. Card number > printed_total            → SECRET_RARE class.
 *   2. Source explicitly marks special class  → that class
 *      (Full Art, Alt Art, Gold, Rainbow, Textured, Trainer Gallery, Promo).
 *   3. Reverse-holo print run                 → REVERSE_HOLO + pattern flag.
 *   4. Holographic main-set                   → HOLO.
 *   5. Else                                   → NON_HOLO.
 *
 * Flags layered per § 1: 1st Edition / Shadowless / Unlimited (vintage),
 * stamped (prerelease / staff / league / build-and-battle / championship),
 * error.
 */
export function classifyVariant(
  printing: RawPrinting,
  card: RawCard,
  set: RawSet,
): ClassifyVariantResult {
  const variant_class = pickClass(printing, card, set);
  const variant_flags = collectFlags(printing, variant_class);
  const variant_code = assembleVariantCode(variant_class, variant_flags);
  const include_in_master_set_default = decideMasterDefault(variant_class, variant_flags, set);
  return { variant_class, variant_flags, variant_code, include_in_master_set_default };
}

// ------------------------------------------------------------
// Step 1–5: pick the class
// ------------------------------------------------------------

function pickClass(printing: RawPrinting, card: RawCard, set: RawSet): VariantClass {
  // Order: explicit special classes win FIRST. Secret-rare numbering
  // (number > printed_total) is the fallback when a printing is
  // beyond the printed_total but carries no other class signal —
  // this matches collector intuition (a Brilliant Stars Charizard
  // VSTAR Rainbow #174 with printed_total 172 is classed RAINBOW,
  // not SECRET_RARE — the over-numbering is just *how* secret-rare
  // tier cards happen to be slotted, not their visual identity).
  //
  // See `context/tcg-domain.md` § 8 for the documented decision tree.

  // Trainer Gallery (TG / GG sub-set) takes precedence over the more
  // generic alt/full-art buckets — § 3 explicitly tracks them as a
  // class for the parent set.
  if (printing.isTrainerGallery || hasGalleryPrefix(card.number)) {
    return 'TRAINER_GALLERY';
  }
  if (printing.isGoldRare) return 'GOLD';
  if (printing.isRainbowRare) return 'RAINBOW';
  if (printing.isAltArt) return 'ALT_ART';
  if (printing.isFullArt) return 'FULL_ART';
  // TEXTURED is both a class and a flag in § 1's enums. When a source
  // says the printing *is* a textured rare (vs. "this holo also has
  // texture"), treat it as the class. The `TEXTURED` flag is
  // reserved for cases where another class needs to mark "and it is
  // also textured" (e.g. a textured Trainer Gallery).
  if (printing.isTextured && !hasOtherClassSignal(printing)) {
    return 'TEXTURED';
  }
  // Promo is a class for cards in promo "sets" (Black Star, SWSH
  // Black Star, etc.). The per-source set-code mapping flags promo
  // sets and adapters mirror that onto the printing via `isPromo`.
  // Cards in non-promo sets that are *additionally* promo-stamped use
  // the stamp flags (STAMPED_PRERELEASE etc.) instead.
  if (printing.isPromo) return 'PROMO';

  // Secret rare: number > printed_total AND no other class signal.
  // Lettered numbers (TG01, GG12, SWSH001) bypass this check by virtue
  // of `isNumericGreaterThanPrintedTotal` returning false; the gallery
  // / promo branches above pick those up.
  if (isNumericGreaterThanPrintedTotal(card.number, set.printedTotal)) {
    return 'SECRET_RARE';
  }

  // Reverse holo print run.
  if (printing.isReverseHolo) return 'REVERSE_HOLO';

  // Holographic main-set card.
  if (printing.isHolo) return 'HOLO';

  // Non-holo fallback.
  return 'NON_HOLO';
}

// ------------------------------------------------------------
// Flags
// ------------------------------------------------------------

function collectFlags(printing: RawPrinting, variantClass: VariantClass): VariantFlag[] {
  const flags = new Set<VariantFlag>();

  // Vintage edition flags. 1st Edition and Shadowless are
  // independently observable; Unlimited is the explicit absence of
  // both, which we record only when the source emits it (e.g. the
  // adapter found a "Unlimited" listing alongside 1st Edition and
  // Shadowless prints — we keep all three distinct printings).
  if (printing.isFirstEdition) flags.add('FIRST_EDITION');
  if (printing.isShadowless) flags.add('SHADOWLESS');
  // Only mark UNLIMITED when the source explicitly flagged it. We do
  // NOT auto-set UNLIMITED when 1st Edition is absent; modern sets
  // wouldn't have an "Unlimited" run by definition (1st Edition
  // existed Base→Neo3 only). Adapters set `isFirstEdition === false &&
  // isShadowless === false` for vintage prints and that's their cue.
  if (printing.extra && printing.extra['isUnlimited'] === true) {
    flags.add('UNLIMITED');
  }

  // Pattern variants (background design — Poké Ball, Master Ball,
  // Cosmos, Galaxy). These layer on REVERSE_HOLO most often (Poké Ball
  // and Master Ball reverse holos are explicit master-set inclusions
  // per § 2) but the source may emit them on NON_HOLO promos as well.
  switch (printing.pattern) {
    case 'POKE_BALL':
      flags.add('POKE_BALL_PATTERN');
      break;
    case 'MASTER_BALL':
      flags.add('MASTER_BALL_PATTERN');
      break;
    case 'COSMOS':
      flags.add('COSMOS_PATTERN');
      break;
    case 'GALAXY':
      flags.add('GALAXY_PATTERN');
      break;
    case null:
    case undefined:
      break;
  }

  // Stamped variants. STAFF / LEAGUE / BUILDBATTLE / CHAMPIONSHIP /
  // PRERELEASE are mutually exclusive — if a source emits more than
  // one we keep the most specific one (precedence: champ > staff >
  // buildbattle > league > prerelease) but in practice sources emit
  // exactly one.
  switch (printing.stamp) {
    case 'PRERELEASE':
      flags.add('STAMPED_PRERELEASE');
      break;
    case 'STAFF':
      flags.add('STAMPED_STAFF');
      break;
    case 'LEAGUE':
      flags.add('STAMPED_LEAGUE');
      break;
    case 'BUILDBATTLE':
      flags.add('STAMPED_BUILDBATTLE');
      break;
    case 'CHAMPIONSHIP':
      flags.add('STAMPED_CHAMPIONSHIP');
      break;
    case null:
    case undefined:
      break;
  }

  // TEXTURED as a flag (rather than class) — used when the variant
  // class is something else (e.g. a textured Trainer Gallery printing)
  // but the source still reports texture.
  if (printing.isTextured && variantClass !== 'TEXTURED') {
    flags.add('TEXTURED');
  }

  // Errors are flagged. Excluded from the master set by default per
  // § 3's "Errors and misprints" rule.
  if (printing.isError) flags.add('ERROR');

  return [...flags];
}

// ------------------------------------------------------------
// Variant code assembly
// ------------------------------------------------------------

/**
 * Assembles `{class_short}[+{flag_short}…]` joined with `-`, with
 * flags sorted alphabetically by their short form (per § 1). Examples:
 *
 *   HOLO + [FIRST_EDITION, SHADOWLESS]
 *     → ['holo', 'fe', 'sl'].sort  →  'holo-fe-sl'
 *
 *   RAINBOW + []
 *     → 'rainbow'
 *
 *   NON_HOLO + [MASTER_BALL_PATTERN]
 *     → 'nonholo-mb'
 *
 *   SECRET_RARE + []
 *     → 'secret'
 */
export function assembleVariantCode(
  variantClass: VariantClass,
  flags: ReadonlyArray<VariantFlag>,
): string {
  const classShort = CLASS_SHORT[variantClass];
  if (!flags.length) return classShort;
  const sortedFlagShorts = flags.map((f) => FLAG_SHORT[f]).sort((a, b) => a.localeCompare(b));
  return [classShort, ...sortedFlagShorts].join('-');
}

// ------------------------------------------------------------
// Master-set inclusion default
// ------------------------------------------------------------

function decideMasterDefault(
  variantClass: VariantClass,
  flags: ReadonlyArray<VariantFlag>,
  _set: RawSet,
): boolean {
  // Per § 2's "Always excluded by default":
  //   - Errors / misprints
  //   - STAFF stamps (different-set staff promos)
  if (flags.includes('ERROR')) return false;
  if (flags.includes('STAMPED_STAFF')) return false;

  // Per § 2's "Always included by default":
  //   - Reverse holos
  //   - Poké Ball / Master Ball pattern
  //   - Prerelease build-and-battle stamped from the same set
  //   - Secret rares (numbers above printed_total)
  //   - Numbered cards' standard printings (HOLO / NON_HOLO main set)
  //
  // The master-set rules engine (T-DL-MASTER-SET-RULES) flips these
  // back to false on a per-set basis as needed (vintage prereleases,
  // sets that exclude certain pattern variants, etc.).
  if (variantClass === 'SECRET_RARE') return true;
  if (variantClass === 'REVERSE_HOLO') return true;
  if (variantClass === 'TRAINER_GALLERY') return true; // included by default per § 3
  if (variantClass === 'HOLO' || variantClass === 'NON_HOLO') return true;

  // Special-class default: included. Modern sets fold full-art / alt-
  // art / rainbow / gold / textured into their master-set; vintage
  // sets without these classes don't see the rule fire. Per-set
  // overrides handle the exceptions.
  if (
    variantClass === 'FULL_ART' ||
    variantClass === 'ALT_ART' ||
    variantClass === 'RAINBOW' ||
    variantClass === 'GOLD' ||
    variantClass === 'TEXTURED'
  ) {
    return true;
  }

  // Promo "sets" tracked as their own sets per § 3 — every printing
  // counts toward that promo set's master-set %.
  if (variantClass === 'PROMO') return true;

  return false;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function isNumericGreaterThanPrintedTotal(
  numberStr: string,
  printedTotal: number | null | undefined,
): boolean {
  if (printedTotal == null) return false;
  if (!/^\d+$/.test(numberStr.trim())) return false;
  const n = Number.parseInt(numberStr.trim(), 10);
  return n > printedTotal;
}

function hasGalleryPrefix(numberStr: string): boolean {
  // TG (Trainer Gallery, SWSH era) and GG (Galarian Gallery, Crown
  // Zenith) are sub-set numbering prefixes per § 3. Adapters that
  // don't carry the explicit `isTrainerGallery` flag still expose this
  // pattern through the card number.
  const v = numberStr.trim().toUpperCase();
  return /^(?:TG|GG)\d+$/.test(v);
}

function hasOtherClassSignal(printing: RawPrinting): boolean {
  return Boolean(
    printing.isAltArt ||
    printing.isFullArt ||
    printing.isGoldRare ||
    printing.isRainbowRare ||
    printing.isTrainerGallery ||
    printing.isPromo,
  );
}
