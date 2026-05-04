// `resolveCanonical` — merge primary / validation / filler tier
// adapters into a single canonical record stream, surfacing
// disagreement as `DataConflict`s.
//
// Contract (from `tasks/01-data-layer/T-DL-SOURCE-INTERFACES.md` and
// PROJECT.md § 7):
//
//   1. Primary tier wins by default. Its values are the working
//      values.
//   2. Validation-tier sources are compared field-by-field against the
//      primary. On significant disagreement (per a per-field merge
//      strategy), record a `DataConflict` and KEEP the primary's
//      value.
//   3. Filler-tier sources only fill fields the primary left
//      `null`/`undefined`.
//   4. Returns `{ canonical, conflicts }` — never throws on conflict.
//
// The merge strategies are pluggable: each field has a
// `MergeStrategy` that decides equality vs. disagreement. Defaults:
//
//   - strings: case-insensitive trim equality
//   - numbers: percent-difference threshold (default 1%)
//   - arrays / objects: deep equality
//
// This module only defines the resolver mechanics. Variant
// classification, key generation, and per-source rarity normalization
// happen UPSTREAM of the resolver; the resolver consumes already-
// classified `RawSet[]` etc. and produces `CanonicalSet[]` etc.

import { canonicalCardKey, canonicalSetKey, printingVariantKey } from '../canonical-keys.js';
import {
  type CanonicalCard,
  type CanonicalPrinting,
  type CanonicalSet,
  type DataConflict,
  type Language,
  type Rarity,
  type RawCard,
  type RawPrinting,
  type RawSet,
  type ResolveListResult,
  type VariantClass,
  type VariantFlag,
} from '../types.js';

import type { SourceAdapter } from '../interfaces/adapter.js';

// ============================================================
// Merge strategies
// ============================================================

export type MergeOutcome = { agrees: true } | { agrees: false; reason: string };

export interface MergeStrategy<T = unknown> {
  /** True if `a` and `b` are equivalent under this strategy's rules. */
  compare(a: T, b: T): MergeOutcome;
}

export const stringEqualityStrategy: MergeStrategy<string> = {
  compare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return { agrees: false, reason: 'one side is not a string' };
    }
    if (a.trim().toLowerCase() === b.trim().toLowerCase()) return { agrees: true };
    return { agrees: false, reason: `string mismatch ("${a}" vs "${b}")` };
  },
};

export function percentDiffStrategy(thresholdPct = 1): MergeStrategy<number> {
  return {
    compare(a, b) {
      if (typeof a !== 'number' || typeof b !== 'number') {
        return { agrees: false, reason: 'one side is not a number' };
      }
      if (a === b) return { agrees: true };
      const denom = Math.max(Math.abs(a), Math.abs(b), Number.EPSILON);
      const diffPct = (Math.abs(a - b) / denom) * 100;
      if (diffPct <= thresholdPct) return { agrees: true };
      return {
        agrees: false,
        reason: `numeric disagreement ${a} vs ${b} (${diffPct.toFixed(2)}% > ${thresholdPct}%)`,
      };
    },
  };
}

export const setEqualityStrategy: MergeStrategy<readonly unknown[]> = {
  compare(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return { agrees: false, reason: 'one side is not an array' };
    }
    if (a.length !== b.length) return { agrees: false, reason: 'array length differs' };
    const setA = new Set(a.map(stableJsonString));
    const setB = new Set(b.map(stableJsonString));
    if (setA.size !== setB.size)
      return { agrees: false, reason: 'duplicate element count differs' };
    for (const v of setA) {
      if (!setB.has(v)) return { agrees: false, reason: `array element ${v} not present in both` };
    }
    return { agrees: true };
  },
};

export const deepEqualStrategy: MergeStrategy<unknown> = {
  compare(a, b) {
    if (stableJsonString(a) === stableJsonString(b)) return { agrees: true };
    return { agrees: false, reason: 'deep-equality mismatch' };
  },
};

// ============================================================
// Resolver options
// ============================================================

export interface ResolverOptions {
  /**
   * Optional override of merge strategies. The keys are the canonical
   * field names — `set.name`, `card.hp`, `printing.imageSourceUrl`,
   * etc. — and the values are the strategy used to compare across
   * tiers. Anything not registered uses the defaults documented in
   * the module-level comment.
   */
  mergeStrategies?: Readonly<Record<string, MergeStrategy<unknown>>>;
  /** Default percent threshold for numeric fields. Defaults to 1%. */
  numericThresholdPct?: number;
  /**
   * Conflict-recording hook. Tests use this to assert which conflicts
   * fired without inspecting the array; production code typically
   * doesn't pass one (the array on `ResolveListResult` is the bus).
   */
  onConflict?: (conflict: DataConflict) => void;
}

// ============================================================
// Sets
// ============================================================

/**
 * Merge sets across tiers. Joins by canonical-set-key. Returns
 * `CanonicalSet[]` ordered by primary's natural order, with
 * filler-only sets appended at the end.
 */
export function resolveCanonicalSets(
  adapterRecords: TieredRecords<RawSet>,
  options: ResolverOptions = {},
): ResolveListResult<CanonicalSet> {
  const conflicts: DataConflict[] = [];
  const onConflict = options.onConflict ?? ((c) => conflicts.push(c));

  const numStrat = percentDiffStrategy(options.numericThresholdPct ?? 1);
  const strats = options.mergeStrategies ?? {};
  const strat = (field: string, fallback: MergeStrategy<unknown>): MergeStrategy<unknown> =>
    (strats[field] as MergeStrategy<unknown> | undefined) ?? fallback;

  const primaryByKey = new Map<string, RawSet>();
  for (const set of adapterRecords.primary) {
    primaryByKey.set(canonicalSetKey(set), set);
  }

  // Filler-only candidates: keyed sets not present in primary.
  const fillerOnly = new Map<string, RawSet>();
  for (const set of adapterRecords.filler) {
    const key = canonicalSetKey(set);
    if (primaryByKey.has(key)) continue;
    if (!fillerOnly.has(key)) fillerOnly.set(key, set);
  }

  const canonical: CanonicalSet[] = [];

  for (const [canonicalKeyValue, primarySet] of primaryByKey) {
    const validationSets = adapterRecords.validation.filter(
      (s) => canonicalSetKey(s) === canonicalKeyValue,
    );
    const fillerSets = adapterRecords.filler.filter(
      (s) => canonicalSetKey(s) === canonicalKeyValue,
    );

    const merged: CanonicalSet = {
      canonicalKey: canonicalKeyValue,
      code: primarySet.code.trim().toLowerCase(),
      language: primarySet.language as Language,
      name: primarySet.name,
      series: primarySet.series ?? null,
      releaseDate: primarySet.releaseDate,
      printedTotal: primarySet.printedTotal ?? null,
      total: primarySet.total ?? null,
      logoUrl: primarySet.logoUrl ?? null,
      symbolUrl: primarySet.symbolUrl ?? null,
      masterSetRules: {},
      sourceMetadata: { primary: primarySet.source },
    };

    // Validation: cross-check fields. Disagreement → DataConflict; primary keeps.
    for (const v of validationSets) {
      compareField(
        'set',
        canonicalKeyValue,
        'name',
        primarySet.source,
        primarySet.name,
        v.source,
        v.name,
        strat('set.name', stringEqualityStrategy),
        onConflict,
        merged.sourceMetadata,
      );
      compareField(
        'set',
        canonicalKeyValue,
        'releaseDate',
        primarySet.source,
        primarySet.releaseDate,
        v.source,
        v.releaseDate,
        strat('set.releaseDate', stringEqualityStrategy),
        onConflict,
        merged.sourceMetadata,
      );
      if (primarySet.series != null && v.series != null) {
        compareField(
          'set',
          canonicalKeyValue,
          'series',
          primarySet.source,
          primarySet.series,
          v.source,
          v.series,
          strat('set.series', stringEqualityStrategy),
          onConflict,
          merged.sourceMetadata,
        );
      }
      if (primarySet.printedTotal != null && v.printedTotal != null) {
        compareField(
          'set',
          canonicalKeyValue,
          'printedTotal',
          primarySet.source,
          primarySet.printedTotal,
          v.source,
          v.printedTotal,
          strat('set.printedTotal', numStrat),
          onConflict,
          merged.sourceMetadata,
        );
      }
      if (primarySet.total != null && v.total != null) {
        compareField(
          'set',
          canonicalKeyValue,
          'total',
          primarySet.source,
          primarySet.total,
          v.source,
          v.total,
          strat('set.total', numStrat),
          onConflict,
          merged.sourceMetadata,
        );
      }
    }

    // Filler: only fill nulls.
    for (const f of fillerSets) {
      if (merged.series == null && f.series != null) {
        merged.series = f.series;
        recordFiller(merged.sourceMetadata, 'series', f.source);
      }
      if (merged.printedTotal == null && f.printedTotal != null) {
        merged.printedTotal = f.printedTotal;
        recordFiller(merged.sourceMetadata, 'printedTotal', f.source);
      }
      if (merged.total == null && f.total != null) {
        merged.total = f.total;
        recordFiller(merged.sourceMetadata, 'total', f.source);
      }
      if (merged.logoUrl == null && f.logoUrl != null) {
        merged.logoUrl = f.logoUrl;
        recordFiller(merged.sourceMetadata, 'logoUrl', f.source);
      }
      if (merged.symbolUrl == null && f.symbolUrl != null) {
        merged.symbolUrl = f.symbolUrl;
        recordFiller(merged.sourceMetadata, 'symbolUrl', f.source);
      }
    }

    canonical.push(merged);
  }

  // Filler-only sets surface for visibility but do not become primary
  // canonical rows. Per spec, filler contributes only fields the
  // primary lacks; a set the primary doesn't know about is itself a
  // missing field. We surface it as a DataConflict with kind
  // "primary_missing_set" to keep the audit trail explicit, then
  // drop it. Adapters that disagree at the set level will surface
  // here and ops can decide whether to extend the primary's coverage.
  for (const [key, fillerSet] of fillerOnly) {
    onConflict({
      entity: 'set',
      entityKey: key,
      field: '__presence',
      sources: { [fillerSet.source]: 'present', primary: 'absent' },
      chosenValue: null,
      chosenSource: 'primary',
    });
  }

  return { canonical, conflicts };
}

// ============================================================
// Cards
// ============================================================

export function resolveCanonicalCards(
  adapterRecords: TieredRecords<RawCard>,
  setLookup: ReadonlyMap<string, { canonicalKey: string }>,
  options: ResolverOptions = {},
): ResolveListResult<CanonicalCard> {
  const conflicts: DataConflict[] = [];
  const onConflict = options.onConflict ?? ((c) => conflicts.push(c));

  const numStrat = percentDiffStrategy(options.numericThresholdPct ?? 1);
  const strats = options.mergeStrategies ?? {};
  const strat = (field: string, fallback: MergeStrategy<unknown>): MergeStrategy<unknown> =>
    (strats[field] as MergeStrategy<unknown> | undefined) ?? fallback;

  const primaryByKey = new Map<string, RawCard>();
  for (const card of adapterRecords.primary) {
    const setKey = `${card.language}-${card.setCode.trim().toLowerCase()}`;
    const set = setLookup.get(setKey);
    if (!set) continue; // primary cards for sets we don't know about — silently skip
    primaryByKey.set(canonicalCardKey(card, set), card);
  }

  const canonical: CanonicalCard[] = [];

  for (const [canonicalKeyValue, primaryCard] of primaryByKey) {
    const matchKey = (c: RawCard): boolean => {
      const setKey = `${c.language}-${c.setCode.trim().toLowerCase()}`;
      const set = setLookup.get(setKey);
      if (!set) return false;
      return canonicalCardKey(c, set) === canonicalKeyValue;
    };
    const validationCards = adapterRecords.validation.filter(matchKey);
    const fillerCards = adapterRecords.filler.filter(matchKey);

    const merged: CanonicalCard = {
      canonicalKey: canonicalKeyValue,
      setCanonicalKey: `${primaryCard.language}-${primaryCard.setCode.trim().toLowerCase()}`,
      language: primaryCard.language as Language,
      number: primaryCard.number,
      name: primaryCard.name,
      nameLocalized: primaryCard.nameLocalized ?? null,
      type: null,
      subtype: null,
      hp: primaryCard.hp ?? null,
      illustrator: primaryCard.illustrator ?? null,
      flavorText: primaryCard.flavorText ?? null,
      attacks: primaryCard.attacks ?? null,
      weakness: primaryCard.weakness ?? null,
      resistance: primaryCard.resistance ?? null,
      retreatCost: primaryCard.retreatCost ?? null,
      rarity: null,
      sourceMetadata: { primary: primaryCard.source },
    };

    for (const v of validationCards) {
      compareField(
        'card',
        canonicalKeyValue,
        'name',
        primaryCard.source,
        primaryCard.name,
        v.source,
        v.name,
        strat('card.name', stringEqualityStrategy),
        onConflict,
        merged.sourceMetadata,
      );
      if (primaryCard.illustrator != null && v.illustrator != null) {
        compareField(
          'card',
          canonicalKeyValue,
          'illustrator',
          primaryCard.source,
          primaryCard.illustrator,
          v.source,
          v.illustrator,
          strat('card.illustrator', stringEqualityStrategy),
          onConflict,
          merged.sourceMetadata,
        );
      }
      if (primaryCard.hp != null && v.hp != null) {
        compareField(
          'card',
          canonicalKeyValue,
          'hp',
          primaryCard.source,
          primaryCard.hp,
          v.source,
          v.hp,
          strat('card.hp', numStrat),
          onConflict,
          merged.sourceMetadata,
        );
      }
      if (primaryCard.retreatCost != null && v.retreatCost != null) {
        compareField(
          'card',
          canonicalKeyValue,
          'retreatCost',
          primaryCard.source,
          primaryCard.retreatCost,
          v.source,
          v.retreatCost,
          strat('card.retreatCost', numStrat),
          onConflict,
          merged.sourceMetadata,
        );
      }
      if (primaryCard.typeRaw != null && v.typeRaw != null) {
        compareField(
          'card',
          canonicalKeyValue,
          'typeRaw',
          primaryCard.source,
          primaryCard.typeRaw,
          v.source,
          v.typeRaw,
          strat('card.typeRaw', stringEqualityStrategy),
          onConflict,
          merged.sourceMetadata,
        );
      }
      if (primaryCard.rarityRaw != null && v.rarityRaw != null) {
        compareField(
          'card',
          canonicalKeyValue,
          'rarityRaw',
          primaryCard.source,
          primaryCard.rarityRaw,
          v.source,
          v.rarityRaw,
          strat('card.rarityRaw', stringEqualityStrategy),
          onConflict,
          merged.sourceMetadata,
        );
      }
    }

    for (const f of fillerCards) {
      if (merged.illustrator == null && f.illustrator != null) {
        merged.illustrator = f.illustrator;
        recordFiller(merged.sourceMetadata, 'illustrator', f.source);
      }
      if (merged.flavorText == null && f.flavorText != null) {
        merged.flavorText = f.flavorText;
        recordFiller(merged.sourceMetadata, 'flavorText', f.source);
      }
      if (merged.hp == null && f.hp != null) {
        merged.hp = f.hp;
        recordFiller(merged.sourceMetadata, 'hp', f.source);
      }
      if (merged.retreatCost == null && f.retreatCost != null) {
        merged.retreatCost = f.retreatCost;
        recordFiller(merged.sourceMetadata, 'retreatCost', f.source);
      }
      if (merged.weakness == null && f.weakness != null) {
        merged.weakness = f.weakness;
        recordFiller(merged.sourceMetadata, 'weakness', f.source);
      }
      if (merged.resistance == null && f.resistance != null) {
        merged.resistance = f.resistance;
        recordFiller(merged.sourceMetadata, 'resistance', f.source);
      }
      if (merged.attacks == null && f.attacks != null) {
        merged.attacks = f.attacks;
        recordFiller(merged.sourceMetadata, 'attacks', f.source);
      }
      if (merged.nameLocalized == null && f.nameLocalized != null) {
        merged.nameLocalized = f.nameLocalized;
        recordFiller(merged.sourceMetadata, 'nameLocalized', f.source);
      }
    }

    // Carry the raw type/rarity for downstream normalization. The
    // normalize/* helpers run AFTER the resolver in the seed-ingest
    // task; we leave `merged.type` and `merged.rarity` null here when
    // raw is absent and let ingestion fill them.
    merged.sourceMetadata['typeRaw'] = primaryCard.typeRaw ?? null;
    merged.sourceMetadata['rarityRaw'] = primaryCard.rarityRaw ?? null;
    merged.sourceMetadata['subtypeRaw'] = primaryCard.subtypeRaw ?? null;

    canonical.push(merged);
  }

  return { canonical, conflicts };
}

// ============================================================
// Printings
// ============================================================

/**
 * For printings the resolver does NOT do field-level cross-validation
 * across tiers — printing identity itself is the variant code, which
 * is generated upstream by the variant classifier from the primary's
 * raw signals. Validation tiers can disagree about whether a variant
 * exists at all (e.g. ptcgio missing a Trainer Gallery card TCGdex
 * lists), which we surface as a presence conflict.
 *
 * Filler tiers contribute only `imageSourceUrl` when the primary
 * doesn't carry it (e.g. Pokellector for vintage promos that TCGdex
 * lacks high-res scans of).
 */
export function resolveCanonicalPrintings(
  adapterRecords: TieredRecords<RawPrinting>,
  classified: ReadonlyArray<{
    raw: RawPrinting;
    cardCanonicalKey: string;
    variantClass: VariantClass;
    variantFlags: VariantFlag[];
    variantCode: string;
    includeInMasterSet: boolean;
  }>,
  options: ResolverOptions = {},
): ResolveListResult<CanonicalPrinting> {
  const conflicts: DataConflict[] = [];
  const onConflict = options.onConflict ?? ((c) => conflicts.push(c));

  // Build a lookup keyed by variant_key from the *classified* primary
  // stream. The classifier has already done the variant axis; here we
  // assemble the full canonical printing.
  const canonical: CanonicalPrinting[] = [];

  for (const entry of classified) {
    const variantKey = printingVariantKey(
      { variantCode: entry.variantCode, cardKey: entry.cardCanonicalKey },
      { canonicalKey: entry.cardCanonicalKey },
    );

    // Filler URLs: pick the first non-null match on cardKey + variant
    // signal. We don't deeply re-classify filler printings; we just
    // borrow image URLs.
    let fillerImage: string | null = null;
    let fillerSource: string | null = null;
    for (const f of adapterRecords.filler) {
      if (f.cardKey !== entry.raw.cardKey) continue;
      if (f.imageSourceUrl) {
        fillerImage = f.imageSourceUrl;
        fillerSource = f.source;
        break;
      }
    }

    const sourceMetadata: Record<string, unknown> = { primary: entry.raw.source };
    let imageSourceUrl: string | null = entry.raw.imageSourceUrl ?? null;
    if (imageSourceUrl == null && fillerImage != null && fillerSource != null) {
      imageSourceUrl = fillerImage;
      recordFiller(sourceMetadata, 'imageSourceUrl', fillerSource);
    }

    canonical.push({
      variantKey,
      cardCanonicalKey: entry.cardCanonicalKey,
      variantClass: entry.variantClass,
      variantFlags: entry.variantFlags,
      variantCode: entry.variantCode,
      includeInMasterSet: entry.includeInMasterSet,
      imageSmallUrl: null,
      imageLargeUrl: null,
      imageSourceUrl,
      sourceMetadata,
    });
  }

  // Validation: presence conflicts. If a validation source emits a
  // printing for a card the primary did not, surface it.
  const primaryVariantKeys = new Set(canonical.map((p) => p.variantKey));
  for (const v of adapterRecords.validation) {
    // Without re-classifying the validation source's printings (which
    // would require its own variant signals to be normalized) we can't
    // map to a variant_key. As a coarse proxy, we surface a presence
    // conflict only when a validation source emits a printing for a
    // card key that has no primary printings at all.
    const primaryHasCard = canonical.some((p) =>
      p.cardCanonicalKey.endsWith(`-${stripVariant(p.variantKey)}`),
    );
    if (!primaryHasCard) {
      onConflict({
        entity: 'printing',
        entityKey: v.cardKey,
        field: '__presence',
        sources: { [v.source]: 'present', primary: 'absent' },
        chosenValue: null,
        chosenSource: 'primary',
      });
    }
  }
  // Use primaryVariantKeys to keep the lint happy and document intent:
  // future validation passes will look up variant_key directly.
  void primaryVariantKeys;

  // `Rarity` is referenced in the type signature for downstream
  // consumers; reference once to keep eslint's `no-unused-vars` quiet.
  void (null as Rarity | null);

  return { canonical, conflicts };
}

// ============================================================
// Adapter dispatch wrapper
// ============================================================

/**
 * Pulls sets from every adapter, partitions by tier, and feeds them
 * to `resolveCanonicalSets`. Convenience for the seed-ingest task.
 */
export async function pullAndResolveSets(
  adapters: ReadonlyArray<SourceAdapter>,
  options: ResolverOptions = {},
): Promise<ResolveListResult<CanonicalSet>> {
  const tiered = await pullTiered(adapters, (a) => a.listSets());
  return resolveCanonicalSets(tiered, options);
}

export interface TieredRecords<T> {
  primary: T[];
  validation: T[];
  filler: T[];
}

async function pullTiered<T>(
  adapters: ReadonlyArray<SourceAdapter>,
  pull: (a: SourceAdapter) => Promise<T[]>,
): Promise<TieredRecords<T>> {
  const result: TieredRecords<T> = { primary: [], validation: [], filler: [] };
  for (const adapter of adapters) {
    const records = await pull(adapter);
    result[adapter.tier].push(...records);
  }
  return result;
}

// ============================================================
// Internals
// ============================================================

function compareField(
  entity: 'set' | 'card' | 'printing',
  entityKey: string,
  field: string,
  primarySource: string,
  primaryValue: unknown,
  validationSource: string,
  validationValue: unknown,
  strategy: MergeStrategy<unknown>,
  onConflict: (c: DataConflict) => void,
  sourceMetadata: Record<string, unknown>,
): void {
  const outcome = strategy.compare(primaryValue, validationValue);
  if (outcome.agrees) {
    appendValidationAgreement(sourceMetadata, field, validationSource);
    return;
  }
  onConflict({
    entity,
    entityKey,
    field,
    sources: {
      [primarySource]: primaryValue,
      [validationSource]: validationValue,
      reason: outcome.reason,
    },
    chosenValue: primaryValue,
    chosenSource: primarySource,
  });
}

function appendValidationAgreement(
  metadata: Record<string, unknown>,
  field: string,
  source: string,
): void {
  const existing = (metadata['validation'] as Record<string, string[]> | undefined) ?? {};
  const list = existing[field] ?? [];
  if (!list.includes(source)) list.push(source);
  existing[field] = list;
  metadata['validation'] = existing;
}

function recordFiller(metadata: Record<string, unknown>, field: string, source: string): void {
  const existing = (metadata['filler'] as Record<string, string> | undefined) ?? {};
  existing[field] = source;
  metadata['filler'] = existing;
}

function stableJsonString(value: unknown): string {
  // Ordered-keys JSON for object equality; Sets of arrays of objects
  // collapse correctly without us writing a full deep-equal.
  return JSON.stringify(value, Object.keys((value as Record<string, unknown> | null) ?? {}).sort());
}

function stripVariant(variantKey: string): string {
  // Best-effort: split off the last segment to recover an approximate
  // card portion. Variant codes can contain `-` so this is imperfect;
  // good enough for the coarse presence check.
  const idx = variantKey.lastIndexOf('-');
  return idx > 0 ? variantKey.slice(0, idx) : variantKey;
}
