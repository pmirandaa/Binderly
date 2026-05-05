// `runSeedIngest` — the public entry point for the seed-ingest job.
//
// Wires every Phase-1 module together:
//
//   adapters[].listSets() → resolveCanonicalSets
//     → for each canonical set, bounded concurrency:
//          adapters[].listCardsForSet → resolveCanonicalCards
//          for each canonical card:
//             adapters[].listPrintingsForCard
//             classifyVariant + decideMasterSetMembership
//             resolveCanonicalPrintings
//             upsertSet → upsertCard → upsertPrinting (DB)
//             processImage (image pipeline)
//             updatePrintingImages (DB patch)
//   → SeedRunReport
//
// See `tasks/01-data-layer/T-DL-SEED-INGEST.md` for the full spec
// (run-shape diagram, concurrency model, idempotency strategy,
// failure handling).

import type {
  NewCard as DbNewCard,
  NewPrinting as DbNewPrinting,
  NewSet as DbNewSet,
} from '@binderly/db';

import { concurrencyPool } from './seed/concurrency.js';
import { type CatalogWriter, type PrintingImageUrls } from './seed/db-upsert.js';
import { enumerateSets } from './seed/enumerate-sets.js';
import {
  type ImageHttpProvider,
  type ImageRunInput,
  runImagePipelineForPrintings,
} from './seed/image-pipeline-runner.js';
import { Reporter, type SeedRunReport, type SeedRunReportOptions } from './seed/report.js';
import { processSet } from './seed/resolve-and-classify.js';
import {
  type ImageDedupResolver,
  type ImageStorage,
  type VariantSpec,
  InMemoryDedupResolver,
} from '../images/index.js';
import { type AdapterLogger, type SourceAdapter } from '../interfaces/adapter.js';
import { type ConflictLogRepo } from '../resolver/conflict-log.js';

import type { CanonicalSet } from '../types.js';

// ============================================================
// Public options
// ============================================================

export interface SeedOptions {
  /** Adapters to drive the run. The job partitions by `adapter.tier`. */
  readonly adapters: ReadonlyArray<SourceAdapter>;
  /** Catalog writer (Drizzle in production; in-memory in tests). */
  readonly writer: CatalogWriter;
  /** Image storage (S3ImageStorage in production; in-memory in tests). */
  readonly storage: ImageStorage;
  /** Image dedup resolver (Drizzle in production; in-memory in tests). */
  readonly dedup: ImageDedupResolver;
  /**
   * Provider of per-source `RateLimitedClient`s for the image
   * pipeline. Tests pass a stub returning a shimmed client.
   */
  readonly imageHttpProvider: ImageHttpProvider;
  /**
   * Optional `ConflictLogRepo`. When provided, every resolver
   * conflict observed during the run is buffered per-set and
   * persisted to `data_conflict` via `upsertMany`. When undefined,
   * conflicts still bump the report's `resolverConflicts` counter
   * but are not persisted (preserves every legacy test).
   */
  readonly conflictLog?: ConflictLogRepo;
  /** Pino-compatible logger; defaults to a noop. */
  readonly logger?: AdapterLogger;

  // ----- Filters -----

  /** Restrict primary enumeration to these adapters by `name`. */
  readonly sources?: ReadonlyArray<string>;
  /**
   * Restrict to these set keys. Each entry MUST be a canonical set
   * key (`{language}-{code}`, e.g. `en-swsh9`). The CLI accepts
   * adapter-native set ids like `swsh9` and translates them.
   */
  readonly sets?: ReadonlyArray<string>;
  /** Bound on number of sets processed (after filters). */
  readonly limitSets?: number | null;
  /** Bound on number of cards processed per set. */
  readonly limitCards?: number | null;

  // ----- Behaviour switches -----

  readonly dryRun?: boolean;
  readonly noImages?: boolean;

  // ----- Concurrency -----

  readonly setConcurrency?: number;
  readonly imageConcurrency?: number;

  // ----- Tests -----

  /** Override the variant ladder. Tests pass a tiny ladder. */
  readonly imageLadder?: ReadonlyArray<VariantSpec>;
  /** Inject a clock. Tests pass a deterministic stamp. */
  readonly clock?: () => number;
}

// ============================================================
// Public entry
// ============================================================

const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/**
 * Run the seed-ingest job. Resolves with a `SeedRunReport`. Never
 * rejects — survivable failures are recorded in `report.errors` and
 * the run continues.
 */
export async function runSeedIngest(options: SeedOptions): Promise<SeedRunReport> {
  const logger = options.logger ?? NOOP_LOGGER;
  const reportOptions: SeedRunReportOptions = {
    sources: options.sources && options.sources.length > 0 ? options.sources : 'all',
    sets: options.sets && options.sets.length > 0 ? options.sets : 'all',
    limitSets: options.limitSets ?? null,
    limitCards: options.limitCards ?? null,
    dryRun: Boolean(options.dryRun),
    noImages: Boolean(options.noImages),
    setConcurrency: options.setConcurrency ?? 2,
    imageConcurrency: options.imageConcurrency ?? 4,
  };
  const reporter = new Reporter(reportOptions, options.clock);

  const sourceAllowList =
    options.sources && options.sources.length > 0 ? new Set(options.sources) : null;
  const setAllowList = options.sets && options.sets.length > 0 ? new Set(options.sets) : null;

  // Adapters used to drive enumeration. Filter at the primary tier
  // only — validation/filler tiers always attach (they cross-check).
  const adapters: ReadonlyArray<SourceAdapter> = options.adapters.filter((a) => {
    if (sourceAllowList === null) return true;
    if (a.tier !== 'primary') return true;
    return sourceAllowList.has(a.name);
  });

  // ----- Stage 1: enumerate -----
  const { canonicalSets, rawByAdapter } = await enumerateSets(adapters, reporter, logger);

  let setsToProcess: ReadonlyArray<CanonicalSet> = canonicalSets;
  if (setAllowList) {
    setsToProcess = setsToProcess.filter((s) => setAllowList.has(s.canonicalKey));
  }
  if (typeof options.limitSets === 'number' && options.limitSets > 0) {
    setsToProcess = setsToProcess.slice(0, options.limitSets);
  }

  logger.info(
    {
      canonical_sets: canonicalSets.length,
      to_process: setsToProcess.length,
      filters: {
        sources: sourceAllowList ? [...sourceAllowList] : 'all',
        sets: setAllowList ? [...setAllowList] : 'all',
      },
    },
    'seed.enumerate_sets.scoped',
  );

  // ----- Stage 2..N: per set, bounded by setConcurrency -----
  const setPool = concurrencyPool(reportOptions.setConcurrency);
  await Promise.all(
    setsToProcess.map((canonicalSet) =>
      setPool.run(() =>
        processOneSet({
          canonicalSet,
          adapters,
          rawByAdapter,
          options,
          logger,
          reporter,
        }),
      ),
    ),
  );

  return reporter.finalize();
}

// ============================================================
// Per-set pipeline
// ============================================================

interface ProcessOneSetArgs {
  readonly canonicalSet: CanonicalSet;
  readonly adapters: ReadonlyArray<SourceAdapter>;
  readonly rawByAdapter: ReadonlyMap<string, ReadonlyArray<import('../types.js').RawSet>>;
  readonly options: SeedOptions;
  readonly logger: AdapterLogger;
  readonly reporter: Reporter;
}

async function processOneSet(args: ProcessOneSetArgs): Promise<void> {
  const { canonicalSet, adapters, rawByAdapter, options, logger, reporter } = args;
  const writer = options.writer;

  // ----- DB: upsert the set; remember its UUID -----
  let setRowId: string | null = null;
  if (!options.dryRun) {
    try {
      const row = await reporter.time('db_upsert', () =>
        writer.upsertSet(canonicalSetToNewSet(canonicalSet)),
      );
      setRowId = row.id;
      reporter.recordDbUpsert('set');
    } catch (cause) {
      reporter.recordError({
        kind: 'db_upsert',
        entity: 'set',
        key: canonicalSet.canonicalKey,
        cause,
      });
      logger.error(
        { set: canonicalSet.canonicalKey, err: describeError(cause) },
        'seed.db_upsert.set.failed',
      );
      return;
    }
  }

  // ----- Process cards + printings (resolver + classifier + master-set engine) -----
  const limitCards = options.limitCards ?? null;
  // SeedOptions.clock returns ms; processSet's clock returns Date.
  const seedClock = options.clock;
  const processSetClock = seedClock ? (): Date => new Date(seedClock()) : undefined;
  const result = await processSet({
    canonicalSet,
    adapters,
    rawByAdapter,
    reporter,
    logger,
    limitCards,
    ...(options.conflictLog ? { conflictLog: options.conflictLog } : {}),
    ...(processSetClock ? { clock: processSetClock } : {}),
  });

  // ----- DB: per card, upsert; per printing, upsert and patch with image URLs -----
  const imageInputs: ImageRunInput[] = [];

  for (const card of result.cards) {
    let cardRowId: string | null = null;
    if (!options.dryRun) {
      if (setRowId === null) continue;
      try {
        const cardRow = await reporter.time('db_upsert', () =>
          writer.upsertCard(canonicalCardToNewCard(card.canonical, setRowId as string)),
        );
        cardRowId = cardRow.id;
        reporter.recordDbUpsert('card');
      } catch (cause) {
        reporter.recordError({
          kind: 'db_upsert',
          entity: 'card',
          key: card.canonical.canonicalKey,
          cause,
        });
        logger.error(
          { card: card.canonical.canonicalKey, err: describeError(cause) },
          'seed.db_upsert.card.failed',
        );
        continue;
      }
    }

    for (const printing of card.printings) {
      let printingRowId: string | undefined;
      if (!options.dryRun) {
        if (cardRowId === null) continue;
        try {
          const row = await reporter.time('db_upsert', () =>
            writer.upsertPrinting(
              canonicalPrintingToNewPrinting(printing.canonical, cardRowId as string),
            ),
          );
          printingRowId = row.id;
          reporter.recordDbUpsert('printing');
        } catch (cause) {
          reporter.recordError({
            kind: 'db_upsert',
            entity: 'printing',
            key: printing.canonical.variantKey,
            cause,
          });
          logger.error(
            { printing: printing.canonical.variantKey, err: describeError(cause) },
            'seed.db_upsert.printing.failed',
          );
          continue;
        }
      }

      if (!options.noImages) {
        imageInputs.push({
          canonical: printing.canonical,
          canonicalSet,
          source: printing.source,
          printingId: printingRowId,
        });
      }
    }
  }

  if (options.noImages || imageInputs.length === 0) return;

  const imageConcurrency = options.imageConcurrency ?? 4;
  const outcomes = await runImagePipelineForPrintings(imageInputs, {
    storage: options.storage,
    dedup: options.dedup,
    httpProvider: options.imageHttpProvider,
    reporter,
    logger,
    concurrency: imageConcurrency,
    ...(options.imageLadder !== undefined ? { ladder: options.imageLadder } : {}),
  });

  // Patch the printing rows with the resolved image URLs (when not dry-run).
  if (options.dryRun) return;
  for (const outcome of outcomes) {
    const urls: PrintingImageUrls = {
      imageSmallUrl: outcome.imageSmallUrl,
      imageLargeUrl: outcome.imageLargeUrl,
    };
    try {
      await reporter.time('db_upsert', () => writer.updatePrintingImages(outcome.variantKey, urls));
    } catch (cause) {
      reporter.recordError({
        kind: 'db_upsert',
        entity: 'printing_image',
        key: outcome.variantKey,
        cause,
      });
      logger.error(
        { variant_key: outcome.variantKey, err: describeError(cause) },
        'seed.db_upsert.printing_image.failed',
      );
    }
  }
}

// ============================================================
// Canonical → NewSet/NewCard/NewPrinting mappers
// ============================================================

function canonicalSetToNewSet(canonical: CanonicalSet): DbNewSet {
  return {
    canonicalKey: canonical.canonicalKey,
    code: canonical.code,
    language: canonical.language,
    name: canonical.name,
    series: canonical.series,
    releaseDate: canonical.releaseDate,
    printedTotal: canonical.printedTotal,
    total: canonical.total,
    logoUrl: canonical.logoUrl,
    symbolUrl: canonical.symbolUrl,
    masterSetRules: canonical.masterSetRules,
    sourceMetadata: canonical.sourceMetadata,
  };
}

function canonicalCardToNewCard(
  canonical: import('../types.js').CanonicalCard,
  setId: string,
): DbNewCard {
  return {
    canonicalKey: canonical.canonicalKey,
    setId,
    language: canonical.language,
    number: canonical.number,
    name: canonical.name,
    nameLocalized: canonical.nameLocalized,
    type: canonical.type,
    subtype: canonical.subtype,
    hp: canonical.hp,
    illustrator: canonical.illustrator,
    flavorText: canonical.flavorText,
    attacks: canonical.attacks,
    weakness: canonical.weakness,
    resistance: canonical.resistance,
    retreatCost: canonical.retreatCost,
    rarity: canonical.rarity,
    sourceMetadata: canonical.sourceMetadata,
  };
}

function canonicalPrintingToNewPrinting(
  canonical: import('../types.js').CanonicalPrinting,
  cardId: string,
): DbNewPrinting {
  return {
    variantKey: canonical.variantKey,
    cardId,
    variantClass: canonical.variantClass,
    variantFlags: canonical.variantFlags,
    variantCode: canonical.variantCode,
    includeInMasterSet: canonical.includeInMasterSet,
    imageSmallUrl: canonical.imageSmallUrl,
    imageLargeUrl: canonical.imageLargeUrl,
    imageSourceUrl: canonical.imageSourceUrl,
    sourceMetadata: canonical.sourceMetadata,
  };
}

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'unknown', message: String(err) };
}

// ============================================================
// Re-exports (jobs/index.ts barrels these out via wildcard)
// ============================================================

export { Reporter, formatSeedRunSummary } from './seed/report.js';
export type {
  SeedRunReport,
  SeedRunReportOptions,
  PerSourceReport,
  ResolverReport,
  MasterSetReport,
  ImagePipelineReport,
  DbReport,
  StageTiming,
  SeedTimingStage,
} from './seed/report.js';
export {
  type CatalogWriter,
  type PrintingImageUrls,
  type WrittenRow,
  DrizzleCatalogWriter,
  InMemoryCatalogWriter,
} from './seed/db-upsert.js';
export { DrizzleImageDedupResolver } from './seed/image-dedup.js';
export {
  type ImageHttpProvider,
  type ImageRunInput,
  type ImageRunOutcome,
  type RunImageOptions,
  runImagePipelineForPrintings,
} from './seed/image-pipeline-runner.js';
export {
  type ImagePipelineHttpClients,
  type CreateImagePipelineHttpClientsOptions,
  buildImageHttpProvider,
  createImagePipelineHttpClients,
} from './seed/image-http-clients.js';
export { concurrencyPool, type ConcurrencyPool } from './seed/concurrency.js';
export {
  type SeedRunError,
  type SeedRunErrorKind,
  type SeedDbEntity,
  formatSeedRunError,
} from './seed/errors.js';
export { InMemoryDedupResolver };

// `NewSet` / `NewCard` / `NewPrinting` are re-exported through the
// drizzle insert types — the compile-time alignment test in
// `data-pipeline/src/types.alignment.test.ts` enforces that the
// canonical types map onto these without translation; consumers can
// build fixture inputs without importing `@binderly/db` directly.
export type { DbNewSet as NewSet, DbNewCard as NewCard, DbNewPrinting as NewPrinting };
