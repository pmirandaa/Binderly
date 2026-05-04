// Set code normalization. Sources often use different identifiers for
// the same set:
//
//   `swsh9`        ← TCGdex
//   `Brilliant Stars` ← human label
//   `BRS`          ← official TPCi short code
//
// We standardize on TCGdex's lowercase code (per
// `rules/01-data-layer.md`: "Standardize on TCGdex's codes"). Adapters
// that emit a different code map it back to the canonical form before
// computing canonical keys; the primary axis of truth is TCGdex's
// `id` field on a set.
//
// This module exposes:
//
//   - `normalizeSetCode(rawCode)` — defensive lower/strip; idempotent.
//   - `registerSetCodeAlias(source, sourceCode, canonicalCode)` —
//     adapters seed their per-source aliases at module load.
//   - `lookupCanonicalSetCode(source, sourceCode)` — returns the
//     canonical TCGdex code, or `null` if unknown.

export type SourceName =
  | 'tcgdex-en'
  | 'tcgdex-jp'
  | 'ptcgio'
  | 'bulbapedia-en'
  | 'pokellector'
  | 'serebii'
  | 'test';

const ALIAS_REGISTRY = new Map<SourceName, Map<string, string>>();

/**
 * Defensive lowercase + strip. Idempotent. Adapters that already
 * source codes from TCGdex don't need this — but defense in depth is
 * worth ~one line, and `canonical-keys.ts` performs the same step in
 * its own normalization to be robust across call sites.
 */
export function normalizeSetCode(rawCode: string): string {
  const cleaned = rawCode
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '');
  if (!cleaned) {
    throw new Error(
      `normalize/set-code: empty after normalization (input: ${JSON.stringify(rawCode)})`,
    );
  }
  return cleaned;
}

export function registerSetCodeAlias(
  source: SourceName,
  sourceCode: string,
  canonicalCode: string,
): void {
  let table = ALIAS_REGISTRY.get(source);
  if (!table) {
    table = new Map();
    ALIAS_REGISTRY.set(source, table);
  }
  table.set(sourceCode.trim().toLowerCase(), normalizeSetCode(canonicalCode));
}

/**
 * Map a per-source set code to the canonical (TCGdex) code. Returns
 * `null` if no alias registered. Most paths just call
 * `normalizeSetCode` on the source value; this helper exists for the
 * minority of adapters whose set codes differ structurally from
 * TCGdex (e.g. pokemontcg.io uses `swsh9` for the same set TCGdex
 * names `swsh9` — happy case — but uses different IDs for some
 * promo sets).
 */
export function lookupCanonicalSetCode(source: SourceName, sourceCode: string): string | null {
  const table = ALIAS_REGISTRY.get(source);
  if (!table) return null;
  return table.get(sourceCode.trim().toLowerCase()) ?? null;
}

/**
 * Reset the alias registry. Test-only.
 *
 * @internal
 */
export function _resetSetCodeAliasesForTests(): void {
  ALIAS_REGISTRY.clear();
}
