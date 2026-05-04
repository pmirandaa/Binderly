// Tiny HTML extraction helpers used by the Pokemon-Card.com adapter.
// Pure functions; no DOM, no third-party HTML parser. The parser
// surface area is narrow (~12 fields per card / ~6 per set) and the
// HTML layout is stable, so regex extraction is sufficient — and
// stays inside this task's owns_paths boundary (no `cheerio` /
// `linkedom` package.json edit).
//
// All helpers expect well-formed UTF-8 HTML strings. They return
// `null` rather than throwing when a field is absent, leaving the
// caller (the transform) to decide whether the missing field is a
// hard error or a tolerated null.
//
// References:
//   - `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-JP.md` § "Pokemon-Card.com"
//     for the URL shape and parsing strategy.

/**
 * Extract the inner text of the first `<dd>` immediately following a
 * `<dt>` whose visible text matches `dtLabel`. Used for the
 * label/value pairs Pokemon-Card.com renders inside
 * `<dl class="cardDataDetail">` and on expansion pages.
 *
 * Whitespace-trimmed. Returns `null` when the label is not present.
 */
export function extractByDtDd(html: string, dtLabel: string): string | null {
  // We don't need to match the precise label-to-value relationship
  // because Pokemon-Card.com renders the dt + dd as siblings in
  // document order. The non-greedy `[\s\S]*?` walks until the
  // first `<dd>` after the labelled `<dt>`.
  const escaped = escapeRegex(dtLabel);
  const re = new RegExp(`<dt[^>]*>\\s*${escaped}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i');
  const m = re.exec(html);
  if (!m || m[1] == null) return null;
  return cleanText(m[1]);
}

/**
 * Extract the value of attribute `attrName` from the first matching
 * tag. The matcher accepts an arbitrary regex against the full
 * opening tag — caller composes selectors via class names, e.g.
 * `extractAttr(html, /<img[^>]*class="[^"]*card-image[^"]*"[^>]*>/, 'src')`.
 */
export function extractAttr(html: string, tagRe: RegExp, attrName: string): string | null {
  const tagMatch = tagRe.exec(html);
  if (!tagMatch) return null;
  const tag = tagMatch[0];
  const attrRe = new RegExp(`\\s${escapeRegex(attrName)}\\s*=\\s*"([^"]*)"`, 'i');
  const m = attrRe.exec(tag);
  if (!m || m[1] == null) return null;
  return decodeHtmlEntities(m[1].trim());
}

/**
 * Extract the inner text content of the first element matching
 * `tagRe`. Strips inner tags via the simple "remove `<...>` runs"
 * approach — fine for the leaf elements we target (h1, h2, span,
 * dd, p) which never carry script tags or nested complex markup
 * on Pokemon-Card.com card pages.
 */
export function extractTextContent(html: string, tagRe: RegExp): string | null {
  const m = tagRe.exec(html);
  if (!m || m[1] == null) return null;
  return cleanText(m[1]);
}

/**
 * Decode the small subset of HTML entities Pokemon-Card.com emits.
 * The site uses `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#039;`,
 * `&nbsp;`, and the JIS-friendly `&times;` (×). Beyond that, raw
 * UTF-8 bytes for Japanese text are unescaped.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&times;/g, '×');
}

/** Trim, collapse whitespace runs, decode entities. */
export function cleanText(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Convert a Japanese-format date `YYYY年M月D日` to ISO `yyyy-mm-dd`.
 * Returns `null` when the input doesn't match.
 *
 * Examples:
 *   "2023年3月10日"  → "2023-03-10"
 *   "2022年1月14日"  → "2022-01-14"
 */
export function convertJaDateToISO(jaDate: string | null | undefined): string | null {
  if (!jaDate) return null;
  const m = /^\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/.exec(jaDate);
  if (!m || m[1] == null || m[2] == null || m[3] == null) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/**
 * Resolve a possibly-relative URL against the Pokemon-Card.com
 * origin. Pokemon-Card.com renders `<img src="/assets/img/card/abc.jpg">`
 * style relative URLs; the adapter persists fully-qualified URLs.
 */
export function absolutizeUrl(
  rawUrl: string | null,
  origin = 'https://www.pokemon-card.com',
): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `${origin}${trimmed}`;
  return `${origin}/${trimmed}`;
}

/**
 * Parse the rarity glyph token (`AR`, `SAR`, `RR`, `HR`, …) into a
 * canonical-ish label that matches the adapter's
 * `pokemoncard-jp` rarity registry table.
 *
 * Returns `{ glyph, label }` when known; returns `null` for unknown
 * glyphs (caller surfaces as `rarityRaw: null` so downstream
 * normalization doesn't force a guess).
 */
export function parseRarityGlyph(
  glyph: string | null,
): { glyph: string; label: import('./api-types.js').PokemonCardJpRarityLabel } | null {
  if (!glyph) return null;
  const g = glyph.trim().toUpperCase();
  if (!g) return null;
  switch (g) {
    case 'C':
      return { glyph: g, label: 'Common' };
    case 'U':
      return { glyph: g, label: 'Uncommon' };
    case 'R':
      return { glyph: g, label: 'Rare' };
    case 'RR':
      return { glyph: g, label: 'Double Rare' };
    case 'RRR':
    case 'SR':
      return { glyph: g, label: 'Super Rare' };
    case 'UR':
      return { glyph: g, label: 'Ultra Rare' };
    case 'HR':
      return { glyph: g, label: 'Hyper Rare' };
    case 'A':
    case 'AR':
      return { glyph: g, label: 'Art Rare' };
    case 'SAR':
      return { glyph: g, label: 'Special Art Rare' };
    case 'CHR':
      return { glyph: g, label: 'Character Rare' };
    case 'CSR':
      return { glyph: g, label: 'Character Super Rare' };
    case 'S':
      return { glyph: g, label: 'Shiny Rare' };
    case 'SSR':
      return { glyph: g, label: 'Shiny Super Rare' };
    case 'PR':
    case 'P':
    case 'PROMO':
      return { glyph: g, label: 'Promo' };
    default:
      return null;
  }
}

/**
 * The card detail page renders the on-card number as `{number}/{total}`
 * inside the `カード番号` (card number) row. Extract just the
 * number portion and trim. Returns `null` when malformed.
 */
export function parseCardNumber(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^([^\s/]+)\s*\/\s*\S+/.exec(trimmed);
  if (m && m[1] != null) return m[1].trim();
  // Some pages omit the slash on promo / special-format numbering.
  return trimmed.split(/\s+/)[0] ?? null;
}

/**
 * Pokemon-Card.com flags a missing card with HTTP 200 and a body
 * lacking the `<dl class="cardDataDetail">` container. We detect
 * this absence as the canonical "card not found" signal.
 */
export function looksLikeNotFoundCardBody(html: string): boolean {
  return !/<dl[^>]*class="[^"]*cardDataDetail[^"]*"/i.test(html);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
