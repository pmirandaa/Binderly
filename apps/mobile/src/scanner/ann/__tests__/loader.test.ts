import { describe, expect, it } from 'vitest';

import { AnnLoadError, loadAnnIndex } from '../loader';
import { buildIndexBuffer, unitNormMatrix } from './test-utils';

import type { EmbeddingManifest } from '@/scanner/embed';

const SHA = 'a'.repeat(64);
const INDEX_HASH = 'b'.repeat(64);

function makeManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'pokemon-en',
    version: '1.0.0',
    embeddingModelName: 'mobilenet-v3-small',
    embeddingModelVersion: '1.0.0',
    embeddingModelHash: SHA,
    dim: 4,
    count: 3,
    dtype: 'float32',
    idLength: 4,
    indexHash: INDEX_HASH,
    format: 'flat',
    metric: 'cosine',
    createdAt: '2026-05-20T11:00:00.000Z',
    ...overrides,
  };
}

function makeBuffer(opts: {
  ids?: string[];
  embeddings?: Float32Array;
  dim?: number;
  idLength?: number;
  dtype?: 'float16' | 'float32';
} = {}): ArrayBuffer {
  const dim = opts.dim ?? 4;
  const ids = opts.ids ?? ['p-0', 'p-1', 'p-2'];
  const embeddings =
    opts.embeddings ??
    unitNormMatrix([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
  return buildIndexBuffer({
    ids,
    embeddings,
    dim,
    idLength: opts.idLength ?? 4,
    dtype: opts.dtype ?? 'float32',
  });
}

describe('loadAnnIndex — happy path', () => {
  it('returns a handle with manifest identity fields', () => {
    const handle = loadAnnIndex({
      indexBuffer: makeBuffer(),
      manifest: makeManifest(),
    });
    expect(handle.dim).toBe(4);
    expect(handle.count).toBe(3);
    expect(handle.format).toBe('flat');
    expect(handle.metric).toBe('cosine');
    expect(handle.dtype).toBe('float32');
    expect(handle.name).toBe('pokemon-en');
    expect(handle.embeddingModelName).toBe('mobilenet-v3-small');
  });

  it('searchKNN returns the matching catalog row first', () => {
    const handle = loadAnnIndex({
      indexBuffer: makeBuffer(),
      manifest: makeManifest(),
    });
    const query = new Float32Array([1, 0, 0, 0]);
    const results = handle.searchKNN(query, 3);
    expect(results).toHaveLength(3);
    expect(results[0]?.printingId).toBe('p-0');
    expect(results[0]?.score).toBeCloseTo(1, 6);
  });

  it('decodes a float16 catalog', () => {
    const embeddings = unitNormMatrix([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);
    const handle = loadAnnIndex({
      indexBuffer: buildIndexBuffer({
        ids: ['p-0', 'p-1'],
        embeddings,
        dim: 4,
        idLength: 4,
        dtype: 'float16',
      }),
      manifest: makeManifest({ count: 2, dtype: 'float16' }),
    });
    expect(handle.dtype).toBe('float16');
    const top = handle.searchKNN(new Float32Array([1, 0, 0, 0]), 1);
    expect(top[0]?.printingId).toBe('p-0');
  });
});

describe('loadAnnIndex — manifest failures', () => {
  it('rejects an invalid manifest with MANIFEST_INVALID', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: { invalid: true },
      }),
    ).toThrowError(
      expect.objectContaining({ name: 'AnnLoadError', code: 'MANIFEST_INVALID' }),
    );
  });

  it('rejects an unsupported format', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: makeManifest({ format: 'hnsw' }),
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'INDEX_FORMAT_UNSUPPORTED' }),
    );
  });
});

describe('loadAnnIndex — header / manifest cross-check', () => {
  it('rejects a manifest whose dim disagrees with the binary', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer({ dim: 4 }),
        manifest: makeManifest({ dim: 8 }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'HEADER_MISMATCH' }));
  });

  it('rejects a manifest whose count disagrees with the binary', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: makeManifest({ count: 99 }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'HEADER_MISMATCH' }));
  });

  it('rejects a manifest whose dtype disagrees with the binary', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer({ dtype: 'float32' }),
        manifest: makeManifest({ dtype: 'float16' }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'HEADER_MISMATCH' }));
  });

  it('rejects a truncated buffer with BUFFER_INVALID', () => {
    const full = makeBuffer();
    expect(() =>
      loadAnnIndex({
        indexBuffer: full.slice(0, full.byteLength - 2),
        manifest: makeManifest(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'BUFFER_INVALID' }));
  });
});

describe('loadAnnIndex — embedding-model cross-check', () => {
  const embeddingManifest: EmbeddingManifest = {
    name: 'mobilenet-v3-small',
    version: '1.0.0',
    modelHash: SHA,
    inputShape: [1, 224, 224, 3],
    embeddingDim: 4,
    normalization: 'mobilenet_v3',
    createdAt: '2026-05-20T11:00:00.000Z',
    sourceUrl: null,
  };

  it('accepts a matching embedding manifest', () => {
    const handle = loadAnnIndex({
      indexBuffer: makeBuffer(),
      manifest: makeManifest(),
      embeddingManifest,
    });
    expect(handle.embeddingModelName).toBe('mobilenet-v3-small');
  });

  it('rejects a mismatched embedding model name', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: makeManifest(),
        embeddingManifest: { ...embeddingManifest, name: 'efficientnet' },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EMBEDDING_MODEL_MISMATCH' }),
    );
  });

  it('rejects a mismatched embedding model version', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: makeManifest(),
        embeddingManifest: { ...embeddingManifest, version: '9.9.9' },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EMBEDDING_MODEL_MISMATCH' }),
    );
  });

  it('rejects a mismatched embedding model hash', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: makeManifest(),
        embeddingManifest: {
          ...embeddingManifest,
          modelHash: 'c'.repeat(64),
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EMBEDDING_MODEL_MISMATCH' }),
    );
  });

  it('rejects a mismatched embedding dim', () => {
    expect(() =>
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: makeManifest(),
        embeddingManifest: { ...embeddingManifest, embeddingDim: 8 },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EMBEDDING_MODEL_MISMATCH' }),
    );
  });
});

describe('loadAnnIndex — dispose', () => {
  it('searchKNN throws after dispose', () => {
    const handle = loadAnnIndex({
      indexBuffer: makeBuffer(),
      manifest: makeManifest(),
    });
    handle.dispose();
    expect(() => handle.searchKNN(new Float32Array([1, 0, 0, 0]), 1)).toThrow(
      /disposed/,
    );
  });

  it('dispose is idempotent', () => {
    const handle = loadAnnIndex({
      indexBuffer: makeBuffer(),
      manifest: makeManifest(),
    });
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });
});

describe('AnnLoadError shape', () => {
  it('exposes the code and cause for Sentry grouping', () => {
    try {
      loadAnnIndex({
        indexBuffer: makeBuffer(),
        manifest: { not: 'valid' },
      });
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AnnLoadError);
      expect((error as AnnLoadError).code).toBe('MANIFEST_INVALID');
      expect((error as AnnLoadError).cause).toBeDefined();
    }
  });
});
