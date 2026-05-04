// `Reporter` — accumulates per-stage timings, per-source counters,
// resolver agreement / conflict tallies, master-set decision counts,
// image-pipeline outcomes, DB upsert counts, and the typed error log.
//
// The reporter is `runSeedIngest`'s observability surface: tests
// snapshot its serialized JSON, the CLI prints a one-page summary,
// and the JSON file in `data-pipeline/scripts/output/` is the
// historical record per run.
//
// Timings: per stage we record the per-call duration and on
// `finalize()` compute p50 / p95 / p99 / count. The histogram is
// kept as a plain `number[]` because the catalog has at most ~10⁵
// printings — well below the threshold where a t-digest would be
// worth the dep.

import { formatSeedRunError, type SeedRunError } from './errors.js';

import type { AdapterTier, VariantClass } from '../../types.js';

// ============================================================
// Public types
// ============================================================

/**
 * Subset of `SeedOptions` echoed back into the report so the JSON file
 * is self-describing without having to cross-reference the CLI invocation.
 */
export interface SeedRunReportOptions {
  readonly sources: ReadonlyArray<string> | 'all';
  readonly sets: ReadonlyArray<string> | 'all';
  readonly limitSets: number | null;
  readonly limitCards: number | null;
  readonly dryRun: boolean;
  readonly noImages: boolean;
  readonly setConcurrency: number;
  readonly imageConcurrency: number;
}

export interface PerSourceReport {
  readonly tier: AdapterTier;
  setsEnumerated: number;
  cardsFetched: number;
  printingsFetched: number;
  resolverConflicts: number;
}

export interface ResolverReport {
  setConflicts: number;
  cardConflicts: number;
  printingConflicts: number;
  /**
   * Per `validating_source → field → count` map of agreements
   * recorded on canonical records' `sourceMetadata.validation`.
   */
  agreementsBySource: Record<string, Record<string, number>>;
}

export interface MasterSetReport {
  decided: number;
  included: number;
  excluded: number;
  overridesApplied: number;
}

export interface ImagePipelineReport {
  transcoded: number;
  cached: number;
  skippedNoUrl: number;
  skippedExcludedSource: number;
  errors: number;
}

export interface DbReport {
  setsUpserted: number;
  cardsUpserted: number;
  printingsUpserted: number;
}

export type SeedTimingStage =
  | 'enumerate_sets'
  | 'fetch_cards'
  | 'resolve_classify'
  | 'image_pipeline'
  | 'db_upsert';

export interface StageTiming {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  totalMs: number;
}

export interface SeedRunReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly options: SeedRunReportOptions;
  readonly perSource: Record<string, PerSourceReport>;
  readonly resolver: ResolverReport;
  readonly variantClassDistribution: Record<VariantClass, number>;
  readonly masterSet: MasterSetReport;
  readonly imagePipeline: ImagePipelineReport;
  readonly db: DbReport;
  readonly timings: Record<SeedTimingStage, StageTiming>;
  readonly errors: ReadonlyArray<SeedRunError>;
  readonly errorsTopN: ReadonlyArray<SeedRunError>;
}

// ============================================================
// Reporter implementation
// ============================================================

const ZERO_VARIANT_DISTRIBUTION: Readonly<Record<VariantClass, number>> = Object.freeze({
  HOLO: 0,
  NON_HOLO: 0,
  REVERSE_HOLO: 0,
  FULL_ART: 0,
  ALT_ART: 0,
  SECRET_RARE: 0,
  GOLD: 0,
  RAINBOW: 0,
  TEXTURED: 0,
  TRAINER_GALLERY: 0,
  PROMO: 0,
});

const TOP_N_ERRORS = 10;

/**
 * Mutable accumulator the per-stage modules write to. `finalize()`
 * snapshots into the immutable `SeedRunReport` shape. The reporter
 * exposes a small `time(stage, fn)` helper so callers don't have to
 * thread `Date.now()` plumbing through every call site.
 */
export class Reporter {
  private readonly startedAtMs: number;
  private readonly options: SeedRunReportOptions;
  private readonly perSource: Map<string, PerSourceReport> = new Map();
  private readonly resolver: ResolverReport = {
    setConflicts: 0,
    cardConflicts: 0,
    printingConflicts: 0,
    agreementsBySource: {},
  };
  private readonly variantDistribution: Record<VariantClass, number> = {
    ...ZERO_VARIANT_DISTRIBUTION,
  };
  private readonly masterSet: MasterSetReport = {
    decided: 0,
    included: 0,
    excluded: 0,
    overridesApplied: 0,
  };
  private readonly imagePipeline: ImagePipelineReport = {
    transcoded: 0,
    cached: 0,
    skippedNoUrl: 0,
    skippedExcludedSource: 0,
    errors: 0,
  };
  private readonly db: DbReport = {
    setsUpserted: 0,
    cardsUpserted: 0,
    printingsUpserted: 0,
  };
  private readonly stageHistograms: Map<SeedTimingStage, number[]> = new Map();
  private readonly errors: SeedRunError[] = [];
  private readonly clock: () => number;

  constructor(options: SeedRunReportOptions, clock: () => number = () => Date.now()) {
    this.options = options;
    this.clock = clock;
    this.startedAtMs = clock();
    for (const stage of [
      'enumerate_sets',
      'fetch_cards',
      'resolve_classify',
      'image_pipeline',
      'db_upsert',
    ] as const) {
      this.stageHistograms.set(stage, []);
    }
  }

  // ----- per-source -----

  registerSource(source: string, tier: AdapterTier): void {
    if (!this.perSource.has(source)) {
      this.perSource.set(source, {
        tier,
        setsEnumerated: 0,
        cardsFetched: 0,
        printingsFetched: 0,
        resolverConflicts: 0,
      });
    }
  }

  incPerSource(source: string, field: keyof Omit<PerSourceReport, 'tier'>, by = 1): void {
    const row = this.perSource.get(source);
    if (!row) return;
    row[field] += by;
  }

  // ----- resolver -----

  recordResolverConflicts(
    entity: 'set' | 'card' | 'printing',
    source: string,
    count: number,
  ): void {
    if (count <= 0) return;
    if (entity === 'set') this.resolver.setConflicts += count;
    if (entity === 'card') this.resolver.cardConflicts += count;
    if (entity === 'printing') this.resolver.printingConflicts += count;
    this.incPerSource(source, 'resolverConflicts', count);
  }

  recordResolverAgreements(metadata: Record<string, unknown> | undefined): void {
    if (!metadata) return;
    const validation = metadata['validation'];
    if (!validation || typeof validation !== 'object') return;
    for (const [field, sources] of Object.entries(validation as Record<string, unknown>)) {
      if (!Array.isArray(sources)) continue;
      for (const source of sources) {
        if (typeof source !== 'string') continue;
        const bySource = (this.resolver.agreementsBySource[source] ??= {});
        bySource[field] = (bySource[field] ?? 0) + 1;
      }
    }
  }

  // ----- variant + master-set -----

  recordVariantClass(variantClass: VariantClass): void {
    this.variantDistribution[variantClass] += 1;
  }

  recordMasterSetDecision(included: boolean, overridden: boolean): void {
    this.masterSet.decided += 1;
    if (included) this.masterSet.included += 1;
    else this.masterSet.excluded += 1;
    if (overridden) this.masterSet.overridesApplied += 1;
  }

  // ----- image pipeline -----

  recordImageOutcome(
    outcome: 'transcoded' | 'cached' | 'skipped_no_url' | 'skipped_excluded_source' | 'error',
  ): void {
    switch (outcome) {
      case 'transcoded':
        this.imagePipeline.transcoded += 1;
        break;
      case 'cached':
        this.imagePipeline.cached += 1;
        break;
      case 'skipped_no_url':
        this.imagePipeline.skippedNoUrl += 1;
        break;
      case 'skipped_excluded_source':
        this.imagePipeline.skippedExcludedSource += 1;
        break;
      case 'error':
        this.imagePipeline.errors += 1;
        break;
    }
  }

  // ----- DB writes -----

  recordDbUpsert(entity: 'set' | 'card' | 'printing'): void {
    if (entity === 'set') this.db.setsUpserted += 1;
    if (entity === 'card') this.db.cardsUpserted += 1;
    if (entity === 'printing') this.db.printingsUpserted += 1;
  }

  // ----- timings -----

  /**
   * Run `fn` and record its wall-clock duration into `stage`'s
   * histogram. Re-throws whatever `fn` throws, so callers compose
   * normally.
   */
  async time<T>(stage: SeedTimingStage, fn: () => Promise<T>): Promise<T> {
    const start = this.clock();
    try {
      return await fn();
    } finally {
      const elapsed = this.clock() - start;
      this.recordTiming(stage, elapsed);
    }
  }

  recordTiming(stage: SeedTimingStage, ms: number): void {
    const arr = this.stageHistograms.get(stage);
    if (!arr) return;
    arr.push(ms);
  }

  // ----- errors -----

  recordError(err: SeedRunError): void {
    this.errors.push(err);
  }

  // ----- snapshot -----

  finalize(): SeedRunReport {
    const finishedAtMs = this.clock();
    const timings: Record<SeedTimingStage, StageTiming> = {
      enumerate_sets: percentiles(this.stageHistograms.get('enumerate_sets') ?? []),
      fetch_cards: percentiles(this.stageHistograms.get('fetch_cards') ?? []),
      resolve_classify: percentiles(this.stageHistograms.get('resolve_classify') ?? []),
      image_pipeline: percentiles(this.stageHistograms.get('image_pipeline') ?? []),
      db_upsert: percentiles(this.stageHistograms.get('db_upsert') ?? []),
    };
    const perSource: Record<string, PerSourceReport> = {};
    for (const [name, row] of this.perSource) {
      perSource[name] = {
        tier: row.tier,
        setsEnumerated: row.setsEnumerated,
        cardsFetched: row.cardsFetched,
        printingsFetched: row.printingsFetched,
        resolverConflicts: row.resolverConflicts,
      };
    }
    return {
      startedAt: new Date(this.startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - this.startedAtMs,
      options: this.options,
      perSource,
      resolver: {
        setConflicts: this.resolver.setConflicts,
        cardConflicts: this.resolver.cardConflicts,
        printingConflicts: this.resolver.printingConflicts,
        agreementsBySource: deepCloneAgreements(this.resolver.agreementsBySource),
      },
      variantClassDistribution: { ...this.variantDistribution },
      masterSet: { ...this.masterSet },
      imagePipeline: { ...this.imagePipeline },
      db: { ...this.db },
      timings,
      errors: [...this.errors],
      errorsTopN: this.errors.slice(-TOP_N_ERRORS),
    };
  }
}

// ============================================================
// Pretty-printer
// ============================================================

/**
 * Render a `SeedRunReport` as a human-readable multi-line summary.
 * The CLI prints this to stdout; the full JSON ships to disk.
 */
export function formatSeedRunSummary(report: SeedRunReport): string {
  const lines: string[] = [];
  lines.push('Binderly seed-ingest run summary');
  lines.push('================================');
  lines.push(`started:   ${report.startedAt}`);
  lines.push(`finished:  ${report.finishedAt}`);
  lines.push(`duration:  ${report.durationMs} ms`);
  lines.push('');
  lines.push('options:');
  lines.push(`  sources:           ${stringifyAllOrList(report.options.sources)}`);
  lines.push(`  sets:              ${stringifyAllOrList(report.options.sets)}`);
  lines.push(`  limit-sets:        ${report.options.limitSets ?? 'none'}`);
  lines.push(`  limit-cards:       ${report.options.limitCards ?? 'none'}`);
  lines.push(`  dry-run:           ${report.options.dryRun}`);
  lines.push(`  no-images:         ${report.options.noImages}`);
  lines.push(`  set-concurrency:   ${report.options.setConcurrency}`);
  lines.push(`  image-concurrency: ${report.options.imageConcurrency}`);
  lines.push('');
  lines.push('per source:');
  for (const [name, row] of Object.entries(report.perSource)) {
    lines.push(
      `  ${name} (${row.tier}): sets=${row.setsEnumerated} cards=${row.cardsFetched} printings=${row.printingsFetched} conflicts=${row.resolverConflicts}`,
    );
  }
  lines.push('');
  lines.push('resolver:');
  lines.push(
    `  conflicts: set=${report.resolver.setConflicts} card=${report.resolver.cardConflicts} printing=${report.resolver.printingConflicts}`,
  );
  const agreementSources = Object.keys(report.resolver.agreementsBySource);
  if (agreementSources.length === 0) {
    lines.push('  agreements: (none)');
  } else {
    lines.push('  agreements:');
    for (const source of agreementSources) {
      const fields = report.resolver.agreementsBySource[source] ?? {};
      const fieldSummary = Object.entries(fields)
        .map(([f, c]) => `${f}=${c}`)
        .join(' ');
      lines.push(`    ${source}: ${fieldSummary}`);
    }
  }
  lines.push('');
  lines.push('variant_class distribution:');
  for (const [cls, count] of Object.entries(report.variantClassDistribution)) {
    if (count === 0) continue;
    lines.push(`  ${cls}: ${count}`);
  }
  lines.push('');
  lines.push(
    `master-set: decided=${report.masterSet.decided} included=${report.masterSet.included} excluded=${report.masterSet.excluded} overrides=${report.masterSet.overridesApplied}`,
  );
  lines.push(
    `image pipeline: transcoded=${report.imagePipeline.transcoded} cached=${report.imagePipeline.cached} skipped_no_url=${report.imagePipeline.skippedNoUrl} skipped_excluded_source=${report.imagePipeline.skippedExcludedSource} errors=${report.imagePipeline.errors}`,
  );
  lines.push(
    `db: sets=${report.db.setsUpserted} cards=${report.db.cardsUpserted} printings=${report.db.printingsUpserted}`,
  );
  lines.push('');
  lines.push('timings (ms, per stage):');
  for (const [stage, t] of Object.entries(report.timings)) {
    lines.push(
      `  ${stage}: count=${t.count} p50=${t.p50} p95=${t.p95} p99=${t.p99} total=${t.totalMs}`,
    );
  }
  lines.push('');
  if (report.errors.length === 0) {
    lines.push('errors: none');
  } else {
    lines.push(`errors: ${report.errors.length} total — last ${report.errorsTopN.length}:`);
    for (const e of report.errorsTopN) {
      lines.push(`  ${formatSeedRunError(e)}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// Internals
// ============================================================

function percentiles(samples: ReadonlyArray<number>): StageTiming {
  const count = samples.length;
  if (count === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, totalMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((acc, n) => acc + n, 0);
  return {
    count,
    p50: sorted[percentileIndex(count, 0.5)] ?? 0,
    p95: sorted[percentileIndex(count, 0.95)] ?? 0,
    p99: sorted[percentileIndex(count, 0.99)] ?? 0,
    totalMs: total,
  };
}

function percentileIndex(count: number, percentile: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(percentile * count)));
}

function deepCloneAgreements(
  src: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [source, fields] of Object.entries(src)) {
    out[source] = { ...fields };
  }
  return out;
}

function stringifyAllOrList(value: ReadonlyArray<string> | 'all'): string {
  if (value === 'all') return 'all';
  if (value.length === 0) return '(none)';
  return value.join(',');
}
