// Display helpers for the `/collection` surfaces.
//
// Pure (no I/O, no React) so tests can pin the formatting rules
// without a render. The percentage formatter matches the data-model
// "numeric(5,2)" rounding rule (`PROJECT.md § 8` writes
// percentages as integers + one decimal — "13.5%"); the count
// formatter matches the brief's literal "12 / 102 owned" copy.

import type { CardCondition, Language } from '@binderly/api-contracts';

/**
 * Format a 0..100 percentage as a one-decimal string with a
 * trailing `%`. Matches the `numeric(5,2)` rounding rule documented
 * in `@binderly/set-completion`'s README — the math returns full
 * precision; the UI rounds at display time.
 *
 * Returns `'0.0%'` for a NaN / Infinity / negative input so empty
 * collections render predictably.
 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0.0%';
  return `${value.toFixed(1)}%`;
}

/** "12 / 102 owned" — the per-set tally copy from the brief. */
export function formatOwnedCount(owned: number, total: number): string {
  return `${owned} / ${total} owned`;
}

/** "247 / 1832" — global tally inside the completion badge. */
export function formatGlobalCount(owned: number, total: number): string {
  return `${owned} / ${total}`;
}

const CONDITION_LABELS: Record<CardCondition, string> = {
  NEAR_MINT: 'NM',
  LIGHTLY_PLAYED: 'LP',
  MODERATELY_PLAYED: 'MP',
  HEAVILY_PLAYED: 'HP',
  DAMAGED: 'DMG',
  UNKNOWN: 'Raw',
};

export function conditionLabel(condition: CardCondition): string {
  return CONDITION_LABELS[condition];
}

const LANGUAGE_BADGE: Record<Language, string> = {
  en: 'EN',
  jp: 'JP',
};

export function languageBadge(language: Language): string {
  return LANGUAGE_BADGE[language];
}

/**
 * Sort entries by completion % descending, then by release_date
 * descending (most recent first) as the deterministic tiebreaker.
 * Pablo's set-list rule (rules/04-web.md "default sort:
 * release_date desc") is preserved when two sets share a
 * completion %.
 */
export interface SortableSetRow {
  readonly completionPct: number;
  readonly releaseDate: string;
  readonly setId: string;
}

export function sortByCompletionThenRelease<T extends SortableSetRow>(
  rows: ReadonlyArray<T>,
): T[] {
  return [...rows].sort((a, b) => {
    if (a.completionPct > b.completionPct) return -1;
    if (a.completionPct < b.completionPct) return 1;
    if (a.releaseDate > b.releaseDate) return -1;
    if (a.releaseDate < b.releaseDate) return 1;
    return a.setId.localeCompare(b.setId);
  });
}
