import { describe, expect, it } from 'vitest';

import { AnnManifestSchema, parseAnnManifest } from '../manifest';

const VALID_MANIFEST = {
  name: 'pokemon-en',
  version: '1.0.0',
  embeddingModelName: 'mobilenet-v3-small',
  embeddingModelVersion: '1.0.0',
  embeddingModelHash: 'a'.repeat(64),
  dim: 576,
  count: 30000,
  dtype: 'float16',
  idLength: 36,
  indexHash: 'b'.repeat(64),
  format: 'flat',
  metric: 'cosine',
  createdAt: '2026-05-20T11:00:00.000Z',
};

describe('AnnManifestSchema', () => {
  it('accepts a valid manifest', () => {
    const parsed = AnnManifestSchema.parse(VALID_MANIFEST);
    expect(parsed.dim).toBe(576);
    expect(parsed.dtype).toBe('float16');
    expect(parsed.format).toBe('flat');
    expect(parsed.metric).toBe('cosine');
  });

  it('defaults format + metric when omitted', () => {
    const { format: _format, metric: _metric, ...partial } = VALID_MANIFEST;
    void _format;
    void _metric;
    const parsed = AnnManifestSchema.parse(partial);
    expect(parsed.format).toBe('flat');
    expect(parsed.metric).toBe('cosine');
  });

  it('rejects unknown fields', () => {
    expect(() =>
      AnnManifestSchema.parse({ ...VALID_MANIFEST, surprise: 'no' }),
    ).toThrowError(/Unrecognized key/);
  });

  it('rejects a non-hex embedding model hash', () => {
    expect(() =>
      AnnManifestSchema.parse({
        ...VALID_MANIFEST,
        embeddingModelHash: 'z'.repeat(64),
      }),
    ).toThrowError(/hex SHA-256/);
  });

  it('rejects a too-short index hash', () => {
    expect(() =>
      AnnManifestSchema.parse({ ...VALID_MANIFEST, indexHash: 'abc' }),
    ).toThrow();
  });

  it('rejects dim ≤ 0', () => {
    expect(() => AnnManifestSchema.parse({ ...VALID_MANIFEST, dim: 0 })).toThrow();
  });

  it('accepts count = 0 (empty catalog)', () => {
    const parsed = AnnManifestSchema.parse({ ...VALID_MANIFEST, count: 0 });
    expect(parsed.count).toBe(0);
  });

  it('rejects an unknown dtype', () => {
    expect(() =>
      AnnManifestSchema.parse({ ...VALID_MANIFEST, dtype: 'int8' }),
    ).toThrow();
  });

  it('rejects an unknown format value', () => {
    expect(() =>
      AnnManifestSchema.parse({ ...VALID_MANIFEST, format: 'ivf' }),
    ).toThrow();
  });
});

describe('parseAnnManifest', () => {
  it('accepts a JSON string', () => {
    const parsed = parseAnnManifest(JSON.stringify(VALID_MANIFEST));
    expect(parsed.dim).toBe(576);
  });

  it('parses a plain object', () => {
    const parsed = parseAnnManifest(VALID_MANIFEST);
    expect(parsed.name).toBe('pokemon-en');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAnnManifest('{not-json')).toThrow();
  });
});
