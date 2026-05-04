// `enumerateSets` — pull `RawSet[]` from every adapter, partition by
// tier, run the resolver, return `CanonicalSet[]` + per-source raw
// records (so downstream stages can re-enumerate cards by the
// adapter's own set key).
//
// Behaviours:
//
//   - Each adapter's `listSets()` is wrapped in try/catch; a throw on
//     ONE adapter logs an `enumerate_sets` error and contributes
//     `[]` to the resolver. The other adapters proceed.
//   - The resolver's conflict log is forwarded to the reporter
//     (per-source counters + global conflict tally).

import { Reporter } from './report.js';
import { type AdapterLogger, type SourceAdapter } from '../../interfaces/adapter.js';
import { resolveCanonicalSets, type TieredRecords } from '../../resolver/resolver.js';

import type { CanonicalSet, DataConflict, RawSet } from '../../types.js';

export interface EnumerateSetsResult {
  /** Canonical sets keyed by `canonicalKey` for downstream lookup. */
  readonly canonicalSets: ReadonlyArray<CanonicalSet>;
  /**
   * Per-adapter raw sets, indexed by adapter name. Downstream stages
   * use this to call `adapter.listCardsForSet(rawSet.sourceKey)` —
   * the adapter's own set key is preserved on `RawSet.sourceKey`.
   */
  readonly rawByAdapter: ReadonlyMap<string, ReadonlyArray<RawSet>>;
}

export async function enumerateSets(
  adapters: ReadonlyArray<SourceAdapter>,
  reporter: Reporter,
  logger: AdapterLogger,
): Promise<EnumerateSetsResult> {
  const tiered: TieredRecords<RawSet> = { primary: [], validation: [], filler: [] };
  const rawByAdapter = new Map<string, RawSet[]>();

  for (const adapter of adapters) {
    reporter.registerSource(adapter.name, adapter.tier);
    try {
      const sets = await reporter.time('enumerate_sets', () => adapter.listSets());
      rawByAdapter.set(adapter.name, sets);
      tiered[adapter.tier].push(...sets);
      reporter.incPerSource(adapter.name, 'setsEnumerated', sets.length);
      logger.info(
        { source: adapter.name, tier: adapter.tier, count: sets.length },
        'seed.enumerate_sets.ok',
      );
    } catch (cause) {
      reporter.recordError({ kind: 'enumerate_sets', source: adapter.name, cause });
      logger.error(
        { source: adapter.name, tier: adapter.tier, err: describeError(cause) },
        'seed.enumerate_sets.failed',
      );
      rawByAdapter.set(adapter.name, []);
    }
  }

  const conflicts: DataConflict[] = [];
  const { canonical } = resolveCanonicalSets(tiered, {
    onConflict: (c) => {
      conflicts.push(c);
      reporter.recordResolverConflicts('set', c.chosenSource, 1);
    },
  });

  for (const set of canonical) {
    reporter.recordResolverAgreements(set.sourceMetadata);
  }

  logger.info(
    {
      adapters: adapters.length,
      raw_primary: tiered.primary.length,
      raw_validation: tiered.validation.length,
      raw_filler: tiered.filler.length,
      canonical: canonical.length,
      conflicts: conflicts.length,
    },
    'seed.enumerate_sets.resolved',
  );

  return { canonicalSets: canonical, rawByAdapter };
}

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'unknown', message: String(err) };
}
