// Pure display helpers shared by the smart-collection routes.
// No I/O, no React — tests can pin the formatting rules without
// rendering anything.

/**
 * Lower-case kebab-case slug from a freeform display name.
 * Strips diacritics, collapses non-alphanumeric runs into single
 * `-`, trims leading/trailing dashes. Matches the `slugSchema`
 * regex in `@binderly/api-contracts/src/collection.ts`.
 *
 * Returns the empty string when `name` contains no alphanumeric
 * characters at all — callers should validate before submitting.
 */
export function slugify(name: string): string {
  const normalized = name
    .normalize('NFKD')
    // Strip any combining marks left over after NFKD.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  // Collapse any run of `-` longer than one (defensive — the
  // single-class character regex above already handles most
  // cases).
  return normalized.replace(/-{2,}/g, '-');
}

/**
 * Truncate a long DSL JSON expression for inline display in a
 * list row. Removes whitespace, then caps to `max` characters
 * with an ellipsis.
 */
export function truncateExpression(expression: unknown, max = 80): string {
  let json: string;
  try {
    json = JSON.stringify(expression);
  } catch {
    return '<unserialisable expression>';
  }
  if (json.length <= max) return json;
  return `${json.slice(0, max - 1)}…`;
}

/**
 * Format an ISO date-time as a short human label for the
 * "last evaluated" / "created" timestamps. Falls back to the
 * raw value if Intl can't parse it.
 */
export function formatTimestamp(iso: string | null, locale = 'en-US'): string {
  if (iso === null || iso === '') return 'Never';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

/**
 * One-line "Saved: X" / "Saved: X / 5" header copy. Free users
 * see "0 / 5" with the upsell because the `/5` cap is the free-
 * tier ceiling defined in `PROJECT.md` § 16 (smart collections:
 * free-tier 0 saved). For paid users we render `X / ∞` instead.
 */
export function formatSavedCount(args: {
  readonly count: number;
  readonly tier: 'free' | 'pro';
}): string {
  if (args.tier === 'pro') return `Saved: ${args.count} / ∞`;
  return `Saved: ${args.count} / 0`;
}

/**
 * Pretty title for a printing's variant chip. Re-implemented
 * here (rather than imported from `lib/browse/format`) so the
 * smart-collections module stays standalone — the browse format
 * helper only handles `Rarity`, not `VariantClass`.
 */
export function variantClassLabel(variantClass: string): string {
  return variantClass.replace(/_/g, ' ').toLowerCase();
}

/**
 * Strip a JSON expression's pretty-print whitespace so the
 * editor's "format" affordance can normalize the textarea into
 * a canonical pretty-printed shape.
 */
export function prettyPrintJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
