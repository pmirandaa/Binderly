// Bulbapedia page-title parser. Card pages follow the convention
// `<CardName> (<SetName> <Number>)`; set pages are
// `<SetName> (TCG)`. Both yield enough structure for the transform
// layer to recover set name and card number when the infobox slot
// is missing or malformed.
//
// References:
//   - Bulbapedia naming conventions for TCG card articles. The
//     parenthetical portion is the disambiguator and is the source of
//     truth for the card's set / number when the body's infobox
//     `cardno` slot disagrees.

export interface ParsedCardTitle {
  /** Card display name (`Charizard`). */
  name: string;
  /** Raw set name as the title spells it (`Base Set`, `Brilliant Stars`, `SWSH Black Star Promos`). */
  setName: string;
  /** Card number token (`4`, `TG01`, `SWSH285`). */
  number: string;
}

export interface ParsedSetTitle {
  /** Raw set name (`Base Set`, `Brilliant Stars`). */
  name: string;
}

/**
 * Parse a card-page title into its components. Returns `null` when
 * the title doesn't match the expected pattern.
 *
 * Supported forms:
 *   - `Charizard (Base Set 4)`
 *   - `Charizard VSTAR (Brilliant Stars 174)`
 *   - `Charizard VSTAR (Brilliant Stars TG10)`     ← Trainer Gallery
 *   - `Lugia V (SWSH Black Star Promos 285)`
 *   - `Lugia V (SWSH Black Star Promos SWSH285)`   ← lettered promo
 *   - `Charizard δ (EX Holon Phantoms 100)`        ← unicode preserved
 */
export function parseCardPageTitle(title: string): ParsedCardTitle | null {
  // Greedy match on the LAST parenthetical to handle cards whose
  // names contain parentheses (rare but possible).
  const trimmed = title.trim();
  const close = trimmed.lastIndexOf(')');
  if (close !== trimmed.length - 1) return null;
  const open = trimmed.lastIndexOf('(', close);
  if (open === -1) return null;
  const name = trimmed.slice(0, open).trim();
  const inner = trimmed.slice(open + 1, close).trim();
  if (!name || !inner) return null;
  // The number is the last whitespace-separated token; everything
  // before it is the set name.
  const lastSpace = inner.lastIndexOf(' ');
  if (lastSpace === -1) return null;
  const setName = inner.slice(0, lastSpace).trim();
  const number = inner.slice(lastSpace + 1).trim();
  if (!setName || !number) return null;
  return { name, setName, number };
}

/**
 * Parse a set-page title (`Brilliant Stars (TCG)`). Returns `null`
 * when the title doesn't match.
 */
export function parseSetPageTitle(title: string): ParsedSetTitle | null {
  const m = title.trim().match(/^(.+?)\s*\(TCG\)\s*$/);
  if (!m || !m[1]) return null;
  return { name: m[1].trim() };
}
