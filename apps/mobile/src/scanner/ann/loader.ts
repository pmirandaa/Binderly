// `loadAnnIndex` — on-device entry point for the ANN module.
//
// Responsibilities:
//   1. Validate the manifest against `AnnManifestSchema`.
//   2. Validate the binary header against the manifest (magic +
//      dim + count + idLength + dtype must all line up).
//   3. Decode the binary body into a single Float32 catalog buffer
//      (FP16-stored bytes are dequantised eagerly here).
//   4. If the caller passed an `EmbeddingManifest`, refuse to pair
//      this index with a non-matching embedding model.
//   5. Return an `AnnIndexHandle` whose `searchKNN` runs the
//      brute-force top-K cosine search.
//
// The loader is the only place where the binary asset is touched —
// everything downstream (`searchKNN`) is pure-JS array math.

import { ZodError } from 'zod';

import {
  AnnFormatError,
  DTYPE_FLOAT16,
  DTYPE_FLOAT32,
  parseIndex,
} from './format';
import { parseAnnManifest } from './manifest';
import { searchKnnFlat } from './search';

import type { AnnManifest } from './manifest';
import type {
  AnnDtype,
  AnnIndexHandle,
  AnnLoadOptions,
  AnnSearchResult,
} from './types';
import type { EmbeddingManifest } from '@/scanner/embed';

/**
 * Typed failure modes the loader surfaces. The screen turns this
 * into a localised "Scanner unavailable" toast; Sentry uses the
 * `code` to group failures.
 */
export class AnnLoadError extends Error {
  readonly code:
    | 'MANIFEST_INVALID'
    | 'BUFFER_INVALID'
    | 'HEADER_MISMATCH'
    | 'EMBEDDING_MODEL_MISMATCH'
    | 'INDEX_FORMAT_UNSUPPORTED';
  override readonly cause: unknown;

  constructor(
    code: AnnLoadError['code'],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AnnLoadError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Load + validate the on-device ANN index.
 *
 * Throws an `AnnLoadError` on any failure. Callers should `try/catch`
 * and degrade gracefully — scanner is unavailable on this device;
 * manual entry still works.
 */
export function loadAnnIndex(options: AnnLoadOptions): AnnIndexHandle {
  const manifest = validateManifest(options.manifest);
  if (manifest.format !== 'flat') {
    throw new AnnLoadError(
      'INDEX_FORMAT_UNSUPPORTED',
      `on-device runtime only implements 'flat' for v1; manifest says '${manifest.format}'`,
    );
  }

  let parsed;
  try {
    parsed = parseIndex(options.indexBuffer);
  } catch (cause) {
    if (cause instanceof AnnFormatError) {
      throw new AnnLoadError('BUFFER_INVALID', cause.message, cause);
    }
    throw cause;
  }

  ensureHeaderMatchesManifest(parsed.header, manifest);
  if (options.embeddingManifest) {
    ensureEmbeddingModelMatches(manifest, options.embeddingManifest);
  }

  const compareTies = options.compareTies ?? defaultIdCompare;

  // Take a defensive copy of the catalog so the handle owns its
  // backing memory — `parseIndex` already copies but we want the
  // lifetime to be obvious to the caller.
  const catalog = parsed.embeddings;
  const ids = parsed.ids;
  let disposed = false;

  return {
    dim: manifest.dim,
    count: manifest.count,
    format: manifest.format,
    metric: manifest.metric,
    dtype: dtypeNameFromTag(parsed.header.dtype),
    name: manifest.name,
    version: manifest.version,
    embeddingModelName: manifest.embeddingModelName,
    embeddingModelVersion: manifest.embeddingModelVersion,
    embeddingModelHash: manifest.embeddingModelHash,

    searchKNN(queryVec: Float32Array, k: number): AnnSearchResult[] {
      if (disposed) {
        throw new Error('ann index has been disposed');
      }
      return searchKnnFlat(queryVec, catalog, ids, manifest.dim, k, compareTies);
    },

    dispose(): void {
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------

function validateManifest(raw: unknown): AnnManifest {
  try {
    return parseAnnManifest(raw);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new AnnLoadError(
        'MANIFEST_INVALID',
        `manifest failed schema validation: ${cause.message}`,
        cause,
      );
    }
    if (cause instanceof SyntaxError) {
      throw new AnnLoadError(
        'MANIFEST_INVALID',
        `manifest JSON did not parse: ${cause.message}`,
        cause,
      );
    }
    throw cause;
  }
}

function ensureHeaderMatchesManifest(
  header: { dim: number; count: number; idLength: number; dtype: number },
  manifest: AnnManifest,
): void {
  if (header.dim !== manifest.dim) {
    throw new AnnLoadError(
      'HEADER_MISMATCH',
      `binary dim ${header.dim} disagrees with manifest dim ${manifest.dim}`,
    );
  }
  if (header.count !== manifest.count) {
    throw new AnnLoadError(
      'HEADER_MISMATCH',
      `binary count ${header.count} disagrees with manifest count ${manifest.count}`,
    );
  }
  if (header.idLength !== manifest.idLength) {
    throw new AnnLoadError(
      'HEADER_MISMATCH',
      `binary idLength ${header.idLength} disagrees with manifest idLength ${manifest.idLength}`,
    );
  }
  const expectedDtype = manifest.dtype === 'float16' ? DTYPE_FLOAT16 : DTYPE_FLOAT32;
  if (header.dtype !== expectedDtype) {
    throw new AnnLoadError(
      'HEADER_MISMATCH',
      `binary dtype tag ${header.dtype} disagrees with manifest dtype '${manifest.dtype}'`,
    );
  }
}

function ensureEmbeddingModelMatches(
  manifest: AnnManifest,
  embeddingManifest: EmbeddingManifest,
): void {
  if (manifest.embeddingModelName !== embeddingManifest.name) {
    throw new AnnLoadError(
      'EMBEDDING_MODEL_MISMATCH',
      `index built against embedding model '${manifest.embeddingModelName}'; loaded model is '${embeddingManifest.name}'`,
    );
  }
  if (manifest.embeddingModelVersion !== embeddingManifest.version) {
    throw new AnnLoadError(
      'EMBEDDING_MODEL_MISMATCH',
      `index built against embedding version '${manifest.embeddingModelVersion}'; loaded version is '${embeddingManifest.version}'`,
    );
  }
  if (
    manifest.embeddingModelHash.toLowerCase() !==
    embeddingManifest.modelHash.toLowerCase()
  ) {
    throw new AnnLoadError(
      'EMBEDDING_MODEL_MISMATCH',
      'index modelHash disagrees with the loaded embedding model hash',
    );
  }
  if (manifest.dim !== embeddingManifest.embeddingDim) {
    throw new AnnLoadError(
      'EMBEDDING_MODEL_MISMATCH',
      `index dim ${manifest.dim} disagrees with embedding model embeddingDim ${embeddingManifest.embeddingDim}`,
    );
  }
}

function dtypeNameFromTag(tag: number): AnnDtype {
  if (tag === DTYPE_FLOAT16) return 'float16';
  return 'float32';
}

function defaultIdCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
