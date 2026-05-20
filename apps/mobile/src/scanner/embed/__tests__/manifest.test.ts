// Tests for the Zod-backed embedding manifest schema. Mirrors the
// Python pytest suite in `apps/api-python/embeddings/tests/test_manifest.py`
// so the two sides of the contract stay in lockstep.

import { describe, expect, it } from 'vitest';

import {
  EmbeddingManifestSchema,
  parseManifest,
  type EmbeddingManifest,
} from '../manifest';

const VALID_HASH = 'a'.repeat(64);

function validPayload(): EmbeddingManifest {
  return {
    name: 'mobilenet-v3-small',
    version: '1.0.0',
    modelHash: VALID_HASH,
    inputShape: [1, 224, 224, 3],
    embeddingDim: 576,
    normalization: 'mobilenet_v3',
    createdAt: '2026-05-20T09:30:00.000Z',
    sourceUrl: 'https://example.com/m.tflite',
  };
}

describe('EmbeddingManifestSchema — happy path', () => {
  it('accepts the canonical v1 payload', () => {
    expect(EmbeddingManifestSchema.parse(validPayload())).toMatchObject({
      name: 'mobilenet-v3-small',
      embeddingDim: 576,
    });
  });

  it('round-trips through JSON', () => {
    const manifest = EmbeddingManifestSchema.parse(validPayload());
    const round = EmbeddingManifestSchema.parse(JSON.parse(JSON.stringify(manifest)));
    expect(round).toEqual(manifest);
  });

  it('allows the fixture manifest the Python suite writes', () => {
    const fixture = {
      name: 'tiny-embedder',
      version: '1.0.0-fixture',
      modelHash: 'ae821f7a9d48341e52bbb22401f882f8fbf647e294b64fd97db44b4e4105cb2a',
      inputShape: [1, 224, 224, 3],
      embeddingDim: 32,
      normalization: 'zero_one',
      createdAt: '2026-05-20T00:00:00.000Z',
      sourceUrl: null,
    };
    expect(EmbeddingManifestSchema.parse(fixture).name).toBe('tiny-embedder');
  });

  it('treats `sourceUrl` as optional', () => {
    const payload = { ...validPayload(), sourceUrl: null };
    expect(EmbeddingManifestSchema.parse(payload).sourceUrl).toBeNull();
  });
});

describe('EmbeddingManifestSchema — rejection cases', () => {
  it('rejects an unknown extra field (strict mode)', () => {
    expect(() =>
      EmbeddingManifestSchema.parse({ ...validPayload(), extra: 'nope' }),
    ).toThrow();
  });

  it.each([
    ['name', ''],
    ['version', ''],
    ['modelHash', 'too-short'],
    ['modelHash', 'g'.repeat(64)],
    ['embeddingDim', 0],
    ['embeddingDim', -1],
    ['normalization', 'not-a-recipe'],
    ['inputShape', [1, 224, 224]],
    ['inputShape', [1, 224, 224, 3, 1]],
    ['inputShape', [1, 0, 224, 3]],
    ['createdAt', ''],
  ] as const)('rejects bad field %s = %j', (field, value) => {
    expect(() =>
      EmbeddingManifestSchema.parse({ ...validPayload(), [field]: value }),
    ).toThrow();
  });

  it('rejects non-3 channel dim with a targeted error', () => {
    const bad = { ...validPayload(), inputShape: [1, 224, 224, 4] };
    expect(() => EmbeddingManifestSchema.parse(bad)).toThrow(/channel/);
  });
});

describe('parseManifest', () => {
  it('parses a JSON string', () => {
    const json = JSON.stringify(validPayload());
    expect(parseManifest(json).name).toBe('mobilenet-v3-small');
  });

  it('parses an object', () => {
    expect(parseManifest(validPayload()).name).toBe('mobilenet-v3-small');
  });

  it('throws SyntaxError on malformed JSON', () => {
    expect(() => parseManifest('{not-json}')).toThrow(SyntaxError);
  });
});
