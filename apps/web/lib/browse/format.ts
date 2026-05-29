// Display helpers shared across the browse / set / card surfaces.
//
// Pure (no I/O, no React) so tests can pin the formatting rules
// without spinning up a render. Exposed from `lib/browse/` so any
// future surface that wants the same release-date / language /
// rarity copy can reuse it.

import type {
  Language,
  PrintingCurrentPriceFreshness,
  Rarity,
  SetDto,
} from '@binderly/api-contracts';

const RELEASE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/**
 * Format an ISO date (`YYYY-MM-DD`) as a short, locale-aware
 * release date — e.g. `Jan 5, 2024`. Returns the raw string
 * unchanged if it's not a parseable date so the UI never blanks
 * out a row over a single bad value.
 */
export function formatReleaseDate(iso: string, locale = 'en-US'): string {
  // Parse `YYYY-MM-DD` as a local date (not UTC) so users in
  // negative-UTC timezones don't see "Charizard released Mar 21"
  // when the catalog says 2024-03-22. ISO date-only strings
  // parsed via `Date.parse()` are interpreted as UTC midnight,
  // which then renders one day earlier in west-of-UTC zones.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return iso;
    return new Intl.DateTimeFormat(locale, RELEASE_DATE_FORMAT).format(new Date(ms));
  }
  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number.parseInt(yearRaw ?? '', 10);
  const month = Number.parseInt(monthRaw ?? '', 10);
  const day = Number.parseInt(dayRaw ?? '', 10);
  const local = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(locale, RELEASE_DATE_FORMAT).format(local);
}

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  jp: 'Japanese',
};

export function languageLabel(language: Language): string {
  return LANGUAGE_LABELS[language];
}

/**
 * Sort sets in display order: newest release_date first, then by
 * name as a deterministic tiebreaker so two sets that released on
 * the same day always render in the same order.
 *
 * This is THE Pablo regression test (rules/04-web.md hard rule).
 */
export function sortSetsByReleaseDateDesc(sets: readonly SetDto[]): SetDto[] {
  return [...sets].sort((a, b) => {
    if (a.releaseDate < b.releaseDate) return 1;
    if (a.releaseDate > b.releaseDate) return -1;
    return a.name.localeCompare(b.name);
  });
}

const RARITY_LABELS: Record<Rarity, string> = {
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  HOLO_RARE: 'Holo Rare',
  ULTRA_RARE: 'Ultra Rare',
  SECRET_RARE: 'Secret Rare',
  HYPER_RARE: 'Hyper Rare',
  RAINBOW_RARE: 'Rainbow Rare',
  SPECIAL_ILLUSTRATION_RARE: 'Special Illustration Rare',
  ILLUSTRATION_RARE: 'Illustration Rare',
  DOUBLE_RARE: 'Double Rare',
  RADIANT_RARE: 'Radiant Rare',
  AMAZING_RARE: 'Amazing Rare',
  PROMO: 'Promo',
};

export function rarityLabel(rarity: Rarity | null): string {
  if (rarity === null) return 'Unknown rarity';
  return RARITY_LABELS[rarity];
}

/**
 * Render the freshness band emitted by `printingCurrentPriceDto`
 * (T-BE-EDGE-FUNCTIONS-V2). Pre-bucketed server-side so SSR +
 * client + OG image render the same label.
 */
const FRESHNESS_LABELS: Record<PrintingCurrentPriceFreshness, string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  stale_old: 'Outdated',
};

export function freshnessLabel(freshness: PrintingCurrentPriceFreshness): string {
  return FRESHNESS_LABELS[freshness];
}

/**
 * Format the `computedAt` ISO timestamp from
 * `printingCurrentPriceDto` as a short "Apr 5, 2026" date — the
 * card-detail block surfaces this as supporting metadata under
 * the freshness badge. Reuses `RELEASE_DATE_FORMAT` so the same
 * locale rules apply.
 */
export function formatCurrentPriceComputedAt(iso: string, locale = 'en-US'): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat(locale, RELEASE_DATE_FORMAT).format(new Date(ms));
}

/**
 * Format the `lastObservationAt` ISO timestamp from
 * `printingCurrentPriceDto` (the `mv_current_price` v2 enrichment,
 * migration `0028` / #FU-5) as a short "Apr 5, 2026" date.
 *
 * This is the truest "last seen in the wild" recency — `MAX(observed_at)`
 * from the raw observation log — surfaced as the "Last seen" line on the
 * card-detail price block (Q-028 resolution: the headline `freshness`
 * band stays anchored on `computedAt` for backward-compatibility, while
 * `lastObservationAt` is exposed explicitly so users still get
 * observation recency without re-tuning the freshness buckets).
 *
 * Returns `null` for missing / null / unparseable input so the caller
 * can suppress the whole line rather than render a bad date.
 */
export function formatLastSeenAt(
  iso: string | null | undefined,
  locale = 'en-US',
): string | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat(locale, RELEASE_DATE_FORMAT).format(new Date(ms));
}

/**
 * Pick the user-visible name of a printing for alt text /
 * tooltips. Falls back to the variant key when the parent card
 * isn't joined.
 */
export function printingDisplayName(args: {
  cardName: string;
  cardNumber: string;
  variantClass: string;
}): string {
  const variant = args.variantClass.toLowerCase().replace(/_/g, ' ');
  return `${args.cardName} #${args.cardNumber} (${variant})`;
}
