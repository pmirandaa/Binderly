// Small formatting helpers for the `/collections/custom` surfaces.
// Pure functions; safe to call from RSC, client components, and
// tests alike.

/**
 * Slugify a free-form collection name into a value that satisfies
 * the `slugSchema` regex (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 64
 * chars). The contract is enforced server-side; we generate a
 * conservative slug client-side so the create modal "just works"
 * without an extra slug field.
 *
 * Falls back to `'collection'` when the input has no
 * alphanumeric characters (e.g. `'  ---'`) — the empty result
 * would otherwise fail the contract's `min(1)` check at the API.
 */
export function slugify(input: string): string {
  const lowered = input.toLowerCase();
  const cleaned = lowered
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned.length === 0) return 'collection';
  return cleaned.length > 64 ? cleaned.slice(0, 64).replace(/-+$/, '') : cleaned;
}

/**
 * Format the relative or absolute "last updated" timestamp shown
 * on the list rows. We keep this stable and locale-aware so tests
 * can assert on substrings without snapshotting the entire string.
 */
export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  return `Updated ${date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

/**
 * Pluralize "card" / "cards" with the given count.
 */
export function memberCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

export interface CapStatus {
  readonly used: number;
  readonly cap: number;
  readonly atCap: boolean;
}

/**
 * Compute "X / N used" cap state for the list header. Pulled into
 * a helper because the same shape powers both the header copy
 * and the disabled-button branch.
 */
export function computeCapStatus(used: number, cap: number): CapStatus {
  return {
    used,
    cap,
    atCap: used >= cap,
  };
}
