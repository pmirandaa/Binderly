// `runImagePipelineForPrintings` — fans a list of (printing × source)
// inputs through the image pipeline, bounded by an inline
// concurrency pool. Each call returns the small/large image URLs
// for the printing (or `null`s) plus the per-printing outcome the
// caller patches onto the `printing` row.
//
// The runner is responsible for:
//
//   - Picking the right per-source `RateLimitedClient` for the image
//     fetch (different from the catalog adapters' clients — image
//     hosts are usually a different hostname per source).
//   - Reporting per-outcome counters (transcoded / cached /
//     skipped_no_url / skipped_excluded_source / errors).
//   - Translating `processImage`'s `ok: false` branch into the
//     reporter's typed error log.

import { concurrencyPool } from './concurrency.js';
import { Reporter } from './report.js';
import { processImage } from '../../images/index.js';
import {
  EXCLUDED_IMAGE_SOURCES,
  IMAGE_SOURCES,
  type ImageDedupResolver,
  type ImageSource,
  type ImageStorage,
  type ProcessedImageResult,
  type ProcessedImageVariant,
  type VariantSpec,
} from '../../images/index.js';
import { type AdapterLogger } from '../../interfaces/adapter.js';

import type { RateLimitedClient } from '../../http/rate-limited-client.js';
import type { CanonicalPrinting, CanonicalSet } from '../../types.js';

export interface ImageRunInput {
  readonly canonical: CanonicalPrinting;
  readonly canonicalSet: CanonicalSet;
  /** Source adapter that produced this printing. Drives license + http client. */
  readonly source: string;
  /** DB UUID for the printing row, when known. */
  readonly printingId: string | undefined;
}

export interface ImageRunOutcome {
  readonly variantKey: string;
  readonly result: ProcessedImageResult | { readonly status: 'unsupported_source' };
  readonly imageSmallUrl: string | null;
  readonly imageLargeUrl: string | null;
}

/**
 * Provides per-image-host `RateLimitedClient` instances. The seed-job
 * wires production `createImageHttpClients()` and tests substitute
 * fakes that return mocked clients. A `null` return means "we don't
 * fetch images from this source" (e.g. `bulbapedia-en`); the runner
 * short-circuits with `skipped_excluded_source`.
 */
export interface ImageHttpProvider {
  /** Return a client for the image host of `source`, or `null` to skip. */
  forSource(source: ImageSource): RateLimitedClient | null;
}

export interface RunImageOptions {
  readonly storage: ImageStorage;
  readonly dedup: ImageDedupResolver;
  readonly httpProvider: ImageHttpProvider;
  readonly reporter: Reporter;
  readonly logger: AdapterLogger;
  readonly concurrency: number;
  /** Optional override for the variant ladder (tests pass a tiny one). */
  readonly ladder?: ReadonlyArray<VariantSpec>;
}

export async function runImagePipelineForPrintings(
  inputs: ReadonlyArray<ImageRunInput>,
  options: RunImageOptions,
): Promise<ReadonlyArray<ImageRunOutcome>> {
  const pool = concurrencyPool(options.concurrency);
  const tasks = inputs.map((input) => pool.run(() => runOne(input, options)));
  return Promise.all(tasks);
}

// ============================================================
// Per-input processor
// ============================================================

async function runOne(input: ImageRunInput, options: RunImageOptions): Promise<ImageRunOutcome> {
  const variantKey = input.canonical.variantKey;
  const sourceName = input.source;

  if (!isImageSource(sourceName)) {
    options.logger.warn(
      { source: sourceName, variant_key: variantKey },
      'seed.image_pipeline.unsupported_source',
    );
    return {
      variantKey,
      result: { status: 'unsupported_source' },
      imageSmallUrl: input.canonical.imageSmallUrl ?? null,
      imageLargeUrl: input.canonical.imageLargeUrl ?? null,
    };
  }

  if (EXCLUDED_IMAGE_SOURCES.has(sourceName)) {
    options.reporter.recordImageOutcome('skipped_excluded_source');
    return {
      variantKey,
      result: {
        ok: true,
        status: 'skipped_excluded_source',
        provenance: null,
        variants: [],
      },
      imageSmallUrl: input.canonical.imageSmallUrl ?? null,
      imageLargeUrl: input.canonical.imageLargeUrl ?? null,
    };
  }

  const http = options.httpProvider.forSource(sourceName);
  if (!http) {
    options.reporter.recordImageOutcome('skipped_excluded_source');
    return {
      variantKey,
      result: {
        ok: true,
        status: 'skipped_excluded_source',
        provenance: null,
        variants: [],
      },
      imageSmallUrl: input.canonical.imageSmallUrl ?? null,
      imageLargeUrl: input.canonical.imageLargeUrl ?? null,
    };
  }

  const result = await options.reporter.time('image_pipeline', () =>
    processImage({
      printing: {
        variantKey,
        setCanonicalKey: input.canonicalSet.canonicalKey,
        ...(input.printingId !== undefined ? { printingId: input.printingId } : {}),
      },
      source: sourceName,
      sourceUrl: input.canonical.imageSourceUrl ?? null,
      http,
      storage: options.storage,
      dedup: options.dedup,
      logger: options.logger,
      ...(options.ladder !== undefined ? { ladder: options.ladder } : {}),
    }),
  );

  if (!result.ok) {
    options.reporter.recordImageOutcome('error');
    options.reporter.recordError({
      kind: 'image_pipeline',
      source: sourceName,
      variantKey,
      error: result.error,
    });
    options.logger.error(
      {
        source: sourceName,
        variant_key: variantKey,
        kind: result.error.kind,
        message: result.error.message,
      },
      'seed.image_pipeline.error',
    );
    return {
      variantKey,
      result,
      imageSmallUrl: input.canonical.imageSmallUrl ?? null,
      imageLargeUrl: input.canonical.imageLargeUrl ?? null,
    };
  }

  options.reporter.recordImageOutcome(result.status);

  const { imageSmallUrl, imageLargeUrl } = pickDisplayUrls(result.variants, input.canonical);
  return {
    variantKey,
    result,
    imageSmallUrl,
    imageLargeUrl,
  };
}

function pickDisplayUrls(
  variants: ReadonlyArray<ProcessedImageVariant>,
  canonical: CanonicalPrinting,
): { imageSmallUrl: string | null; imageLargeUrl: string | null } {
  const byName = new Map(variants.map((v) => [v.name, v]));
  const small = byName.get('card') ?? byName.get('thumb');
  const large = byName.get('large') ?? byName.get('original');
  return {
    imageSmallUrl: small?.url ?? canonical.imageSmallUrl ?? null,
    imageLargeUrl: large?.url ?? canonical.imageLargeUrl ?? null,
  };
}

function isImageSource(source: string): source is ImageSource {
  return (IMAGE_SOURCES as ReadonlyArray<string>).includes(source);
}
