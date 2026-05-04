// Preclean pass — Unicode-normalise, lowercase, strip emoji, collapse
// whitespace. Pure function. Output is the input string suitable as
// the starting point for the working buffer the rest of the pipeline
// chews on.
//
// Decisions:
// - **Lowercase** so downstream regex sets stay case-insensitive
//   without `i` flags everywhere (`i` flags interact awkwardly with
//   named groups in some engines).
// - **NFKC normalisation** turns `①` → `1`, full-width digits → ASCII,
//   compat ligatures → their canonical form. Useful for Japanese
//   listings that copy-paste `１９９９` from official pages.
// - **Replace fancy quotes / dashes** with ASCII equivalents. eBay
//   sellers paste from Word, Apple Notes, etc. — emdash and curly
//   quotes are common.
// - **Strip emoji**, bullets, and the assorted marketing chrome
//   (`★`, `✨`, `🔥`, `⭐`). The Unicode category covers most of these;
//   we use a `\p{Emoji_Presentation}` alternation along with the
//   common symbol classes.
// - **Collapse whitespace runs** to single spaces and trim.
// - We DO NOT strip slashes or punctuation — `4/102` and `1st-Ed` are
//   meaningful tokens for downstream passes.

const FANCY_DASH_RE = /[\u2010-\u2015\u2212]/g;
const FANCY_SQUOTE_RE = /[\u2018\u2019\u201A\u201B]/g;
const FANCY_DQUOTE_RE = /[\u201C\u201D\u201E\u201F]/g;

// Symbol / emoji / pictograph categories that listing titles abuse
// for visual emphasis. The pattern is intentionally written without
// catastrophic alternations: each class is bounded.
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2190}-\u{21FF}]/gu;

// Bullet-ish characters sellers use as separators.
const BULLET_RE = /[\u2022\u00B7\u2023\u25CF\u25CB\u2043]/g;

const WS_RUN_RE = /\s+/g;

export interface PrecleanResult {
  /** The cleaned, lowercased, whitespace-collapsed working string. */
  readonly cleaned: string;
  /**
   * Tokens after a permissive split — primarily a diagnostic surface
   * for `unparsedTokens`. Empty entries filtered out.
   */
  readonly tokens: readonly string[];
}

/**
 * Run the full preclean pipeline on a raw eBay listing title. Pure;
 * idempotent for already-clean inputs.
 */
export function preclean(rawTitle: string): PrecleanResult {
  if (typeof rawTitle !== 'string') {
    return { cleaned: '', tokens: [] };
  }
  let s = rawTitle.normalize('NFKC');
  s = s.replace(FANCY_DASH_RE, '-');
  s = s.replace(FANCY_SQUOTE_RE, "'");
  s = s.replace(FANCY_DQUOTE_RE, '"');
  s = s.replace(EMOJI_RE, ' ');
  s = s.replace(BULLET_RE, ' ');
  s = s.toLowerCase();
  s = s.replace(WS_RUN_RE, ' ').trim();
  const tokens = s.length === 0 ? [] : s.split(' ').filter((t) => t.length > 0);
  return { cleaned: s, tokens };
}
