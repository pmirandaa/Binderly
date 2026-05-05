// `SeedRunError` — discriminated union covering every survivable
// failure mode of the seed-ingest job. The job NEVER throws on a
// per-(set | card | printing) failure; instead it appends a typed
// entry here and continues. The reporter prints the top-N entries
// at end of run.
//
// Per `tasks/01-data-layer/T-DL-SEED-INGEST.md` § "Failure handling":
// the only short-circuit is `enumerate_sets` for a primary adapter,
// which loses that adapter's leg of the run but does not abort the
// other primary.

import type { ImagePipelineError, ImageSource } from '../../images/index.js';

export type SeedRunErrorKind =
  | 'enumerate_sets'
  | 'fetch_cards'
  | 'fetch_printings'
  | 'image_pipeline'
  | 'db_upsert';

export type SeedDbEntity = 'set' | 'card' | 'printing' | 'printing_image' | 'data_conflict';

export type SeedRunError =
  | {
      readonly kind: 'enumerate_sets';
      readonly source: string;
      readonly cause: unknown;
    }
  | {
      readonly kind: 'fetch_cards';
      readonly source: string;
      readonly setKey: string;
      readonly cause: unknown;
    }
  | {
      readonly kind: 'fetch_printings';
      readonly source: string;
      readonly cardKey: string;
      readonly cause: unknown;
    }
  | {
      readonly kind: 'image_pipeline';
      readonly source: ImageSource;
      readonly variantKey: string;
      readonly error: ImagePipelineError;
    }
  | {
      readonly kind: 'db_upsert';
      readonly entity: SeedDbEntity;
      readonly key: string;
      readonly cause: unknown;
    };

/**
 * Compact one-line summary of a `SeedRunError`. Used by the reporter
 * to print the top-N error tail without dumping stack traces. Stable
 * across runs so snapshot tests bite when the wire shape regresses.
 */
export function formatSeedRunError(err: SeedRunError): string {
  switch (err.kind) {
    case 'enumerate_sets':
      return `[enumerate_sets] source=${err.source} cause=${describeCause(err.cause)}`;
    case 'fetch_cards':
      return `[fetch_cards] source=${err.source} setKey=${err.setKey} cause=${describeCause(err.cause)}`;
    case 'fetch_printings':
      return `[fetch_printings] source=${err.source} cardKey=${err.cardKey} cause=${describeCause(err.cause)}`;
    case 'image_pipeline':
      return `[image_pipeline] source=${err.source} variantKey=${err.variantKey} kind=${err.error.kind} message=${err.error.message}`;
    case 'db_upsert':
      return `[db_upsert] entity=${err.entity} key=${err.key} cause=${describeCause(err.cause)}`;
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'string') return cause;
  if (cause === undefined) return 'undefined';
  if (cause === null) return 'null';
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}
