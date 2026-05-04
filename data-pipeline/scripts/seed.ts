// CLI entry for the seed-ingest job.
//
// Wires production adapters / writers / image storage / dedup
// resolver to `runSeedIngest` and writes a JSON report under
// `data-pipeline/scripts/output/seed-run-<ISO_TIMESTAMP>.json`.
//
// Usage (from the repo root):
//
//   pnpm --filter @binderly/data-pipeline seed
//   pnpm --filter @binderly/data-pipeline seed --source tcgdex-en --set en-swsh9
//   pnpm --filter @binderly/data-pipeline seed --source tcgdex-en --no-images
//   pnpm --filter @binderly/data-pipeline seed --dry-run
//
// Env vars required:
//   DATABASE_URL                  Postgres connection string
//                                 (defaults to local Docker Postgres
//                                  via .env.example).
//   BINDERLY_DATA_PIPELINE_UA     User-Agent passed to RateLimitedClient.
//   S3_ENDPOINT_URL               MinIO/R2 endpoint (defaults to
//                                 http://localhost:9000).
//   MINIO_ROOT_USER               R2/MinIO access key.
//   MINIO_ROOT_PASSWORD           R2/MinIO secret key.
//   IMAGES_BUCKET                 Image bucket name (defaults to
//                                 'images', matching the bootstrap
//                                 in infra/docker-compose.yml).
//   IMAGES_PUBLIC_URL_PREFIX      Public URL prefix used by `urlFor`.
//
// Optional env:
//   BINDERLY_PTCGIO_API_KEY       PTCGIO API key (validation tier).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { S3Client } from '@aws-sdk/client-s3';

import { createDbClient } from '@binderly/db';

import {
  BulbapediaAdapter,
  BULBAPEDIA_DEFAULT_BURST,
  BULBAPEDIA_DEFAULT_RPS,
  BULBAPEDIA_HOST,
  PTCGIOAdapter,
  PTCGIO_DEFAULT_BURST,
  PTCGIO_DEFAULT_RPS,
  PTCGIO_HOST,
  TCGDEX_DEFAULT_BURST,
  TCGDEX_DEFAULT_RPS,
  TCGDEX_HOST,
  TCGdexEnAdapter,
  TCGdexJpAdapter,
  RateLimitedClient,
  S3ImageStorage,
  createLocalMinioClient,
  type SourceAdapter,
} from '../src/index.js';
import {
  DrizzleCatalogWriter,
  DrizzleImageDedupResolver,
  formatSeedRunSummary,
  runSeedIngest,
  type SeedRunReport,
} from '../src/jobs/seed.js';

import type { ImageSource } from '../src/images/index.js';
import type { ImageHttpProvider } from '../src/jobs/seed/image-pipeline-runner.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// Argument parsing
// ============================================================

interface ParsedArgs {
  sources: string[];
  sets: string[];
  limitSets: number | null;
  limitCards: number | null;
  dryRun: boolean;
  noImages: boolean;
  setConcurrency: number;
  imageConcurrency: number;
  reportDir: string;
}

function parseCli(argv: ReadonlyArray<string>): ParsedArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      source: { type: 'string', multiple: true },
      set: { type: 'string', multiple: true },
      'limit-sets': { type: 'string' },
      'limit-cards': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-images': { type: 'boolean', default: false },
      'set-concurrency': { type: 'string', default: '2' },
      'image-concurrency': { type: 'string', default: '4' },
      'report-dir': {
        type: 'string',
        default: path.resolve(SCRIPT_DIR, 'output'),
      },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printHelp();
    // eslint-disable-next-line n/no-process-exit
    process.exit(0);
  }

  return {
    sources: (values.source as string[] | undefined) ?? [],
    sets: (values.set as string[] | undefined) ?? [],
    limitSets: parseOptInt(values['limit-sets'] as string | undefined, 'limit-sets'),
    limitCards: parseOptInt(values['limit-cards'] as string | undefined, 'limit-cards'),
    dryRun: Boolean(values['dry-run']),
    noImages: Boolean(values['no-images']),
    setConcurrency: parseInt(values['set-concurrency'] as string),
    imageConcurrency: parseInt(values['image-concurrency'] as string),
    reportDir: values['report-dir'] as string,
  };
}

function parseOptInt(value: string | undefined, name: string): number | null {
  if (value === undefined || value === '') return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative integer (got ${value})`);
  }
  return n;
}

function printHelp(): void {
  process.stdout.write(
    [
      'pnpm --filter @binderly/data-pipeline seed [options]',
      '',
      'Options:',
      '  --source <name>         Restrict primary enumeration to <name>',
      '                          (tcgdex-en | tcgdex-jp). May be repeated.',
      '  --set <canonical-key>   Restrict to canonical set keys (en-swsh9, jp-s9, …).',
      '  --limit-sets <n>        Bound on number of sets processed.',
      '  --limit-cards <n>       Bound on number of cards processed per set.',
      '  --dry-run               Skip DB writes and image uploads.',
      '  --no-images             Skip the image pipeline call.',
      '  --set-concurrency <n>   Set-pool size (default 2).',
      '  --image-concurrency <n> Image-pool size (default 4).',
      '  --report-dir <path>     Directory for the run-report JSON',
      '                          (default: data-pipeline/scripts/output).',
      '  --help                  Show this message.',
      '',
    ].join('\n'),
  );
}

// ============================================================
// Production wiring
// ============================================================

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `seed: required env var ${name} is not set (see data-pipeline/scripts/seed.ts header comment)`,
    );
  }
  return value;
}

interface ProductionWiring {
  adapters: ReadonlyArray<SourceAdapter>;
  writer: DrizzleCatalogWriter;
  dedup: DrizzleImageDedupResolver;
  storage: S3ImageStorage;
  imageHttpProvider: ImageHttpProvider;
  closeFns: Array<() => Promise<void>>;
}

function buildProductionWiring(): ProductionWiring {
  const databaseUrl = getRequiredEnv('DATABASE_URL');
  const userAgent = getRequiredEnv('BINDERLY_DATA_PIPELINE_UA');

  const db = createDbClient(databaseUrl);
  const writer = new DrizzleCatalogWriter(db);
  const dedup = new DrizzleImageDedupResolver(db);

  const bucket = process.env['IMAGES_BUCKET'] ?? 'images';
  const publicUrlPrefix =
    process.env['IMAGES_PUBLIC_URL_PREFIX'] ??
    `${process.env['S3_ENDPOINT_URL'] ?? 'http://localhost:9000'}/${bucket}`;
  const s3Client: S3Client = createLocalMinioClient();
  const storage = new S3ImageStorage({ bucket, publicUrlPrefix, client: s3Client });

  const tcgdexClient = new RateLimitedClient({
    host: TCGDEX_HOST,
    requestsPerSecond: TCGDEX_DEFAULT_RPS,
    burst: TCGDEX_DEFAULT_BURST,
    userAgent,
  });
  const ptcgioClient = new RateLimitedClient({
    host: PTCGIO_HOST,
    requestsPerSecond: PTCGIO_DEFAULT_RPS,
    burst: PTCGIO_DEFAULT_BURST,
    userAgent,
  });
  const bulbapediaClient = new RateLimitedClient({
    host: BULBAPEDIA_HOST,
    requestsPerSecond: BULBAPEDIA_DEFAULT_RPS,
    burst: BULBAPEDIA_DEFAULT_BURST,
    userAgent,
  });

  const adapters: SourceAdapter[] = [
    new TCGdexEnAdapter({ http: tcgdexClient }),
    new TCGdexJpAdapter({ http: tcgdexClient }),
    new PTCGIOAdapter({ http: ptcgioClient }),
    new BulbapediaAdapter({ http: bulbapediaClient }),
  ];

  const imageHttpProvider: ImageHttpProvider = {
    forSource(source: ImageSource): RateLimitedClient | null {
      if (source === 'tcgdex-en' || source === 'tcgdex-jp') return tcgdexClient;
      if (source === 'ptcgio') return ptcgioClient;
      // pokemoncard-jp images and bulbapedia-en images are handled
      // elsewhere (or excluded). Return null to skip rather than
      // accidentally route through a wrong host.
      return null;
    },
  };

  return {
    adapters,
    writer,
    dedup,
    storage,
    imageHttpProvider,
    closeFns: [
      () => tcgdexClient.stop(),
      () => ptcgioClient.stop(),
      () => bulbapediaClient.stop(),
      () => (s3Client.destroy() as unknown as Promise<void>) ?? Promise.resolve(),
      async () => {
        await db.$client.end({ timeout: 5 });
      },
    ],
  };
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<number> {
  const args = parseCli(process.argv.slice(2));
  process.stdout.write(`seed: parsed args ${JSON.stringify(args, null, 2)}\n`);

  // Sandbox-friendly early exit: when DATABASE_URL is unset, print
  // the parsed options + a guidance message and exit non-zero. This
  // lets `pnpm seed --help` succeed and `pnpm seed` fail cleanly
  // without crashing on a stack trace.
  if (!process.env['DATABASE_URL']) {
    process.stderr.write(
      'seed: DATABASE_URL is not set. See data-pipeline/scripts/seed.ts header comment.\n',
    );
    return 2;
  }
  if (!process.env['BINDERLY_DATA_PIPELINE_UA']) {
    process.stderr.write(
      'seed: BINDERLY_DATA_PIPELINE_UA is not set. The HTTP clients require an operator-contactable User-Agent.\n',
    );
    return 2;
  }

  const wiring = buildProductionWiring();

  let report: SeedRunReport;
  try {
    report = await runSeedIngest({
      adapters: wiring.adapters,
      writer: wiring.writer,
      dedup: wiring.dedup,
      storage: wiring.storage,
      imageHttpProvider: wiring.imageHttpProvider,
      sources: args.sources.length > 0 ? args.sources : undefined,
      sets: args.sets.length > 0 ? args.sets : undefined,
      limitSets: args.limitSets,
      limitCards: args.limitCards,
      dryRun: args.dryRun,
      noImages: args.noImages,
      setConcurrency: args.setConcurrency,
      imageConcurrency: args.imageConcurrency,
    });
  } finally {
    for (const close of wiring.closeFns) {
      try {
        await close();
      } catch {
        // best-effort cleanup; ignore close errors so the report still surfaces
      }
    }
  }

  process.stdout.write(`${formatSeedRunSummary(report)}\n`);

  await mkdir(args.reportDir, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(args.reportDir, `seed-run-${stamp}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`seed: report written to ${reportPath}\n`);

  return report.errors.length > 0 ? 1 : 0;
}

main()
  // eslint-disable-next-line n/no-process-exit
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`seed: fatal error: ${err instanceof Error ? err.stack : String(err)}\n`);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  });
