// Zod schema mirroring `apps/api-python/ann/manifest.py`.
//
// Adding a field requires updating both the pydantic model on the
// Python side and this schema. The loader validates the manifest
// before reading any bytes from the `.bin`.

import { z } from 'zod';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const DtypeSchema = z.enum(['float32', 'float16']);
const FormatSchema = z.enum(['flat', 'hnsw', 'pq']);
const MetricSchema = z.enum(['cosine']);

export const AnnManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    embeddingModelName: z.string().min(1),
    embeddingModelVersion: z.string().min(1),
    embeddingModelHash: z
      .string()
      .regex(HEX_64, 'embeddingModelHash must be 64-char hex SHA-256'),
    dim: z.number().int().positive(),
    count: z.number().int().min(0),
    dtype: DtypeSchema,
    idLength: z.number().int().positive(),
    indexHash: z.string().regex(HEX_64, 'indexHash must be 64-char hex SHA-256'),
    format: FormatSchema.default('flat'),
    metric: MetricSchema.default('cosine'),
    createdAt: z.string().min(1),
  })
  .strict();

export type AnnManifest = z.infer<typeof AnnManifestSchema>;
export type AnnDtypeName = z.infer<typeof DtypeSchema>;
export type AnnFormatName = z.infer<typeof FormatSchema>;
export type AnnMetricName = z.infer<typeof MetricSchema>;

/**
 * Parse a JSON string or object into a validated `AnnManifest`.
 *
 * Throws a `ZodError` on schema failure. The loader catches this and
 * surfaces a typed `AnnLoadError` to keep error handling uniform with
 * the embed module.
 */
export function parseAnnManifest(raw: unknown): AnnManifest {
  if (typeof raw === 'string') {
    return AnnManifestSchema.parse(JSON.parse(raw));
  }
  return AnnManifestSchema.parse(raw);
}
