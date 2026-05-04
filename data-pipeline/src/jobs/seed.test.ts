// Unit + per-stage tests for the seed-ingest job.
//
// Strategy:
//
//   * Drive `runSeedIngest` end-to-end with `MockAdapter` fixtures
//     and the in-memory writer/storage/dedup. No HTTP, no Postgres,
//     no MinIO.
//   * Assert per-stage outcomes via the `SeedRunReport`. The reporter
//     IS our observability surface; if it's wrong, the integration
//     run silently produces wrong numbers.
//   * Re-run the job a second time against the same in-memory state
//     and assert the dedup+upsert idempotency contract: zero new
//     image transcodes, set/card/printing counts re-incremented but
//     row count steady.

import { describe, expect, it } from 'vitest';

import { concurrencyPool } from './seed/concurrency.js';
import { formatSeedRunError, type SeedRunError } from './seed/errors.js';
import { Reporter, type SeedRunReportOptions } from './seed/report.js';
import {
  buildSyntheticCatalog,
  MockAdapter,
  MockHttpProvider,
  MockImageStorage,
  TINY_TEST_LADDER,
} from './seed.fixtures.js';
import {
  DrizzleCatalogWriter,
  formatSeedRunSummary,
  InMemoryCatalogWriter,
  runSeedIngest,
  type SeedRunReport,
} from './seed.js';
import { InMemoryDedupResolver, type ImageDedupResolver } from '../images/index.js';

// ============================================================
// Test wiring
// ============================================================

interface Wiring {
  readonly writer: InMemoryCatalogWriter;
  readonly dedup: InMemoryDedupResolver;
  readonly storage: MockImageStorage;
  readonly httpProvider: MockHttpProvider;
}

async function buildWiring(): Promise<Wiring> {
  const writer = new InMemoryCatalogWriter();
  const dedup = new InMemoryDedupResolver();
  const storage = new MockImageStorage();
  const httpProvider = new MockHttpProvider();
  await httpProvider.programAllWithSyntheticPng();
  return { writer, dedup, storage, httpProvider };
}

// ============================================================
// concurrencyPool — helper sanity-checks
// ============================================================

describe('concurrencyPool', () => {
  it('rejects non-positive limits', () => {
    expect(() => concurrencyPool(0)).toThrow();
    expect(() => concurrencyPool(-1)).toThrow();
    expect(() => concurrencyPool(1.5)).toThrow();
  });

  it('runs tasks FIFO and respects the limit', async () => {
    const pool = concurrencyPool(2);
    const log: string[] = [];
    const slow =
      (id: string, ms: number): (() => Promise<string>) =>
      async () => {
        log.push(`start:${id}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end:${id}`);
        return id;
      };
    const results = await Promise.all([
      pool.run(slow('a', 30)),
      pool.run(slow('b', 30)),
      pool.run(slow('c', 1)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    // First two start before any end; third starts after one end.
    expect(log[0]).toBe('start:a');
    expect(log[1]).toBe('start:b');
    expect(log.indexOf('start:c')).toBeGreaterThan(log.indexOf('end:a'));
  });
});

// ============================================================
// Reporter — percentile + serialisation
// ============================================================

describe('Reporter', () => {
  function buildReporter(): Reporter {
    let now = 1_700_000_000_000;
    const clock = (): number => {
      now += 10;
      return now;
    };
    const opts: SeedRunReportOptions = {
      sources: 'all',
      sets: 'all',
      limitSets: null,
      limitCards: null,
      dryRun: false,
      noImages: false,
      setConcurrency: 2,
      imageConcurrency: 4,
    };
    return new Reporter(opts, clock);
  }

  it('finalises with zeros when no work was recorded', () => {
    const r = buildReporter();
    const report = r.finalize();
    expect(report.db.setsUpserted).toBe(0);
    expect(report.imagePipeline.transcoded).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.timings.enumerate_sets).toEqual({
      count: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      totalMs: 0,
    });
  });

  it('records timings and computes p95/p99', async () => {
    const r = buildReporter();
    for (const ms of [1, 5, 10, 100, 250]) {
      r.recordTiming('db_upsert', ms);
    }
    const report = r.finalize();
    expect(report.timings.db_upsert.count).toBe(5);
    expect(report.timings.db_upsert.totalMs).toBe(366);
    expect(report.timings.db_upsert.p50).toBeGreaterThan(0);
    expect(report.timings.db_upsert.p99).toBeGreaterThan(report.timings.db_upsert.p50);
  });

  it('records resolver agreements from canonical sourceMetadata', () => {
    const r = buildReporter();
    r.recordResolverAgreements({
      validation: {
        name: ['ptcgio'],
        rarity: ['ptcgio', 'bulbapedia-en'],
      },
    });
    r.recordResolverAgreements({
      validation: { name: ['ptcgio'] },
    });
    const report = r.finalize();
    expect(report.resolver.agreementsBySource['ptcgio']).toEqual({ name: 2, rarity: 1 });
    expect(report.resolver.agreementsBySource['bulbapedia-en']).toEqual({ rarity: 1 });
  });

  it('truncates errorsTopN to the trailing 10 entries', () => {
    const r = buildReporter();
    for (let i = 0; i < 14; i += 1) {
      const e: SeedRunError = {
        kind: 'db_upsert',
        entity: 'set',
        key: `key-${i}`,
        cause: new Error(`boom ${i}`),
      };
      r.recordError(e);
    }
    const report = r.finalize();
    expect(report.errors.length).toBe(14);
    expect(report.errorsTopN.length).toBe(10);
    expect((report.errorsTopN[0] as { key: string }).key).toBe('key-4');
    expect(formatSeedRunError(report.errors[0]!)).toMatch(/key=key-0/);
  });
});

// ============================================================
// runSeedIngest — full integration over the synthetic catalog
// ============================================================

describe('runSeedIngest — synthetic catalog', () => {
  it('processes all sets across all primaries; honours validation tier', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();

    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn, fixtures.ptcgio, fixtures.tcgdexJp, fixtures.bulbapedia],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
      setConcurrency: 2,
      imageConcurrency: 4,
    });

    // Every primary set went through.
    expect(report.db.setsUpserted).toBe(2);
    // 2 EN cards + 1 JP card.
    expect(report.db.cardsUpserted).toBe(3);
    // 2 EN printings (charizard holo + revholo) + 1 EN TG + 1 JP holo = 4
    expect(report.db.printingsUpserted).toBe(4);

    // Per-source counters partition correctly.
    expect(report.perSource['tcgdex-en']).toMatchObject({ tier: 'primary', setsEnumerated: 1 });
    expect(report.perSource['tcgdex-jp']).toMatchObject({ tier: 'primary', setsEnumerated: 1 });
    expect(report.perSource['ptcgio']).toMatchObject({ tier: 'validation', setsEnumerated: 1 });
    expect(report.perSource['bulbapedia-en']).toMatchObject({ tier: 'filler', setsEnumerated: 0 });

    // Validation cards travelled through the resolver: ptcgio
    // contributed 1 RawCard for swsh9-018.
    expect(report.perSource['ptcgio']?.cardsFetched).toBe(1);

    // Resolver recorded validation-tier agreements for ptcgio fields
    // that matched (e.g. number, name).
    expect(Object.keys(report.resolver.agreementsBySource)).toContain('ptcgio');

    // Master-set engine emitted a non-zero count; defaults pull TG-in,
    // mainline-in, error-out etc.
    expect(report.masterSet.decided).toBeGreaterThan(0);
    expect(report.masterSet.included).toBeGreaterThan(0);
  });

  it('skips bulbapedia images via EXCLUDED_IMAGE_SOURCES (defence-in-depth)', async () => {
    // Inject a bulbapedia primary printing to exercise the
    // `skipped_excluded_source` branch. Bulbapedia at filler tier
    // never wins resolver but we still want to hit the runner's
    // skip with a non-null URL.
    const bulbaSetKey = 'bulb-only';
    const bulbaSet = {
      source: 'bulbapedia-en',
      sourceKey: bulbaSetKey,
      code: 'bulb-only',
      language: 'en',
      name: 'Bulbasaur Standalone',
      series: null,
      releaseDate: '2021-01-01',
      printedTotal: null,
      total: null,
      logoUrl: null,
      symbolUrl: null,
    } as const;
    const bulbaCard = {
      source: 'bulbapedia-en',
      sourceKey: 'bulb-001',
      setCode: 'bulb-only',
      language: 'en',
      number: '001',
      name: 'Bulbasaur',
    } as const;
    const bulbaPrint = {
      source: 'bulbapedia-en',
      sourceKey: 'bulb-001-p',
      cardKey: 'bulb-001',
      sourcePrintingLabel: 'Holo',
      isHolo: true,
      // Pipeline must skip; it should never hit the network for bulba.
      imageSourceUrl: 'https://archives.bulbagarden.net/never-fetched.png',
    } as const;
    const bulbaPrimary = new MockAdapter({
      name: 'bulbapedia-en',
      language: 'en',
      tier: 'primary',
      sets: [bulbaSet],
      cardsBySet: new Map([[bulbaSetKey, [bulbaCard]]]),
      printingsByCard: new Map([['bulb-001', [bulbaPrint]]]),
    });

    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const report = await runSeedIngest({
      adapters: [bulbaPrimary],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
    });

    expect(report.imagePipeline.skippedExcludedSource).toBeGreaterThan(0);
    expect(report.imagePipeline.transcoded).toBe(0);
    // No PUTs hit the storage for an excluded source.
    expect(storage.puts.length).toBe(0);
  });

  it('rerun against the same in-memory state results in zero new image transcodes (dedup hit)', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();
    const adapters = [fixtures.tcgdexEn, fixtures.ptcgio, fixtures.tcgdexJp, fixtures.bulbapedia];

    const first = await runSeedIngest({
      adapters,
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
    });
    expect(first.imagePipeline.transcoded).toBeGreaterThan(0);

    // Re-run: program more synthetic responses (the queue was drained on the first run).
    await httpProvider.programAllWithSyntheticPng();
    const putCountBefore = storage.puts.length;
    const dedupSizeBefore = dedup.size();

    const second = await runSeedIngest({
      adapters,
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
    });

    // The second run must have ZERO new transcodes — every printing
    // hits the dedup cache.
    expect(second.imagePipeline.transcoded).toBe(0);
    expect(
      second.imagePipeline.cached + second.imagePipeline.skippedExcludedSource,
    ).toBeGreaterThan(0);

    // Storage saw no new uploads on the second run — the printed_image
    // cache short-circuited every variant.
    expect(storage.puts.length).toBe(putCountBefore);
    // Dedup table is steady.
    expect(dedup.size()).toBe(dedupSizeBefore);
  });

  it('honours --source filter and writes only the matching primary', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();

    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn, fixtures.ptcgio, fixtures.tcgdexJp, fixtures.bulbapedia],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
      sources: ['tcgdex-en'],
    });

    // Only the EN set landed.
    expect(report.db.setsUpserted).toBe(1);
    // Validation/filler tiers stayed attached and contributed cards/agreements.
    expect(report.perSource['ptcgio']?.cardsFetched).toBe(1);
  });

  it('honours --set filter (canonical key)', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();

    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn, fixtures.ptcgio, fixtures.tcgdexJp, fixtures.bulbapedia],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
      sets: ['en-swsh9'],
    });

    expect(report.db.setsUpserted).toBe(1);
    expect(report.db.cardsUpserted).toBe(2);
  });

  it('honours --no-images: zero PUTs and zero image-pipeline counters', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();

    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
      noImages: true,
    });

    expect(report.imagePipeline).toEqual({
      transcoded: 0,
      cached: 0,
      skippedNoUrl: 0,
      skippedExcludedSource: 0,
      errors: 0,
    });
    expect(storage.puts.length).toBe(0);
  });

  it('honours --dry-run: no DB writes', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();

    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
      dryRun: true,
    });

    expect(report.db).toEqual({ setsUpserted: 0, cardsUpserted: 0, printingsUpserted: 0 });
    expect(writer.upsertCounts).toEqual({ set: 0, card: 0, printing: 0, imagePatch: 0 });
  });

  it('isolates an adapter listSets() throw — other adapters proceed', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();
    const broken = new MockAdapter({
      name: 'tcgdex-en',
      language: 'en',
      tier: 'primary',
      throwOnListSets: new Error('upstream 503'),
    });

    const report = await runSeedIngest({
      adapters: [broken, fixtures.tcgdexJp],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
    });

    // The throw landed as an `enumerate_sets` error.
    const enumErrors = report.errors.filter((e) => e.kind === 'enumerate_sets');
    expect(enumErrors.length).toBe(1);
    expect(enumErrors[0]).toMatchObject({ source: 'tcgdex-en' });

    // The healthy primary still wrote its set.
    expect(report.db.setsUpserted).toBe(1);
  });
});

// ============================================================
// Snapshot — report shape stays stable
// ============================================================

describe('runSeedIngest — report shape snapshot', () => {
  it('emits a report with the documented top-level keys', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();

    let now = 1_700_000_000_000;
    const clock = (): number => {
      now += 1;
      return now;
    };
    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
      clock,
    });

    expect(Object.keys(report).sort()).toEqual(
      [
        'db',
        'durationMs',
        'errors',
        'errorsTopN',
        'finishedAt',
        'imagePipeline',
        'masterSet',
        'options',
        'perSource',
        'resolver',
        'startedAt',
        'timings',
        'variantClassDistribution',
      ].sort(),
    );

    // Pretty-printer doesn't crash on a populated report.
    expect(() => formatSeedRunSummary(report)).not.toThrow();
  });
});

// ============================================================
// DrizzleCatalogWriter — narrow construct-only sanity check
// ============================================================

describe('DrizzleCatalogWriter', () => {
  it('constructs without touching the DB', () => {
    // We don't have a live DbClient in unit tests — this just
    // exercises the constructor and proves the type contract is
    // satisfied by Drizzle's `PostgresJsDatabase`.
    type CtorArg = Parameters<typeof DrizzleCatalogWriter>[0];
    const fakeDb = {} as CtorArg;
    const writer = new DrizzleCatalogWriter(fakeDb);
    expect(writer).toBeInstanceOf(DrizzleCatalogWriter);
  });
});

// ============================================================
// Type-level — SeedRunReport is JSON-stringifiable
// ============================================================

describe('SeedRunReport JSON serialisation', () => {
  it('round-trips through JSON.stringify / JSON.parse', async () => {
    const { writer, dedup, storage, httpProvider } = await buildWiring();
    const fixtures = buildSyntheticCatalog();
    const report = await runSeedIngest({
      adapters: [fixtures.tcgdexEn],
      writer,
      dedup,
      storage,
      imageHttpProvider: httpProvider,
      imageLadder: TINY_TEST_LADDER,
    });

    const json = JSON.stringify(report);
    const parsed: SeedRunReport = JSON.parse(json);
    expect(parsed.db).toEqual(report.db);
    expect(parsed.imagePipeline).toEqual(report.imagePipeline);
    expect(parsed.options).toEqual(report.options);
  });
});

// ============================================================
// Helper: confirm `ImageDedupResolver` interface is structural
// ============================================================

describe('ImageDedupResolver structural contract', () => {
  it('is satisfied by InMemoryDedupResolver', () => {
    const dedup: ImageDedupResolver = new InMemoryDedupResolver();
    expect(typeof dedup.findExisting).toBe('function');
    expect(typeof dedup.upsert).toBe('function');
  });
});
