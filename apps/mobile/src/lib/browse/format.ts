// Small formatting helpers shared across the browse / set / card
// screens. Kept side-effect free and pure so they can be tested
// without rendering React.
//
// Date formatting uses `Intl.DateTimeFormat('en-US')` explicitly
// rather than the device locale: card catalogs are an
// English-by-default product surface and the Japanese sets render
// their localized name separately. Picking `en-US` means tests
// are deterministic across CI runners with different `LANG`
// environment variables.

// `timeZone: 'UTC'` is critical — without it, a release date of
// `1999-01-09` parses to `1999-01-09T00:00:00Z` which renders as
// `Jan 8, 1999` in any West-of-UTC timezone (e.g. America/Santiago,
// where CI sometimes runs). Release dates are calendar dates, not
// instants; forcing UTC keeps the formatted string aligned with the
// wire value across every runner.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * Format an ISO-8601 calendar date (`YYYY-MM-DD`) as a short
 * human-readable string (`Jan 9, 1999`). The input is treated as
 * UTC so a release date of `1999-01-09` renders as `Jan 9, 1999`
 * regardless of the device timezone — release dates are calendar
 * dates, not instants.
 *
 * Returns the input unchanged when it fails to parse so the UI
 * never surfaces a misleading `'Invalid Date'`.
 */
export function formatReleaseDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return DATE_FORMATTER.format(parsed);
}

/**
 * Render a language code (`'en'` / `'jp'`) as an uppercase label
 * for chip + footnote use. Defensive — anything outside the
 * supported set passes through uppercased.
 */
export function languageLabel(language: string): string {
  if (language === 'en') return 'EN';
  if (language === 'jp') return 'JP';
  return language.toUpperCase();
}

/**
 * Human-readable label for a variant class. The DTO enum uses
 * SHOUTING_SNAKE; the UI rendering wants `'Holo'` / `'Reverse holo'`.
 */
export function variantClassLabel(variantClass: string): string {
  return variantClass
    .split('_')
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase())
    .join(' ');
}
