// Public barrel for the data-pipeline `jobs` namespace. Re-exported
// from the package root via `data-pipeline/src/index.ts` so
// downstream consumers can import the seed-ingest surface as
// `import { runSeedIngest, type SeedRunReport } from '@binderly/data-pipeline'`.

export * from './seed.js';
