// scripts/pricing-ebay-browse.ts — CLI entry for the Layer-2 (eBay
// Browse, active listings) pricing ingest.
//
// Wires `runPricingEbayBrowseIngest` to:
//   - the live `EbayBrowseAdapter` over `EbayBrowseClient` +
//     `EbayOAuthClient` against `api.ebay.com`, OR a synthetic
//     `MockEbayBrowseClient` when `MOCK_PRICING_EBAY_BROWSE=1`.
//   - a Drizzle-backed `EbayBrowsePriceObservationRepo` against the database
//     identified by `--url` / `DATABASE_URL` / `SUPABASE_DB_URL`.
//   - a Drizzle-backed `ParserCatalogReader` over `card` + `printing`
//     for the joiner; a Drizzle-backed `PricingSetReader` over
//     `card` + `set` when the caller passes `--set`.
//
// Modes (exactly one is required):
//
//   pnpm --filter @binderly/data-pipeline pricing-ebay-browse \
//     --query "Charizard Brilliant Stars 020"
//
//   pnpm --filter @binderly/data-pipeline pricing-ebay-browse \
//     --set en-swsh9 --max-queries 5
//
// On success: prints the `PricingEbayBrowseReport` as a single line
// of JSON to stdout and exits 0. On any unrecoverable error prints
// a diagnostic to stderr and exits 1.
//
// Like `scripts/fx-rates.ts`, this script does NOT call
// `process.exit()` — it sets `process.exitCode` and lets the event
// loop drain.

import '../src/load-env.js';

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import pino from 'pino';

// `@binderly/db` has no `main` / `exports` entry in its package.json
// yet; the deep-path import shape mirrors `scripts/fx-rates.ts`.
import { createDbClient } from '@binderly/db/src/client.js';
import { cardTable } from '@binderly/db/src/schema/cards.js';
import { priceObservationTable } from '@binderly/db/src/schema/prices.js';
import { printingTable } from '@binderly/db/src/schema/printings.js';
import { setTable } from '@binderly/db/src/schema/sets.js';

import {
  EBAY_API_HOST,
  EBAY_BROWSE_DEFAULT_BURST,
  EBAY_BROWSE_DEFAULT_RPS,
  EBAY_BROWSE_DEFAULT_USER_AGENT,
  EbayBrowseAdapter,
  EbayBrowseClient,
  EbayOAuthClient,
  MockEbayBrowseClient,
  type EbayBrowseClientLike,
  type EbayMarketplace,
} from '../src/adapters/pricing-ebay-browse/index.js';
import { RateLimitedClient } from '../src/http/rate-limited-client.js';
import {
  runPricingEbayBrowseIngest,
  type EbayBrowsePriceObservationRepo,
  type PricingEbayBrowseReport,
  type PricingSetReader,
  type PricingSetReaderCard,
  type RunPricingEbayBrowseIngestOptions,
} from '../src/jobs/pricing-ebay-browse.js';

import type {
  ParserCatalogCard,
  ParserCatalogPrinting,
  ParserCatalogReader,
} from '../src/parsers/ebay-listing/index.js';
import type { RawPriceObservation } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = path.basename(__filename);

// ============================================================
// Argument parsing
// ============================================================

interface ParsedArgs {
  queries: string[];
  setKey?: string;
  marketplace: EbayMarketplace;
  url?: string;
  dryRun: boolean;
  maxQueries?: number;
  pageSize?: number;
  maxPagesPerQuery?: number;
  maxListingsPerQuery?: number;
  help: boolean;
}

class CliError extends Error {}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = {
    queries: [],
    marketplace: 'EBAY_US',
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--query':
      case '-q': {
        const v = argv[++i];
        if (!v) throw new CliError('`--query` requires a value');
        args.queries.push(v);
        break;
      }
      case '--set': {
        const v = argv[++i];
        if (!v) throw new CliError('`--set` requires a canonical set key (e.g. en-swsh9)');
        args.setKey = v;
        break;
      }
      case '--marketplace': {
        const v = argv[++i];
        if (!v) throw new CliError('`--marketplace` requires a value');
        if (v !== 'EBAY_US' && v !== 'EBAY_GB' && v !== 'EBAY_DE' && v !== 'EBAY_JP') {
          throw new CliError(
            `unknown --marketplace ${v}; expected one of EBAY_US|EBAY_GB|EBAY_DE|EBAY_JP`,
          );
        }
        args.marketplace = v;
        break;
      }
      case '--url':
      case '-u': {
        const v = argv[++i];
        if (!v) throw new CliError('`--url` requires a connection string argument');
        args.url = v;
        break;
      }
      case '--max-queries': {
        const v = argv[++i];
        if (!v) throw new CliError('`--max-queries` requires a number');
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1) {
          throw new CliError(`--max-queries must be a positive integer (got ${v})`);
        }
        args.maxQueries = n;
        break;
      }
      case '--page-size': {
        const v = argv[++i];
        if (!v) throw new CliError('`--page-size` requires a number');
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1 || n > 200) {
          throw new CliError(`--page-size must be in [1, 200] (got ${v})`);
        }
        args.pageSize = n;
        break;
      }
      case '--max-pages-per-query': {
        const v = argv[++i];
        if (!v) throw new CliError('`--max-pages-per-query` requires a number');
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1) {
          throw new CliError(`--max-pages-per-query must be a positive integer (got ${v})`);
        }
        args.maxPagesPerQuery = n;
        break;
      }
      case '--max-listings-per-query': {
        const v = argv[++i];
        if (!v) throw new CliError('`--max-listings-per-query` requires a number');
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1) {
          throw new CliError(`--max-listings-per-query must be a positive integer (got ${v})`);
        }
        args.maxListingsPerQuery = n;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new CliError(`unknown argument: ${arg ?? '(empty)'}`);
    }
  }
  return args;
}

function usage(): string {
  return (
    `Usage: ${SCRIPT_NAME} [--query "..."]+ | [--set en-swsh9]\n` +
    `       [--marketplace EBAY_US] [--max-queries N] [--page-size N]\n` +
    `       [--max-pages-per-query N] [--max-listings-per-query N]\n` +
    `       [--url <conn>] [--dry-run]\n` +
    `\n` +
    `Either --query (one or more) or --set is required (mutually exclusive).\n` +
    `\n` +
    `Env:\n` +
    `  EBAY_CLIENT_ID, EBAY_CLIENT_SECRET   eBay developer credentials\n` +
    `                                       (NOT required when MOCK_PRICING_EBAY_BROWSE=1)\n` +
    `  MOCK_PRICING_EBAY_BROWSE=1           use synthetic fixtures (no network)\n` +
    `  DATABASE_URL / SUPABASE_DB_URL       Postgres connection (or pass --url)\n`
  );
}

function isMockMode(): boolean {
  return process.env['MOCK_PRICING_EBAY_BROWSE'] === '1';
}

function resolveUrl(args: ParsedArgs): string | null {
  if (args.url) return args.url;
  const envDb = process.env['DATABASE_URL'];
  if (envDb) return envDb;
  const envSupabase = process.env['SUPABASE_DB_URL'];
  if (envSupabase) return envSupabase;
  return null;
}

// ============================================================
// Catalog reader (Drizzle)
// ============================================================

type DrizzleDb = ReturnType<typeof createDbClient>;

function makeCatalogReader(db: DrizzleDb): ParserCatalogReader {
  return {
    async findCardByCanonicalKey(canonicalKey: string): Promise<ParserCatalogCard | null> {
      const rows = await db
        .select({
          id: cardTable.id,
          canonicalKey: cardTable.canonicalKey,
          name: cardTable.name,
          setCanonicalKey: setTable.canonicalKey,
        })
        .from(cardTable)
        .innerJoin(setTable, eq(cardTable.setId, setTable.id))
        .where(eq(cardTable.canonicalKey, canonicalKey))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        canonicalKey: r.canonicalKey,
        name: r.name,
        setCanonicalKey: r.setCanonicalKey,
      };
    },
    async findCardsByNameAndSetCode(args): Promise<readonly ParserCatalogCard[]> {
      const limit = args.limit ?? 5;
      const conditions = [ilike(cardTable.name, `%${args.nameLike}%`)];
      if (args.setCanonicalKey != null) {
        conditions.push(eq(setTable.canonicalKey, args.setCanonicalKey));
      }
      const rows = await db
        .select({
          id: cardTable.id,
          canonicalKey: cardTable.canonicalKey,
          name: cardTable.name,
          setCanonicalKey: setTable.canonicalKey,
        })
        .from(cardTable)
        .innerJoin(setTable, eq(cardTable.setId, setTable.id))
        .where(and(...conditions))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        canonicalKey: r.canonicalKey,
        name: r.name,
        setCanonicalKey: r.setCanonicalKey,
      }));
    },
    async findPrintingsByCardId(cardId: string): Promise<readonly ParserCatalogPrinting[]> {
      const rows = await db
        .select({
          id: printingTable.id,
          variantKey: printingTable.variantKey,
          cardId: printingTable.cardId,
          variantClass: printingTable.variantClass,
          variantFlags: printingTable.variantFlags,
        })
        .from(printingTable)
        .where(eq(printingTable.cardId, cardId));
      return rows.map((r) => ({
        id: r.id,
        variantKey: r.variantKey,
        cardId: r.cardId,
        variantClass: r.variantClass,
        variantFlags: r.variantFlags,
      }));
    },
  };
}

function makeSetReader(db: DrizzleDb): PricingSetReader {
  return {
    async listCardsInSet(setCanonicalKey: string): Promise<ReadonlyArray<PricingSetReaderCard>> {
      const rows = await db
        .select({
          canonicalKey: cardTable.canonicalKey,
          name: cardTable.name,
          number: cardTable.number,
          setCanonicalKey: setTable.canonicalKey,
          setName: setTable.name,
        })
        .from(cardTable)
        .innerJoin(setTable, eq(cardTable.setId, setTable.id))
        .where(eq(setTable.canonicalKey, setCanonicalKey))
        .orderBy(asc(cardTable.number));
      return rows;
    },
  };
}

function makeRepo(db: DrizzleDb): EbayBrowsePriceObservationRepo {
  return {
    async upsertMany(rows: ReadonlyArray<RawPriceObservation>): Promise<number> {
      if (rows.length === 0) return 0;
      const values = rows.map((r) => ({
        printingId: r.printingId,
        gradeTier: r.gradeTier,
        market: r.market,
        source: r.source,
        sourceListingId: r.sourceListingId,
        observationKind: r.observationKind,
        observedPrice: r.observedPrice,
        observedCurrency: r.observedCurrency,
        shipping: r.shipping,
        // `parseConfidence` is already a `numeric(3,2)`-formatted string on
        // the shared RawPriceObservation type (#FU-2); pass it straight through.
        parseConfidence: r.parseConfidence,
        observedAt: r.observedAt,
        observedDate: r.observedDate,
        rawMetadata: r.rawMetadata,
      }));
      // UNIQUE on (source, source_listing_id) per
      // packages/db/src/schema/prices.ts. The unique constraint
      // uses NULLS DISTINCT (Postgres default), so observations
      // without an upstream listing id never collide on this PR's
      // path (eBay always carries `itemId`, so we always populate
      // source_listing_id).
      await db
        .insert(priceObservationTable)
        .values(values)
        .onConflictDoUpdate({
          target: [priceObservationTable.source, priceObservationTable.sourceListingId],
          set: {
            printingId: sql`excluded.printing_id`,
            gradeTier: sql`excluded.grade_tier`,
            market: sql`excluded.market`,
            observationKind: sql`excluded.observation_kind`,
            observedPrice: sql`excluded.observed_price`,
            observedCurrency: sql`excluded.observed_currency`,
            shipping: sql`excluded.shipping`,
            parseConfidence: sql`excluded.parse_confidence`,
            observedAt: sql`excluded.observed_at`,
            observedDate: sql`excluded.observed_date`,
            rawMetadata: sql`excluded.raw_metadata`,
          },
        });
      return rows.length;
    },
  };
}

// ============================================================
// Mock-mode wiring (no network, no DB required)
// ============================================================

function makeMockClient(): EbayBrowseClientLike {
  return new MockEbayBrowseClient({ useSynthetic: true });
}

function makeMockReader(): ParserCatalogReader {
  // Minimal in-memory fixture covering the synthetic listings'
  // titles. Picks one Charizard from "Brilliant Stars" so the
  // joiner has something to bind to. The mock reader is
  // deliberately permissive — anything the synthetic fixtures
  // generate will resolve to one of these printings.
  const cards: ParserCatalogCard[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      canonicalKey: 'en-swsh9-020',
      setCanonicalKey: 'en-swsh9',
      name: 'Charizard',
    },
  ];
  const printings: ParserCatalogPrinting[] = [
    {
      id: '00000000-0000-4000-8000-000000000101',
      variantKey: 'en-swsh9-020-holo',
      cardId: '00000000-0000-4000-8000-000000000001',
      variantClass: 'HOLO',
      variantFlags: [],
    },
  ];
  return {
    async findCardByCanonicalKey(canonicalKey) {
      return cards.find((c) => c.canonicalKey === canonicalKey) ?? null;
    },
    async findCardsByNameAndSetCode({ nameLike, setCanonicalKey, limit = 5 }) {
      const lower = nameLike.toLowerCase();
      return cards
        .filter((c) => {
          const nameOk = c.name.toLowerCase().includes(lower);
          const setOk = setCanonicalKey == null || c.setCanonicalKey === setCanonicalKey;
          return nameOk && setOk;
        })
        .slice(0, limit);
    },
    async findPrintingsByCardId(cardId) {
      return printings.filter((p) => p.cardId === cardId);
    },
  };
}

function makeMockSetReader(): PricingSetReader {
  return {
    async listCardsInSet(setCanonicalKey: string): Promise<ReadonlyArray<PricingSetReaderCard>> {
      // Return one synthetic card so the runner has something to query.
      return [
        {
          canonicalKey: `${setCanonicalKey}-001`,
          name: 'Charizard',
          number: '001/172',
          setCanonicalKey,
          setName: 'Brilliant Stars',
        },
      ];
    },
  };
}

class InMemoryPriceObservationCliRepo implements EbayBrowsePriceObservationRepo {
  private readonly rows = new Map<string, RawPriceObservation>();
  async upsertMany(rows: ReadonlyArray<RawPriceObservation>): Promise<number> {
    for (const r of rows) {
      const k = `${r.source}|${r.sourceListingId ?? ''}`;
      this.rows.set(k, { ...r });
    }
    return rows.length;
  }
  size(): number {
    return this.rows.size;
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`${SCRIPT_NAME}: ${err.message}`);
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (args.help) {
    console.warn(usage());
    return;
  }

  const explicitQueries = args.queries.length > 0;
  const setBased = typeof args.setKey === 'string' && args.setKey.length > 0;
  if (!explicitQueries && !setBased) {
    console.error(`${SCRIPT_NAME}: must provide --query (one or more) or --set`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (explicitQueries && setBased) {
    console.error(`${SCRIPT_NAME}: --query and --set are mutually exclusive`);
    process.exitCode = 1;
    return;
  }

  const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { script: SCRIPT_NAME },
  });

  const mock = isMockMode();

  // --- adapter wiring ------------------------------------------
  let client: EbayBrowseClientLike;
  if (mock) {
    client = makeMockClient();
    logger.info({ mock: true }, 'pricing-ebay-browse.cli.mock_mode');
  } else {
    const clientId = process.env['EBAY_CLIENT_ID'];
    const clientSecret = process.env['EBAY_CLIENT_SECRET'];
    if (!clientId || !clientSecret) {
      console.error(
        `${SCRIPT_NAME}: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are required when MOCK_PRICING_EBAY_BROWSE!=1`,
      );
      process.exitCode = 1;
      return;
    }
    const http = new RateLimitedClient({
      host: EBAY_API_HOST,
      requestsPerSecond: EBAY_BROWSE_DEFAULT_RPS,
      burst: EBAY_BROWSE_DEFAULT_BURST,
      userAgent: process.env['BINDERLY_DATA_PIPELINE_UA'] ?? EBAY_BROWSE_DEFAULT_USER_AGENT,
      logger,
    });
    const oauth = new EbayOAuthClient({
      http,
      clientId,
      clientSecret,
      context: { logger, env: 'production' },
    });
    client = new EbayBrowseClient({
      http,
      oauth,
      context: { logger, env: 'production' },
    });
  }

  // --- DB / catalog wiring -----------------------------------
  // Posture (mirrors seed-ingest):
  //   mock mode      → synthetic catalog + in-memory repo (no DB).
  //   dry-run + URL  → real Drizzle catalog reader + in-memory repo.
  //   normal + URL   → real Drizzle catalog reader + Drizzle repo.
  let db: DrizzleDb | null = null;
  let pgClient: { end: (opts?: { timeout?: number }) => Promise<void> } | null = null;
  let repo: EbayBrowsePriceObservationRepo;
  let catalogReader: ParserCatalogReader;
  let setReader: PricingSetReader;

  if (mock) {
    repo = new InMemoryPriceObservationCliRepo();
    catalogReader = makeMockReader();
    setReader = makeMockSetReader();
    logger.info({ mock: true }, 'pricing-ebay-browse.cli.in_memory_repo');
  } else {
    const url = resolveUrl(args);
    if (!url) {
      console.error(
        `${SCRIPT_NAME}: no target connection string. Pass --url <postgres://...> or set DATABASE_URL / SUPABASE_DB_URL, or use MOCK_PRICING_EBAY_BROWSE=1.`,
      );
      process.exitCode = 1;
      return;
    }
    db = createDbClient(url, { poolOptions: { max: 1, onnotice: () => {} } });
    pgClient = db.$client as unknown as {
      end: (opts?: { timeout?: number }) => Promise<void>;
    };
    catalogReader = makeCatalogReader(db);
    setReader = makeSetReader(db);
    if (args.dryRun) {
      repo = new InMemoryPriceObservationCliRepo();
      logger.info({ dryRun: true }, 'pricing-ebay-browse.cli.dry_run_repo');
    } else {
      repo = makeRepo(db);
    }
  }

  // --- adapter -------------------------------------------------
  const adapter = new EbayBrowseAdapter({
    client,
    catalogReader,
    context: { logger, env: mock ? 'test' : 'production' },
  });

  // --- run -----------------------------------------------------
  try {
    const runOpts: RunPricingEbayBrowseIngestOptions = {
      adapter,
      repo,
      marketplace: args.marketplace,
      logger,
    };
    if (args.queries.length > 0) runOpts.queries = args.queries;
    if (args.setKey !== undefined) {
      runOpts.setKey = args.setKey;
      runOpts.setReader = setReader;
    }
    if (args.maxQueries !== undefined) runOpts.maxQueries = args.maxQueries;
    if (args.pageSize !== undefined) runOpts.pageSize = args.pageSize;
    if (args.maxPagesPerQuery !== undefined) runOpts.maxPagesPerQuery = args.maxPagesPerQuery;
    if (args.maxListingsPerQuery !== undefined)
      runOpts.maxListingsPerQuery = args.maxListingsPerQuery;
    const report: PricingEbayBrowseReport = await runPricingEbayBrowseIngest(runOpts);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.errors.length > 0) {
      logger.warn({ errorCount: report.errors.length }, 'pricing-ebay-browse.cli.partial_success');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'pricing-ebay-browse.cli.failed');
    process.exitCode = 1;
  } finally {
    if (pgClient) {
      await pgClient.end({ timeout: 5 });
    }
  }
}

await main();
