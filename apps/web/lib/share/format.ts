// Display helpers for the public shareable page.
//
// Pure (no I/O, no React) so tests can pin the formatting rules
// independently of a render. Matches the formatting conventions
// in `lib/collection/format.ts` so the same "X / Y owned" and
// "13.5%" copy reads identically across the auth-gated and
// public surfaces.

/**
 * Format a 0..100 percentage as a one-decimal string with a
 * trailing `%`. Mirrors `formatPercent` in
 * `lib/collection/format.ts` — kept in this file to avoid
 * importing from another stage's path inside production code
 * (the auth-gated path is owned by T-W-COLLECTION). The math is
 * identical; if a third caller emerges, lift this into
 * `@binderly/ui`.
 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0.0%';
  if (value > 100) return '100.0%';
  return `${value.toFixed(1)}%`;
}

/** "1,234 / 4,321 cards" — header tally copy. */
export function formatCardTally(owned: number, total: number): string {
  return `${formatInt(owned)} / ${formatInt(total)} cards`;
}

/** "1,234 cards owned" — concise OG-image variant. */
export function formatOwnedShort(owned: number): string {
  return owned === 1 ? '1 card owned' : `${formatInt(owned)} cards owned`;
}

/**
 * Composed header line: "12 / 102 cards · 11.8% complete". Used
 * verbatim in the page header AND the OG image so the unfurled
 * preview matches the live page.
 */
export function formatHeaderTally(
  ownedUnique: number,
  catalogTotal: number,
  completionPct: number,
): string {
  if (catalogTotal === 0) {
    return formatOwnedShort(ownedUnique);
  }
  return `${formatCardTally(ownedUnique, catalogTotal)} · ${formatPercent(completionPct)} complete`;
}

/**
 * "Last updated 2 days ago" — friendly relative time. Pure (no
 * `Date.now()` magic) so tests pass an explicit `now` for
 * deterministic output. Falls back to absolute `YYYY-MM-DD` for
 * dates > 30 days out so the social preview still says
 * something useful instead of "27 days ago".
 */
export function formatLastUpdated(iso: string, now: Date = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Recently updated';
  const ms = now.getTime() - parsed.getTime();
  if (ms < 60_000) return 'Just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} ${pluralize(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${pluralize(hours, 'hour')} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} ${pluralize(days, 'day')} ago`;
  // Long tail: render ISO date (no time) for crawler-friendly stability.
  return parsed.toISOString().slice(0, 10);
}

function pluralize(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function formatInt(n: number): string {
  // Locale-agnostic thousands separator so SSR matches client.
  // `Intl.NumberFormat('en-US')` is deterministic across runtimes.
  return new Intl.NumberFormat('en-US').format(n);
}

/**
 * Canonical public share URL — used in OG meta + a "Powered by
 * Binderly · /c/{handle}/{slug}" footer when we want the URL
 * visible on the page.
 */
export function publicShareUrl(handle: string, slug: string): string {
  return `/c/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}
