// Pure-string formatters for the custom + smart collections UI.
//
// Kept tiny and side-effect-free so it composes with the screens'
// memoization without forcing useMemo around basic display logic.

/** Free-tier custom-collection cap from PROJECT.md § 16. */
export const FREE_TIER_CUSTOM_LIMIT = 3;

/**
 * Render the "X / 3 used" header copy for the custom-collection
 * list. Always uses the free-tier denominator — paid users see the
 * same header (it's harmless because they're never gated) and we
 * avoid plumbing tier through every call site.
 */
export function formatCustomUsage(count: number): string {
  return `${count} / ${FREE_TIER_CUSTOM_LIMIT} used`;
}

/**
 * Truncate a description / smart-expression preview to a reasonable
 * row-length. Returns the original when shorter than the cap. Never
 * splits inside a multi-byte sequence — JavaScript string ops are
 * code-unit-based which is fine for the ASCII-leaning DSL surface.
 */
export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Format an ISO timestamp as a coarse "Mar 14" / "Mar 14, 2023"
 * label for the row metadata. Returns "—" when the input is null.
 */
export function formatDateLabel(iso: string | null): string {
  if (iso === null) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  const now = new Date();
  const month = MONTHS[parsed.getUTCMonth()] ?? '';
  const day = parsed.getUTCDate();
  if (parsed.getUTCFullYear() === now.getUTCFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${parsed.getUTCFullYear()}`;
}

const MONTHS: ReadonlyArray<string> = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Produce a short URL-safe slug from a free-text name. Lowercase,
 * alphanumerics joined by hyphens. The server enforces the same
 * shape via `slugSchema`; we run the same transform locally so the
 * Create CTA can submit a valid request without an extra round-trip.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64);
}
